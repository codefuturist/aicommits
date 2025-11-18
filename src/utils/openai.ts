import https from 'https';
import type { ClientRequest, IncomingMessage } from 'http';
import type {
	ChatCompletionCreateParams,
	ChatCompletion,
} from 'openai/resources/chat/completions';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { KnownError } from './error.js';
import type { CommitType } from './config.js';
import { generatePrompt } from './prompt.js';

const httpsPost = async (
	hostname: string,
	path: string,
	headers: Record<string, string>,
	json: unknown,
	timeout: number,
	proxy?: string
) =>
	new Promise<{
		request: ClientRequest;
		response: IncomingMessage;
		data: string;
	}>((resolve, reject) => {
		const postContent = JSON.stringify(json);
		const request = https.request(
			{
				port: 443,
				hostname,
				path,
				method: 'POST',
				headers: {
					...headers,
					'Content-Type': 'application/json',
					'Content-Length': String(Buffer.byteLength(postContent)),
				},
				timeout,
				agent: proxy ? (new HttpsProxyAgent(proxy) as any) : undefined,
			},
			(response) => {
				const body: Buffer[] = [];
				response.on('data', (chunk) => body.push(chunk));
				response.on('end', () => {
					resolve({
						request,
						response,
						data: Buffer.concat(body).toString(),
					});
				});
			}
		);
		request.on('error', reject);
		request.on('timeout', () => {
			request.destroy();
			reject(
				new KnownError(
					`Time out error: request took over ${timeout}ms. Try increasing the \`timeout\` config, or checking the OpenAI API status https://status.openai.com`
				)
			);
		});

		request.write(postContent);
		request.end();
	});

const createChatCompletion = async (
	hostname: string,
	apiKey: string,
	json: ChatCompletionCreateParams,
	timeout: number,
	proxy?: string
) => {
	const { response, data } = await httpsPost(
		hostname,
		'/v1/chat/completions',
		{
			Authorization: `Bearer ${apiKey}`,
		},
		json,
		timeout,
		proxy
	);

	if (
		!response.statusCode ||
		response.statusCode < 200 ||
		response.statusCode > 299
	) {
		let errorMessage = `OpenAI API Error: ${response.statusCode} - ${response.statusMessage}`;

		if (data) {
			errorMessage += `\n\n${data}`;
		}

		if (response.statusCode === 500) {
			errorMessage += '\n\nCheck the API status: https://status.openai.com';
		}

		throw new KnownError(errorMessage);
	}

	return JSON.parse(data) as ChatCompletion;
};

const sanitizeMessage = (message: string) =>
	message
		.trim()
		.replace(/[\n\r]/g, '')
		.replace(/(\w)\.$/, '$1')
		.replace(/^["'`]|["'`]$/g, ''); // Remove surrounding quotes

const deduplicateMessages = (array: string[]) => Array.from(new Set(array));

export const generateCommitMessage = async (
	hostname: string,
	apiKey: string,
	model: string,
	locale: string,
	diff: string,
	completions: number,
	maxLength: number,
	type: CommitType,
	timeout: number,
	proxy?: string
) => {
	if (process.env.DEBUG) {
		console.log('Diff being sent to AI:');
		console.log(diff);
	}
	try {
		const completion = await createChatCompletion(
			hostname,
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
			timeout,
			proxy
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
