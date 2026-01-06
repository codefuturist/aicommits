import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { KnownError } from './error.js';
import type { CommitType } from './config-types.js';
import { generatePrompt, commitTypeFormats } from './prompt.js';

const sanitizeMessage = (message: string, maxLength: number) => {
 	let sanitized = message
 		.trim()
 		.split('\n')[0] // Take only the first line
 		.replace(/(\w)\.$/, '$1')
 		.replace(/^["'`]|["'`]$/g, '') // Remove surrounding quotes
 		.replace(/^<[^>]*>\s*/, ''); // Remove leading tags

 	if (sanitized.length <= maxLength) {
 		return sanitized;
 	}

 	// Find the last space before maxLength to avoid truncating in the middle of a word
 	const lastSpaceIndex = sanitized.lastIndexOf(' ', maxLength);
 	if (lastSpaceIndex > 0) {
 		return sanitized.substring(0, lastSpaceIndex);
 	}

 	// If no space found, truncate at maxLength (for very long words)
 	return sanitized.substring(0, maxLength);
};

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

export const generateCommitMessage = async (
	baseUrl: string,
	apiKey: string,
	model: string,
	locale: string,
	diff: string,
	completions: number,
	maxLength: number,
	type: CommitType,
	timeout: number
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
				system: generatePrompt(locale, maxLength, type),
				prompt: diff,
				temperature: 0.4,
				maxRetries: 2,
			}).finally(() => clearTimeout(timeoutId))
		);
		const results = await Promise.all(promises);
		const texts = results.map((r) => r.text);
		const messages = deduplicateMessages(
			texts.map((text: string) => sanitizeMessage(text, maxLength))
		);
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
	timeout: number
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
		});

		clearTimeout(timeoutId);

		const combinedMessage = sanitizeMessage(result.text, maxLength);

		return { messages: [combinedMessage], usage: result.usage };
	} catch (error) {
		const errorAsAny = error as any;

		console.log(errorAsAny);

		throw errorAsAny;
	}
};
