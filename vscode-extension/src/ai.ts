import type { AicommitsConfig, GenerationResult } from './types';
import { generatePrompt } from './prompt';

/** Clean AI response: strip reasoning tags, quotes, take first line. */
export function sanitizeMessage(message: string): string {
	// Remove <think>...</think> reasoning blocks
	let cleaned = message.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
	// Take first line, strip trailing period, remove surrounding quotes/tags
	return cleaned
		.split('\n')[0]
		.replace(/(\w)\.$/, '$1')
		.replace(/^["'`]|["'`]$/g, '')
		.replace(/^<[^>]*>\s*/, '') // strip leading opening tag
		.replace(/<\/[^>]+>$/, '')  // strip trailing closing tag
		.trim();
}

/** Deduplicate messages. */
function deduplicate(messages: string[]): string[] {
	return [...new Set(messages)];
}

/**
 * Call an OpenAI-compatible chat completions API.
 * Uses native fetch (available in VS Code's Node.js runtime).
 */
async function callChatAPI(
	baseUrl: string,
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
	temperature = 0.4,
	maxTokens = 2000,
	signal?: AbortSignal,
): Promise<{ text: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
	const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt },
			],
			temperature,
			max_tokens: maxTokens,
		}),
		signal,
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		if (response.status === 401) {
			throw new Error('Invalid API key. Run "AI Commits: Setup" to configure.');
		}
		if (response.status === 429) {
			throw new Error('Rate limit exceeded. Please wait and try again.');
		}
		throw new Error(`API error ${response.status}: ${body.slice(0, 200)}`);
	}

	const data = await response.json() as {
		choices: Array<{ message: { content: string } }>;
		usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
	};

	const text = data.choices?.[0]?.message?.content || '';
	const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

	return { text, usage };
}

/**
 * Generate commit message(s) from a diff.
 * Mirrors the CLI's generateCommitMessage() logic.
 */
export async function generateCommitMessage(
	config: AicommitsConfig,
	diff: string,
	signal?: AbortSignal,
): Promise<GenerationResult> {
	const systemPrompt = generatePrompt(
		config.locale,
		config.maxLength,
		config.type,
		config.customPrompt,
	);

	// Generate N completions in parallel
	const promises = Array.from({ length: config.generateCount }, () =>
		callChatAPI(
			config.baseUrl,
			config.apiKey,
			config.model,
			systemPrompt,
			diff,
			0.4,
			2000,
			signal,
		),
	);

	const results = await Promise.all(promises);

	const messages = deduplicate(
		results.map(r => sanitizeMessage(r.text)),
	).filter(m => m.length > 0);

	const usage = {
		prompt_tokens: results.reduce((sum, r) => sum + r.usage.prompt_tokens, 0),
		completion_tokens: results.reduce((sum, r) => sum + r.usage.completion_tokens, 0),
		total_tokens: results.reduce((sum, r) => sum + r.usage.total_tokens, 0),
	};

	return { messages, usage };
}
