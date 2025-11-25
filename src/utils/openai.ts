import OpenAI from 'openai';
import type {
	ChatCompletionCreateParams,
	ChatCompletion,
} from 'openai/resources/chat/completions';
import { KnownError } from './error.js';
import type { CommitType } from './config-types.js';
import { generatePrompt } from './prompt.js';

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
		return deduplicateMessages(
			validChoices.map((choice: ChatCompletion.Choice) =>
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

		if (errorAsAny.status === 429) {
			throw new KnownError(
				'You have exceeded your OpenAI API quota. Please check your plan and billing details at https://platform.openai.com/account/billing'
			);
		}

		throw errorAsAny;
	}
};
