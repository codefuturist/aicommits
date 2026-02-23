import path from 'path';
import os from 'os';
import { existsSync } from 'fs';

const APP_NAME = 'aicommits';

// --- XDG helpers ---

function xdgConfigHome(): string {
	const env = process.env.XDG_CONFIG_HOME;
	if (env && path.isAbsolute(env)) return env;
	return path.join(os.homedir(), '.config');
}

function xdgCacheHome(): string {
	const env = process.env.XDG_CACHE_HOME;
	if (env && path.isAbsolute(env)) return env;
	return path.join(os.homedir(), '.cache');
}

function xdgConfigDirs(): string[] {
	const env = process.env.XDG_CONFIG_DIRS;
	if (env) {
		return env
			.split(':')
			.filter((d) => d && path.isAbsolute(d));
	}
	return ['/etc/xdg'];
}

// --- Public API ---

/** Directory for user-level config: $XDG_CONFIG_HOME/aicommits */
export function getConfigDir(): string {
	return path.join(xdgConfigHome(), APP_NAME);
}

/** User-level config file: $XDG_CONFIG_HOME/aicommits/config */
export function getConfigFilePath(): string {
	return path.join(getConfigDir(), 'config');
}

/** Legacy config file: ~/.aicommits */
export function getLegacyConfigPath(): string {
	return path.join(os.homedir(), `.${APP_NAME}`);
}

/** System-wide config search paths: $XDG_CONFIG_DIRS/aicommits/config */
export function getSystemConfigPaths(): string[] {
	return xdgConfigDirs().map((dir) => path.join(dir, APP_NAME, 'config'));
}

/** Cache directory: $XDG_CACHE_HOME/aicommits */
export function getCacheDir(): string {
	return path.join(xdgCacheHome(), APP_NAME);
}

/**
 * Project-level config: .aicommits in the git repo root.
 * Returns null if not in a git repo or file doesn't exist.
 */
export function getProjectConfigPath(gitRoot?: string): string | null {
	const root = gitRoot || findGitRootSync();
	if (!root) return null;

	const projectConfig = path.join(root, `.${APP_NAME}`);
	return existsSync(projectConfig) ? projectConfig : null;
}

/**
 * Resolve the effective user config file path.
 * Priority: $AICOMMITS_CONFIG > XDG path > legacy ~/.aicommits (fallback)
 *
 * If neither XDG nor legacy exists, returns the XDG path (for new installs).
 */
export function resolveConfigPath(): string {
	// 1. Env var override
	const envOverride = process.env.AICOMMITS_CONFIG;
	if (envOverride && path.isAbsolute(envOverride)) {
		return envOverride;
	}

	// 2. XDG path takes precedence if it exists
	const xdgPath = getConfigFilePath();
	if (existsSync(xdgPath)) {
		return xdgPath;
	}

	// 3. Legacy fallback
	const legacyPath = getLegacyConfigPath();
	if (existsSync(legacyPath)) {
		return legacyPath;
	}

	// 4. Default to XDG for new installs
	return xdgPath;
}

/**
 * Check whether the config is currently at the legacy location.
 */
export function isUsingLegacyConfig(): boolean {
	const resolved = resolveConfigPath();
	return resolved === getLegacyConfigPath();
}

// --- Internal helpers ---

function findGitRootSync(): string | null {
	try {
		const { execSync } = require('child_process');
		return execSync('git rev-parse --show-toplevel', {
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe'],
		}).trim();
	} catch {
		return null;
	}
}
