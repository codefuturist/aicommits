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
		if (key) {
			parseAssert('OPENAI_API_KEY', key.startsWith('sk-'), 'Must start with "sk-"');
			// Key can range from 43~51 characters. There's no spec to assert this.
		}
		return key;
	},
	TOGETHER_API_KEY(key?: string) {
		if (key) {
			parseAssert('TOGETHER_API_KEY', key.startsWith('tgp_'), 'Must start with "tgp_"');
		}
		return key;
	},
	'api-key'(key?: string) {
		return key;
	},
	'openai-base-url'(key?: string) {
		return key;
	},
	provider(key?: string) {
		if (!key) {
			return undefined;
		}
		const validProviders = ['openai', 'togetherai', 'ollama', 'custom'];
		parseAssert('provider', validProviders.includes(key), `Must be one of: ${validProviders.join(', ')}`);
		return key;
	},
	endpoint(key?: string) {
		if (!key || key.length === 0) {
			return undefined;
		}

		parseAssert('endpoint', /^https?:\/\//.test(key), 'Must be a valid URL');

		return key;
	},
	locale(locale?: string) {
		if (!locale) {
			return 'en';
		}

		parseAssert('locale', !!locale, 'Cannot be empty');
		parseAssert(
			'locale',
			/^[a-z-]+$/i.test(locale),
			'Must be a valid locale (letters and dashes/underscores). You can consult the list of codes in: https://wikipedia.org/wiki/List_of_ISO_639-1_codes'
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

		parseAssert('proxy', /^https?:\/\//.test(url), 'Must be a valid URL');

		return url;
	},
	model(model?: string) {
		if (!model || model.length === 0) {
			return 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
		}

		return model;
	},
	'openai-model'(model?: string) {
		if (!model || model.length === 0) {
			return 'gpt-5-mini';
		}

		return model;
	},
	'together-model'(model?: string) {
		if (!model || model.length === 0) {
			return 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
		}

		return model;
	},
	timeout(timeout?: string) {
		if (!timeout) {
			return 10_000;
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
	'openai-model': string;
	'together-model': string;
	endpoint: string | undefined;
	'openai-base-url': string | undefined;
	provider: string | undefined;
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

	return parsedConfig as ValidConfig;
};

export const setConfigs = async (keyValues: [key: string, value: string][]) => {
	const config = await readConfigFile();

	for (const [key, value] of keyValues) {
		if (!hasOwn(configParsers, key)) {
			throw new KnownError(`Invalid config property: ${key}`);
		}

		const parsed = configParsers[key as ConfigKeys](value);
		config[key as ConfigKeys] = parsed as any;
	}

	await fs.writeFile(getConfigPath(), ini.stringify(config), 'utf8');
};

export const getProviderInfo = (config: ValidConfig) => {
	let provider: string;
	let hostname: string;
	let apiKey: string;

	// Priority: Explicit provider setting > Environment variables > Auto-detection
	if (config.provider) {
		provider = config.provider;

		// Set provider-specific defaults based on explicit provider choice
		if (provider === 'openai') {
			hostname = config['openai-base-url'] ? config['openai-base-url'].replace(/^https?:\/\//, '') : 'api.openai.com';
			apiKey = config.OPENAI_API_KEY || '';
			if (!apiKey) {
				throw new KnownError('Please set OPENAI_API_KEY for OpenAI provider');
			}
		} else if (provider === 'togetherai') {
			hostname = 'api.together.xyz';
			apiKey = config.TOGETHER_API_KEY || '';
			if (!apiKey) {
				throw new KnownError('Please set TOGETHER_API_KEY for Together AI provider');
			}
		} else if (provider === 'ollama') {
			hostname = config.endpoint ? config.endpoint.replace(/^https?:\/\//, '') : 'localhost:11434';
			apiKey = config['api-key'] || '';
		} else if (provider === 'custom') {
			if (!config.endpoint) {
				throw new KnownError('Please set endpoint for custom provider');
			}
			hostname = config.endpoint.replace(/^https?:\/\//, '');
			apiKey = config['api-key'] || '';
			if (!apiKey) {
				throw new KnownError('Please set api-key for custom provider');
			}
		} else {
			throw new KnownError(`Unknown provider: ${provider}`);
		}
	} else {
		// Fallback to auto-detection for backward compatibility
		if (config['openai-base-url']) {
			provider = 'openai-compatible';
			hostname = config['openai-base-url'].replace(/^https?:\/\//, '');
			apiKey = config.OPENAI_API_KEY || config['api-key'] || '';
			if (!apiKey) {
				throw new KnownError(
					'Please set OPENAI_API_KEY or api-key for custom endpoint'
				);
			}
		} else if (config.endpoint) {
			provider = 'custom';
			hostname = config.endpoint.replace(/^https?:\/\//, '');
			apiKey = config['api-key'] || '';
			if (!apiKey) {
				throw new KnownError(
					'Please set your api-key via `aicommits config set api-key=<your token>`'
				);
			}
		} else if (config.OPENAI_API_KEY) {
			provider = 'openai';
			hostname = 'api.openai.com';
			apiKey = config.OPENAI_API_KEY;
		} else if (config.TOGETHER_API_KEY) {
			provider = 'togetherai';
			hostname = 'api.together.xyz';
			apiKey = config.TOGETHER_API_KEY;
		} else {
			throw new KnownError(
				'Please configure an AI provider. Run `aicommits setup` or set environment variables (OPENAI_API_KEY, etc.)'
			);
		}
	}

	return { provider, hostname, apiKey };
};
