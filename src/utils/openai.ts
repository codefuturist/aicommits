import OpenAI from 'openai';
import type {
	ChatCompletionCreateParams,
	ChatCompletion,
} from 'openai/resources/chat/completions';
import { KnownError } from './error.js';
import type { CommitType } from './config-types.js';
import { generatePrompt } from './prompt.js';
import { sleep } from './commit-helpers.js';

const createChatCompletion = async (
	baseUrl: string,
	apiKey: string,
	json: ChatCompletionCreateParams,
	timeout: number
) => {
	const openai = new OpenAI({
		baseURL: baseUrl,
		apiKey,
		timeout,
	});

	const completion = await openai.chat.completions.create(json);
	return completion;
};

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
			const completion = await createChatCompletion(
				baseUrl,
				apiKey,
				{
					model,
					messages: [
						{
							role: 'system',
							content: generatePrompt(locale, maxLength, type),
						},
						{
							role: 'user',
							content: diff,
						},
					],
					temperature: 0.4,
					max_tokens: 100,
					stream: false,
					n: completions,
				},
				timeout
			);

			const validChoices = (completion as ChatCompletion).choices.filter(
				(choice: ChatCompletion.Choice) => choice.message?.content
			);
			const messages = deduplicateMessages(
				validChoices.map((choice: ChatCompletion.Choice) =>
					sanitizeMessage(choice.message.content ?? '', maxLength)
				)
			);
			return { messages, usage: (completion as ChatCompletion).usage };
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
