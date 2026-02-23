import * as vscode from 'vscode';
import { readFile, access, constants } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { AicommitsConfig, CommitType } from './types';

/**
 * Resolve the aicommits config file path (XDG-aware).
 * Checks: $AICOMMITS_CONFIG → XDG → legacy ~/.aicommits
 */
function resolveConfigPath(): string {
	const envPath = process.env['AICOMMITS_CONFIG'];
	if (envPath) { return envPath; }

	const xdgHome = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
	const xdgPath = join(xdgHome, 'aicommits', 'config');

	return xdgPath;
}

/** Minimal INI parser — handles key=value lines, ignores comments/sections. */
function parseIni(content: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';') || trimmed.startsWith('[')) {
			continue;
		}
		const eqIdx = trimmed.indexOf('=');
		if (eqIdx > 0) {
			const key = trimmed.slice(0, eqIdx).trim();
			const value = trimmed.slice(eqIdx + 1).trim();
			result[key] = value;
		}
	}
	return result;
}

/** Read the CLI's INI config file. Returns empty object if not found. */
async function readCliConfig(): Promise<Record<string, string>> {
	const configPath = resolveConfigPath();
	try {
		await access(configPath, constants.R_OK);
		const content = await readFile(configPath, 'utf-8');
		return parseIni(content);
	} catch {
		// Also try legacy path
		const legacyPath = join(homedir(), '.aicommits');
		try {
			await access(legacyPath, constants.R_OK);
			const content = await readFile(legacyPath, 'utf-8');
			return parseIni(content);
		} catch {
			return {};
		}
	}
}

/**
 * Load merged config: VS Code settings override CLI config file.
 * API key comes from SecretStorage first, then VS Code settings, then CLI config.
 */
export async function getConfig(
	secrets: vscode.SecretStorage,
): Promise<AicommitsConfig> {
	const cliConfig = await readCliConfig();
	const vsConfig = vscode.workspace.getConfiguration('aicommits');

	// API key: secrets → VS Code settings → CLI config
	const secretKey = await secrets.get('aicommits.apiKey');
	const apiKey = secretKey
		|| vsConfig.get<string>('apiKey', '')
		|| cliConfig['OPENAI_API_KEY']
		|| '';

	const baseUrl = vsConfig.get<string>('baseUrl', '')
		|| cliConfig['OPENAI_BASE_URL']
		|| 'https://api.openai.com/v1';

	const model = vsConfig.get<string>('model', '')
		|| cliConfig['OPENAI_MODEL']
		|| 'gpt-4o-mini';

	const type = (vsConfig.get<string>('commitType', '')
		|| cliConfig['type']
		|| 'conventional') as CommitType;

	const locale = vsConfig.get<string>('locale', '')
		|| cliConfig['locale']
		|| 'en';

	const maxLength = vsConfig.get<number>('maxLength', 0)
		|| parseInt(cliConfig['max-length'] || '72', 10)
		|| 72;

	const generateCount = vsConfig.get<number>('generateCount', 0)
		|| parseInt(cliConfig['generate'] || '1', 10)
		|| 1;

	const customPrompt = vsConfig.get<string>('customPrompt', '')
		|| cliConfig['custom-prompt']
		|| undefined;

	return { apiKey, baseUrl, model, type, locale, maxLength, generateCount, customPrompt };
}

/** Store the API key securely in VS Code's SecretStorage. */
export async function setApiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
	await secrets.store('aicommits.apiKey', key);
}

/** Delete the stored API key. */
export async function deleteApiKey(secrets: vscode.SecretStorage): Promise<void> {
	await secrets.delete('aicommits.apiKey');
}

/** Check if the extension has a valid API key from any source. */
export async function hasApiKey(secrets: vscode.SecretStorage): Promise<boolean> {
	const config = await getConfig(secrets);
	return config.apiKey.length > 0;
}
