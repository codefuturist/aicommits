import fs from 'fs/promises';
import path from 'path';
import ini from 'ini';
import { existsSync, mkdirSync } from 'fs';
import { fileExists } from './fs.js';
import { KnownError } from './error.js';
import {
	configParsers,
	hasOwn,
	type ValidConfig,
	type ConfigKeys,
	type RawConfig,
} from './config-types.js';
import { providers } from '../feature/providers/providers-data.js';
import {
	resolveConfigPath,
	getProjectConfigPath,
	getSystemConfigPaths,
	isUsingLegacyConfig,
} from './paths.js';

const getDefaultBaseUrl = (): string => {
	const openaiProvider = providers.find((p) => p.name === 'openai');
	return openaiProvider?.baseUrl || '';
};

const detectProvider = (
	baseUrl?: string,
	apiKey?: string
): string | undefined => {
	if (baseUrl) {
		const matchingProvider = providers.find(
			(p) =>
				p.baseUrl === baseUrl ||
				(p.name === 'ollama' && baseUrl.startsWith(p.baseUrl.slice(0, -3))) ||
				(p.name === 'copilot' && baseUrl.includes('models.github.ai')) ||
				(p.name === 'mistral' && baseUrl.includes('api.mistral.ai'))
		);
		if (matchingProvider) {
			return matchingProvider.name;
		} else {
			return 'custom';
		}
	} else if (apiKey) {
		return 'openai';
	}
};

const getConfigPath = () => resolveConfigPath();

/** Keys that should never be stored in per-project config files */
const SENSITIVE_KEYS = new Set<string>([
	'OPENAI_API_KEY',
	'TOGETHER_API_KEY',
	'api-key',
]);

const readConfigFile = async (): Promise<RawConfig> => {
	const configPath = getConfigPath();
	const configExists = await fileExists(configPath);
	if (!configExists) {
		return Object.create(null);
	}

	const configString = await fs.readFile(configPath, 'utf8');
	return ini.parse(configString);
};

/** Read project-level .aicommits from the git root (if it exists) */
const readProjectConfig = async (): Promise<RawConfig> => {
	const projectPath = getProjectConfigPath();
	if (!projectPath) return Object.create(null);

	const configString = await fs.readFile(projectPath, 'utf8');
	const raw = ini.parse(configString);

	// Strip sensitive keys from project config — they belong in user config only
	for (const key of SENSITIVE_KEYS) {
		delete raw[key as keyof typeof raw];
	}
	return raw;
};

/** Read system-wide config from $XDG_CONFIG_DIRS/aicommits/config */
const readSystemConfig = async (): Promise<RawConfig> => {
	for (const sysPath of getSystemConfigPaths()) {
		if (await fileExists(sysPath)) {
			const configString = await fs.readFile(sysPath, 'utf8');
			return ini.parse(configString);
		}
	}
	return Object.create(null);
};

export const getConfig = async (
	cliConfig?: RawConfig,
	envConfig?: RawConfig,
	suppressErrors?: boolean
): Promise<ValidConfig> => {
	// Precedence: CLI flags > env vars > project config > user config > system config
	const systemConfig = await readSystemConfig();
	const userConfig = await readConfigFile();
	const projectConfig = await readProjectConfig();
	const config = { ...systemConfig, ...userConfig, ...projectConfig };

	// Show one-time migration hint (stderr, non-blocking)
	if (isUsingLegacyConfig() && !process.env.AICOMMITS_QUIET) {
		const xdgPath = resolveConfigPath();
		if (xdgPath.includes('.aicommits') && !process.env._AICOMMITS_LEGACY_HINT_SHOWN) {
			process.env._AICOMMITS_LEGACY_HINT_SHOWN = '1';
			console.error(
				`ℹ Config at ~/.aicommits (legacy). Run 'aicommits config migrate' to move to XDG path.`,
			);
		}
	}

	// Check for deprecated config properties
	if (hasOwn(config, 'proxy')) {
		console.warn('The "proxy" config property is deprecated and no longer supported');
	}

	const parsedConfig: Record<string, unknown> = {};
	const effectiveEnvConfig = envConfig ?? {};

	for (const key of Object.keys(configParsers) as ConfigKeys[]) {
		const parser = configParsers[key];
		const value = cliConfig?.[key] ?? effectiveEnvConfig?.[key] ?? config[key];

		if (suppressErrors) {
			try {
				parsedConfig[key] = parser(value);
			} catch {}
		} else {
			parsedConfig[key] = parser(value);
		}
	}

	// Detect provider from OPENAI_BASE_URL or default to OpenAI if only API key is set
	let provider: string | undefined;
	let baseUrl = parsedConfig.OPENAI_BASE_URL as string | undefined;
	const apiKey = parsedConfig.OPENAI_API_KEY as string | undefined;

	// If only API key is provided without base URL, default to OpenAI
	if (!baseUrl && apiKey) {
		baseUrl = getDefaultBaseUrl();
		parsedConfig.OPENAI_BASE_URL = baseUrl;
	}

	provider = detectProvider(baseUrl, apiKey);

	return { ...parsedConfig, model: parsedConfig.OPENAI_MODEL, provider } as ValidConfig;
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

	const configPath = getConfigPath();
	const configDir = path.dirname(configPath);
	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
	}
	await fs.writeFile(configPath, ini.stringify(config), 'utf8');
};
