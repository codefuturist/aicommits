import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ini from 'ini';
import { fileExists } from './fs.js';
import { KnownError } from './error.js';

const commitTypes = ['', 'conventional', 'gitmoji'] as const;

export type CommitType = (typeof commitTypes)[number];

const { hasOwnProperty } = Object.prototype;
export const hasOwn = (object: unknown, key: PropertyKey) =>
	hasOwnProperty.call(object, key);

const parseAssert = (name: string, condition: boolean, message: string) => {
	if (!condition) {
		throw new KnownError(`Invalid config property ${name}: ${message}`);
	}
};

const configParsers = {
	OPENAI_API_KEY(key?: string) {
		return key;
	},
	OPENAI_BASE_URL(key?: string) {
		return key;
	},
	OPENAI_MODEL(key?: string) {
		return key || '';
	},
	locale(locale?: string) {
		if (!locale) {
			return 'en';
		}
		parseAssert('locale', !!locale, 'Cannot be empty');
		parseAssert(
			'locale',
			/^[a-z-]+$/i.test(locale),
			'Must be a valid locale (letters and dashes/underscores).'
		);
		return locale;
	},
	generate(count?: string) {
		if (!count) {
			return 1;
		}
		parseAssert('generate', /^\d+$/.test(count), 'Must be an integer');
		const parsed = Number(count);
		parseAssert('generate', parsed > 0, 'Must be greater than 0');
		parseAssert('generate', parsed <= 5, 'Must be less or equal to 5');
		return parsed;
	},
	type(type?: string) {
		if (!type) {
			return '';
		}
		parseAssert(
			'type',
			commitTypes.includes(type as CommitType),
			'Invalid commit type'
		);
		return type as CommitType;
	},
	proxy(url?: string) {
		if (!url || url.length === 0) {
			return undefined;
		}
		throw new KnownError('The "proxy" config property is deprecated and no longer supported.');
	},
	timeout(timeout?: string) {
		if (!timeout) {
			return undefined;
		}

		parseAssert('timeout', /^\d+$/.test(timeout), 'Must be an integer');

		const parsed = Number(timeout);
		parseAssert('timeout', parsed >= 500, 'Must be greater than 500ms');

		return parsed;
	},
	'max-length'(maxLength?: string) {
		if (!maxLength) {
			return 72;
		}
		parseAssert('max-length', /^\d+$/.test(maxLength), 'Must be an integer');
		const parsed = Number(maxLength);
		parseAssert(
			'max-length',
			parsed >= 20,
			'Must be greater than 20 characters'
		);
		return parsed;
	},
} as const;

type ConfigKeys = keyof typeof configParsers;

type RawConfig = {
	[key in ConfigKeys]?: string;
};

export type ValidConfig = {
	[Key in ConfigKeys]: ReturnType<(typeof configParsers)[Key]>;
} & {
	OPENAI_API_KEY: string | undefined;
	OPENAI_BASE_URL: string | undefined;
	OPENAI_MODEL: string;
	model: string | undefined;
	provider: string | undefined;
	timeout: number | undefined;
};

const getConfigPath = () => path.join(os.homedir(), '.aicommits');

const readConfigFile = async (): Promise<RawConfig> => {
	const configExists = await fileExists(getConfigPath());
	if (!configExists) {
		return Object.create(null);
	}

	const configString = await fs.readFile(getConfigPath(), 'utf8');
	return ini.parse(configString);
};

export const getConfig = async (
	cliConfig?: RawConfig,
	suppressErrors?: boolean
): Promise<ValidConfig> => {
	const config = await readConfigFile();
	const parsedConfig: Record<string, unknown> = {};

	for (const key of Object.keys(configParsers) as ConfigKeys[]) {
		const parser = configParsers[key];
		const value = cliConfig?.[key] ?? config[key];

		if (suppressErrors) {
			try {
				parsedConfig[key] = parser(value);
			} catch {}
		} else {
			parsedConfig[key] = parser(value);
		}
	}

	// Detect provider from OPENAI_BASE_URL
	let provider: string | undefined;
	const baseUrl = parsedConfig.OPENAI_BASE_URL as string | undefined;
	if (baseUrl) {
		if (baseUrl === 'https://api.openai.com') {
			provider = 'openai';
		} else if (baseUrl === 'https://api.together.xyz') {
			provider = 'togetherai';
		} else if (baseUrl.startsWith('http://localhost:11434')) {
			provider = 'ollama';
		} else {
			provider = 'custom';
		}
	}

	return { ...parsedConfig, provider } as ValidConfig;
};

export const setConfigs = async (keyValues: [key: string, value: string][]) => {
	const config = await readConfigFile();

	for (const [key, value] of keyValues) {
		if (!hasOwn(configParsers, key)) {
			throw new KnownError(`Invalid config property: ${key}`);
		}

		if (value === '') {
			delete config[key as ConfigKeys];
		} else {
			const parsed = configParsers[key as ConfigKeys](value);
			config[key as ConfigKeys] = parsed as any;
		}
	}

	await fs.writeFile(getConfigPath(), ini.stringify(config), 'utf8');
};

export const getProviderInfo = (config: ValidConfig) => {
	let provider: string;
	let hostname: string;
	let apiKey: string;

	// Auto-detect provider from OPENAI_BASE_URL
	const baseUrl = config.OPENAI_BASE_URL;
	if (baseUrl === 'https://api.openai.com') {
		provider = 'openai';
		hostname = 'api.openai.com';
		apiKey = config.OPENAI_API_KEY || '';
		if (!apiKey) {
			throw new KnownError('Please set OPENAI_API_KEY for OpenAI provider');
		}
	} else if (baseUrl === 'https://api.together.xyz') {
		provider = 'togetherai';
		hostname = 'api.together.xyz';
		apiKey = config.OPENAI_API_KEY || '';
		if (!apiKey) {
			throw new KnownError('Please set OPENAI_API_KEY for Together AI provider');
		}
	} else if (baseUrl && baseUrl.startsWith('http://localhost:11434')) {
		provider = 'ollama';
		hostname = 'localhost:11434';
		apiKey = '';
	} else if (baseUrl) {
		provider = 'custom';
		hostname = baseUrl.replace(/^https?:\/\//, '');
		apiKey = config.OPENAI_API_KEY || '';
		if (!apiKey) {
			throw new KnownError('Please set OPENAI_API_KEY for custom provider');
		}
	} else {
		throw new KnownError(
			'Please configure an AI provider. Run `aicommits setup` or set environment variables (OPENAI_API_KEY, OPENAI_BASE_URL, etc.)'
		);
	}

	return { provider, hostname, apiKey };
};
