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
			errorMessage += '\n\nCheck the API status: https://status.openai.com';
		}

		throw new KnownError(errorMessage);
	}

	const data = await response.json();
	return data as ChatCompletion;
};

const sanitizeMessage = (message: string) =>
	message
		.trim()
		.replace(/[\n\r]/g, '')
		.replace(/(\w)\.$/, '$1')
		.replace(/^["'`]|["'`]$/g, ''); // Remove surrounding quotes

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
				temperature: 0.7,
				top_p: 1,
				frequency_penalty: 0,
				presence_penalty: 0,
				max_tokens: 500,
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
				sanitizeMessage(choice.message.content ?? '')
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
