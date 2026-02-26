import { KnownError } from './error.js';

const commitTypes = ['plain', 'conventional', 'gitmoji'] as const;

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
			return 'plain';
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
		throw new KnownError(
			'The "proxy" config property is deprecated and no longer supported.'
		);
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
	'post-commit'(command?: string) {
		if (!command || command.trim() === '') {
			return undefined;
		}
		return command.trim();
	},
	'auto-rebuild'(value?: string) {
		if (!value || value.trim() === '') return 'prompt' as const;
		const v = value.trim().toLowerCase();
		parseAssert('auto-rebuild', ['prompt', 'auto', 'off'].includes(v), 'Must be prompt, auto, or off');
		return v as 'prompt' | 'auto' | 'off';
	},
	'rebuild-command'(value?: string) {
		if (!value || value.trim() === '') return undefined;
		return value.trim();
	},
	'rebuild-source-dir'(value?: string) {
		if (!value || value.trim() === '') return undefined;
		return value.trim();
	},
	'post-commit-rebuild'(value?: string) {
		if (!value || value.trim() === '') return 'off' as const;
		const v = value.trim().toLowerCase();
		parseAssert('post-commit-rebuild', ['smart', 'always', 'off'].includes(v), 'Must be smart, always, or off');
		return v as 'smart' | 'always' | 'off';
	},
	'post-commit-install'(value?: string | boolean) {
		if (value === undefined || value === null) return false;
		if (typeof value === 'boolean') return value;
		const v = String(value).trim().toLowerCase();
		if (v === '') return false;
		return v === 'true' || v === '1' || v === 'yes';
	},
	'post-commit-branches'(value?: string) {
		if (!value || value.trim() === '') return undefined;
		return value.trim();
	},
	'post-commit-tag-pattern'(value?: string) {
		if (!value || value.trim() === '') return undefined;
		return value.trim();
	},
	scope(value?: string) {
		if (!value || value.trim() === '') return 'none';
		const v = value.trim().toLowerCase();
		if (v === 'none' || v === 'auto') return v as 'none' | 'auto';
		// Treat any other string as an explicit directory path (preserve original case)
		return value.trim();
	},
	'sync-strategy'(value?: string) {
		if (!value || value.trim() === '') return 'ask' as const;
		const v = value.trim().toLowerCase();
		parseAssert('sync-strategy', ['ask', 'merge', 'rebase'].includes(v), 'Must be ask, merge, or rebase');
		return v as 'ask' | 'merge' | 'rebase';
	},
	'sync-auto-stash'(value?: string | boolean) {
		if (value === undefined || value === null) return true;
		if (typeof value === 'boolean') return value;
		const v = String(value).trim().toLowerCase();
		if (v === '') return true;
		return v !== 'false' && v !== '0' && v !== 'no';
	},
	'sync-after-commit'(value?: string) {
		if (!value || value.trim() === '') return 'false' as const;
		const v = value.trim().toLowerCase();
		parseAssert('sync-after-commit', ['false', 'prompt'].includes(v), 'Must be false or prompt');
		return v as 'false' | 'prompt';
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
	model: string;
	provider: string | undefined;
	timeout: number | undefined;
};

export { configParsers, type ConfigKeys, type RawConfig };
