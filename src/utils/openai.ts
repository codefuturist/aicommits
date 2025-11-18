import type {
	ChatCompletionCreateParams,
	ChatCompletion,
} from 'openai/resources/chat/completions';
import { KnownError } from './error.js';
import type { CommitType } from './config.js';
import { generatePrompt } from './prompt.js';

const createChatCompletion = async (
	baseUrl: string,
	apiKey: string,
	json: ChatCompletionCreateParams,
	timeout: number
) => {
	const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(json),
		signal: AbortSignal.timeout(timeout),
	});

	if (!response.ok) {
		let errorMessage = `API Error: ${response.status} - ${response.statusText}`;

		const data = await response.text();
		if (data) {
			errorMessage += `\n\n${data}`;
		}

		if (response.status === 500) {
			errorMessage += '\n\nCheck the API provider\'s status page.';
		}

		throw new KnownError(errorMessage);
	}

	const data = await response.json();
	return data as ChatCompletion;
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

		const validChoices = completion.choices.filter(
			(choice) => choice.message?.content
		);
		return deduplicateMessages(
			validChoices.map((choice) =>
				sanitizeMessage(choice.message.content ?? '', maxLength)
			)
		);
	} catch (error) {
		const errorAsAny = error as any;
		if (errorAsAny.code === 'ENOTFOUND') {
			throw new KnownError(
				`Error connecting to ${errorAsAny.hostname} (${errorAsAny.syscall}). Are you connected to the internet?`
			);
		}

		throw errorAsAny;
	}
};
