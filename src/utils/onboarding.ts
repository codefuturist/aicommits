import { execa } from 'execa';
import { select, confirm, password, outro, isCancel } from '@clack/prompts';
import { setConfigs } from './config.js';

const openUrl = (url: string) => {
	const { platform } = process;
	const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
	execa(cmd, [url]);
};

export default async (): Promise<{ keyName: string; key: string } | null> => {
	const provider = await select({
		message: 'Choose your AI provider:',
		options: [
			{ label: 'TogetherAI (recommended)', value: 'togetherai' },
			{ label: 'OpenAI', value: 'openai' },
		],
	});

	if (isCancel(provider)) {
		outro('Setup cancelled');
		return null;
	}

	const hasKey = await confirm({
		message: `Do you already have an API key for ${provider === 'togetherai' ? 'TogetherAI' : 'OpenAI'}?`,
	});

	if (isCancel(hasKey)) {
		outro('Setup cancelled');
		return null;
	}

	let keyResult;
	if (hasKey) {
		keyResult = await password({
			message: 'Enter your API key:',
			validate: (value) => {
				if (!value) return 'API key is required';
				if (provider === 'openai' && !value.startsWith('sk-')) return 'OpenAI key must start with "sk-"';
				return;
			},
		});
	} else {
		if (provider === 'togetherai') {
			console.log('Opening browser to sign up for TogetherAI...');
			openUrl('https://api.together.ai/');
		} else {
			console.log('Get your API key from: https://platform.openai.com/account/api-keys');
		}
		keyResult = await password({
			message: 'Paste or enter your API key:',
			validate: (value) => {
				if (!value) return 'API key is required';
				if (provider === 'openai' && !value.startsWith('sk-')) return 'OpenAI key must start with "sk-"';
				return;
			},
		});
	}

	if (isCancel(keyResult)) {
		outro('Setup cancelled');
		return null;
	}

	const key = keyResult as string;
	const keyName = provider === 'openai' ? 'OPENAI_KEY' : 'TOGETHER_API_KEY';
	await setConfigs([[keyName, key]]);
	return { keyName, key };
};