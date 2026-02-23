import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { KnownError } from './error.js';
import type { CommitType } from './config-types.js';
import { generatePrompt, commitTypeFormats } from './prompt.js';
import type { ProjectBoundary } from './project-detection.js';
import { getUnstagedDiffForFiles, getUnstagedDiffStat } from './git.js';

/**
 * Extracts the actual response from reasoning model outputs.
 * Reasoning models (like DeepSeek R1, QwQ, etc.) include their thought process
 * in <think>...</think> tags. We need to extract the content after these tags.
 */
const extractResponseFromReasoning = (message: string): string => {
	// Pattern to match <think>...</think> tags and everything before the actual response
	// This handles both single-line and multi-line think blocks
	const thinkPattern = /<think>[\s\S]*?<\/think>/gi;

	// Remove all <think>...</think> blocks and any content before the first think block
	let cleaned = message.replace(thinkPattern, '');

	// Remove any leading/trailing whitespace and newlines
	cleaned = cleaned.trim();

	return cleaned;
};

const sanitizeMessage = (message: string) => {
	// First, extract response from reasoning models if present
	let processed = extractResponseFromReasoning(message);

	// Then apply existing sanitization
 	const sanitized = processed
 		.trim()
 		.split('\n')[0] // Take only the first line
 		.replace(/(\w)\.$/, '$1')
 		.replace(/^["'`]|["'`]$/g, '') // Remove surrounding quotes
 		.replace(/^<[^>]*>\s*/, ''); // Remove leading tags

 	return sanitized;
};

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

const shortenCommitMessage = async (
	provider: any,
	model: string,
	message: string,
	maxLength: number,
	timeout: number
) => {
	const abortController = new AbortController();
	const timeoutId = setTimeout(() => abortController.abort(), timeout);

	try {
		const result = await generateText({
			model: provider(model),
			system: `You are a tool that shortens git commit messages. Given a commit message, make it shorter while preserving the key information and format. The shortened message must be ${maxLength} characters or less. Respond with ONLY the shortened commit message.`,
			prompt: message,
			temperature: 0.2,
			maxRetries: 2,
			maxOutputTokens: 500,
		});
		clearTimeout(timeoutId);
		return sanitizeMessage(result.text);
	} catch (error) {
		clearTimeout(timeoutId);
		throw error;
	}
};

export const generateCommitMessage = async (
	baseUrl: string,
	apiKey: string,
	model: string,
	locale: string,
	diff: string,
	completions: number,
	maxLength: number,
	type: CommitType,
	timeout: number,
	customPrompt?: string
) => {
	if (process.env.DEBUG) {
		console.log('Diff being sent to AI:');
		console.log(diff);
	}

	try {
		const provider =
			baseUrl === 'https://api.openai.com/v1'
				? createOpenAI({ apiKey })
				: createOpenAICompatible({
						name: 'custom',
						apiKey,
						baseURL: baseUrl,
				  });

		const abortController = new AbortController();
		const timeoutId = setTimeout(() => abortController.abort(), timeout);

		const promises = Array.from({ length: completions }, () =>
			generateText({
				model: provider(model),
				system: generatePrompt(locale, maxLength, type, customPrompt),
				prompt: diff,
				temperature: 0.4,
				maxRetries: 2,
				maxOutputTokens: 2000,
			}).finally(() => clearTimeout(timeoutId))
		);
		const results = await Promise.all(promises);
		let texts = results.map((r) => r.text);
		let messages = deduplicateMessages(
			texts.map((text: string) => sanitizeMessage(text))
		);

		// Shorten messages that exceed maxLength
		const MAX_SHORTEN_RETRIES = 3;
		for (let retry = 0; retry < MAX_SHORTEN_RETRIES; retry++) {
			let needsShortening = false;
			const shortenedMessages = await Promise.all(
				messages.map(async (msg) => {
					if (msg.length <= maxLength) {
						return msg;
					}
					needsShortening = true;
					try {
						return await shortenCommitMessage(provider, model, msg, maxLength, timeout);
					} catch (error) {
						// If shortening fails, keep the original and continue
						return msg;
					}
				})
			);
			messages = deduplicateMessages(shortenedMessages);
			if (!needsShortening) break;
		}

		const usage = {
			prompt_tokens: results.reduce(
				(sum, r) => sum + ((r.usage as any).promptTokens || 0),
				0
			),
			completion_tokens: results.reduce(
				(sum, r) => sum + ((r.usage as any).completionTokens || 0),
				0
			),
			total_tokens: results.reduce(
				(sum, r) => sum + ((r.usage as any).totalTokens || 0),
				0
			),
		};
		return { messages, usage };
	} catch (error) {
		const errorAsAny = error as any;

		console.log(errorAsAny);

		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(
				`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`
			);
		}

		if (errorAsAny.status === 429) {
			const resetHeader = errorAsAny.headers?.get('x-ratelimit-reset');
			let message = 'Rate limit exceeded';
			if (resetHeader) {
				const resetTime = parseInt(resetHeader);
				const now = Date.now();
				const waitMs = resetTime - now;
				const waitSec = Math.ceil(waitMs / 1000);
				if (waitSec > 0) {
					let timeStr: string;
					if (waitSec < 60) {
						timeStr = `${waitSec} second${waitSec === 1 ? '' : 's'}`;
					} else if (waitSec < 3600) {
						const minutes = Math.ceil(waitSec / 60);
						timeStr = `${minutes} minute${minutes === 1 ? '' : 's'}`;
					} else {
						const hours = Math.ceil(waitSec / 3600);
						timeStr = `${hours} hour${hours === 1 ? '' : 's'}`;
					}
					message += `. Retry in ${timeStr}.`;
				}
			}
			throw new KnownError(message);
		}

		throw errorAsAny;
	}
};

export const combineCommitMessages = async (
	messages: string[],
	baseUrl: string,
	apiKey: string,
	model: string,
	locale: string,
	maxLength: number,
	type: CommitType,
	timeout: number,
	customPrompt?: string
) => {
	try {
		const provider =
			baseUrl === 'https://api.openai.com/v1'
				? createOpenAI({ apiKey })
				: createOpenAICompatible({
						name: 'custom',
						apiKey,
						baseURL: baseUrl,
				  });

		const abortController = new AbortController();
		const timeoutId = setTimeout(() => abortController.abort(), timeout);

		const system = `You are a tool that generates git commit messages. Your task is to combine multiple commit messages into one.

Input: Several commit messages separated by newlines.
Output: A single commit message starting with type like 'feat:' or 'fix:'.

Do not add thanks, explanations, or any text outside the commit message.`;

		const result = await generateText({
			model: provider(model),
			system,
			prompt: messages.join('\n'),
			temperature: 0.4,
			maxRetries: 2,
			maxOutputTokens: 2000,
		});

		clearTimeout(timeoutId);

		let combinedMessage = sanitizeMessage(result.text);

		// Shorten if too long
		if (combinedMessage.length > maxLength) {
			try {
				combinedMessage = await shortenCommitMessage(provider, model, combinedMessage, maxLength, timeout);
			} catch (error) {
				// If shortening fails, keep the original
			}
		}

		return { messages: [combinedMessage], usage: result.usage };
	} catch (error) {
		const errorAsAny = error as any;

		console.log(errorAsAny);

		throw errorAsAny;
	}
};

export interface CommitGroup {
	message: string;
	files: string[];
}

export const groupChangesWithAI = async (
	baseUrl: string,
	apiKey: string,
	model: string,
	locale: string,
	files: string[],
	diff: string,
	maxGroups: number,
	type: CommitType,
	timeout: number,
	customPrompt?: string,
) => {
	try {
		const provider =
			baseUrl === 'https://api.openai.com/v1'
				? createOpenAI({ apiKey })
				: createOpenAICompatible({
						name: 'custom',
						apiKey,
						baseURL: baseUrl,
				  });

		const abortController = new AbortController();
		const timeoutId = setTimeout(() => abortController.abort(), timeout);

		const typeHint = type === 'conventional'
			? 'Use conventional commit format (feat:, fix:, chore:, refactor:, docs:, test:, etc.).'
			: type === 'gitmoji'
				? 'Use gitmoji format (🐛, ✨, 🔧, etc.).'
				: 'Use a plain descriptive format.';

		const system = `You group git file changes into logical atomic commits. Each group is one coherent change.

Rules:
- Every file must appear in exactly one group.
- Group by logical purpose (feature, bugfix, refactor, config, etc.).
- Related test files go with their implementation files.
- Config/dependency changes get their own group.
- Maximum ${maxGroups} groups. Fewer is better if changes are related.
- ${typeHint}
${customPrompt ? `- Additional instructions: ${customPrompt}` : ''}
- Write messages in language: ${locale}.

Return ONLY a JSON array, no other text:
[{"message": "commit message here", "files": ["path/to/file"]}]`;

		// Truncate diff if too large
		const maxDiffLength = 30000;
		let diffToSend = diff;
		if (diff.length > maxDiffLength) {
			diffToSend = diff.substring(0, maxDiffLength) + '\n\n[Diff truncated]';
		}

		const prompt = `Files changed:\n${files.join('\n')}\n\nDiff:\n${diffToSend}`;

		const result = await generateText({
			model: provider(model),
			system,
			prompt,
			temperature: 0.3,
			maxRetries: 2,
			maxOutputTokens: 4000,
		});

		clearTimeout(timeoutId);

		// Parse JSON from response (handle markdown code blocks)
		let text = extractResponseFromReasoning(result.text).trim();
		const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || text.match(/(\[[\s\S]*\])/);
		if (jsonMatch) {
			text = jsonMatch[1].trim();
		}

		const groups: CommitGroup[] = JSON.parse(text);

		// Validate: ensure all files are covered and no extras
		const groupedFiles = new Set(groups.flatMap((g) => g.files));
		const inputFiles = new Set(files);
		const missing = files.filter((f) => !groupedFiles.has(f));
		if (missing.length > 0) {
			groups[groups.length - 1].files.push(...missing);
		}
		for (const group of groups) {
			group.files = group.files.filter((f) => inputFiles.has(f));
		}
		const validGroups = groups.filter((g) => g.files.length > 0);

		return { groups: validGroups, usage: result.usage };
	} catch (error) {
		// Fallback: put all files in one group
		return {
			groups: [{ message: 'chore: update files', files }] as CommitGroup[],
			usage: null,
		};
	}
};

const BOUNDARY_DELAY_MS = 6500;

/**
 * Build a focused diff for a boundary based on its size.
 * Small boundaries get full diff, large ones get stat summary.
 */
async function getBoundaryDiff(boundary: ProjectBoundary, fullDiff: string): Promise<string> {
	const { files } = boundary;

	// For small boundaries, extract relevant parts from the full diff or get fresh
	if (files.length <= 30) {
		const focusedDiff = await getUnstagedDiffForFiles(files);
		if (focusedDiff.length <= 30000) return focusedDiff;
		return focusedDiff.substring(0, 30000) + '\n\n[Diff truncated]';
	}

	// For medium boundaries, stat + partial diff
	if (files.length <= 100) {
		const stat = await getUnstagedDiffStat(files);
		const partialDiff = await getUnstagedDiffForFiles(files.slice(0, 20));
		const combined = `Diff stat:\n${stat}\n\nPartial diff (first 20 files):\n${partialDiff}`;
		return combined.length > 30000 ? combined.substring(0, 30000) + '\n\n[Truncated]' : combined;
	}

	// For large boundaries, stat only
	const stat = await getUnstagedDiffStat(files);
	return `Diff stat (${files.length} files):\n${stat}`;
}

/**
 * Process multiple project boundaries, calling AI for each one.
 * Returns merged commit groups from all boundaries.
 */
export const groupBoundariesWithAI = async (
	baseUrl: string,
	apiKey: string,
	model: string,
	locale: string,
	boundaries: ProjectBoundary[],
	fullDiff: string,
	maxGroupsPerBoundary: number,
	type: CommitType,
	timeout: number,
	customPrompt?: string,
	onBoundaryStart?: (name: string, index: number, total: number) => void,
): Promise<{ groups: CommitGroup[]; usage: any }> => {
	const allGroups: CommitGroup[] = [];
	let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

	for (let i = 0; i < boundaries.length; i++) {
		const boundary = boundaries[i];

		// Auto-grouped boundaries skip AI
		if (boundary.autoGroup) {
			allGroups.push(boundary.autoGroup);
			continue;
		}

		onBoundaryStart?.(boundary.name, i, boundaries.length);

		// Get focused diff for this boundary
		const diff = await getBoundaryDiff(boundary, fullDiff);

		// Build boundary context hint
		const contextHint = `Project boundary: "${boundary.name}" (${boundary.type}). ${boundary.files.length} files.`;

		const result = await groupChangesWithAI(
			baseUrl,
			apiKey,
			model,
			locale,
			boundary.files,
			diff,
			maxGroupsPerBoundary,
			type,
			timeout,
			customPrompt ? `${contextHint} ${customPrompt}` : contextHint,
		);

		allGroups.push(...result.groups);
		if (result.usage) {
			totalUsage.promptTokens += (result.usage as any).promptTokens || 0;
			totalUsage.completionTokens += (result.usage as any).completionTokens || 0;
			totalUsage.totalTokens += (result.usage as any).totalTokens || 0;
		}

		// Rate-limit delay between AI calls
		if (i < boundaries.length - 1 && !boundaries[i + 1]?.autoGroup) {
			await new Promise((r) => setTimeout(r, BOUNDARY_DELAY_MS));
		}
	}

	return { groups: allGroups, usage: totalUsage };
};
