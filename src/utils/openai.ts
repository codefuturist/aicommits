import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { KnownError } from './error.js';
import type { CommitType } from './config-types.js';
import { generatePrompt } from './prompt.js';
import { sleep } from './commit-helpers.js';

const sanitizeMessage = (message: string, maxLength: number) => {
	let sanitized = message
		.trim()
		.split('\n')[0] // Take only the first line
		.replace(/(\w)\.$/, '$1')
		.replace(/^["'`]|["'`]$/g, '') // Remove surrounding quotes
		.substring(0, maxLength);

	return sanitized;
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

	const attempts = 3;
	const delay = 2000;

	for (let i = 0; i < attempts; i++) {
		try {
			const provider =
				baseUrl === 'https://api.openai.com/v1'
					? createOpenAI({ apiKey })
					: createOpenAICompatible({
							name: 'custom',
							apiKey,
							baseURL: baseUrl,
					  });

			const promises = Array.from({ length: completions }, () =>
				generateText({
					model: provider(model),
					system: generatePrompt(locale, maxLength, type),
					prompt: diff,
					temperature: 0.4,
				})
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

			// For other errors, retry if not the last attempt
			if (i === attempts - 1) {
				throw errorAsAny;
			}
			await sleep(delay);
		}
	}
	throw new Error('Retry failed');
};
