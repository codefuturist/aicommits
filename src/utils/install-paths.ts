import { existsSync, accessSync, constants, readFileSync, realpathSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';

export type InstallScope = 'user' | 'system';

export interface InstallPaths {
	binDir: string;
	scope: InstallScope;
	needsSudo: boolean;
}

const BINARY_NAMES = ['aicommits', 'aic'] as const;

export function getBinaryNames(): readonly string[] {
	return BINARY_NAMES;
}

export function getDefaultInstallDir(scope: InstallScope): string {
	const os = platform();
	const home = process.env.HOME || process.env.USERPROFILE || '';

	if (os === 'win32') {
		const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
		return scope === 'user'
			? join(localAppData, 'Programs', 'aicommits')
			: join(process.env.ProgramFiles || 'C:\\Program Files', 'aicommits');
	}

	// macOS and Linux follow XDG / FHS conventions
	return scope === 'user'
		? join(home, '.local', 'bin')     // XDG spec: $HOME/.local/bin
		: '/usr/local/bin';               // FHS 3.0: local system binaries
}

export function isInPath(dir: string): boolean {
	const pathDirs = (process.env.PATH || '').split(':');
	const resolved = resolve(dir);
	return pathDirs.some((p) => resolve(p) === resolved);
}

export function checkWriteable(dir: string): boolean {
	try {
		accessSync(dir, constants.W_OK);
		return true;
	} catch {
		return false;
	}
}

export function getProjectEntrypoint(): string {
	const thisFile = fileURLToPath(import.meta.url);
	let dir = dirname(thisFile);
	for (let i = 0; i < 5; i++) {
		const candidate = join(dir, 'dist', 'cli.mjs');
		if (existsSync(candidate)) return candidate;
		dir = dirname(dir);
	}
	// Fallback: resolve from package root
	return join(dirname(dirname(fileURLToPath(import.meta.url))), '..', 'dist', 'cli.mjs');
}

export function getNodePath(): string {
	return process.execPath;
}

export function getShellWrapper(nodePath: string, entrypoint: string): string {
	const os = platform();

	if (os === 'win32') {
		// Windows batch script
		return [
			'@echo off',
			`"${nodePath}" "${entrypoint}" %*`,
			'',
		].join('\r\n');
	}

	// POSIX shell wrapper (macOS, Linux)
	return [
		'#!/usr/bin/env sh',
		`exec "${nodePath}" "${entrypoint}" "$@"`,
		'',
	].join('\n');
}

export function getPathHint(dir: string): string | null {
	if (isInPath(dir)) return null;

	const os = platform();
	if (os === 'win32') {
		return `Add to PATH: setx PATH "%PATH%;${dir}"`;
	}

	const shell = process.env.SHELL || '/bin/sh';
	const shellName = shell.split('/').pop();
	const exportLine = `export PATH="${dir}:$PATH"`;

	switch (shellName) {
		case 'zsh':
			return `Add to ~/.zshrc:\n  ${exportLine}`;
		case 'bash':
			return `Add to ~/.bashrc:\n  ${exportLine}`;
		case 'fish':
			return `Add to ~/.config/fish/config.fish:\n  fish_add_path ${dir}`;
		default:
			return `Add to your shell profile:\n  ${exportLine}`;
	}
}

export function findInstalledBinaries(): Array<{ name: string; path: string; scope: InstallScope }> {
	const home = process.env.HOME || process.env.USERPROFILE || '';
	const searchDirs: Array<{ dir: string; scope: InstallScope }> = [
		{ dir: join(home, '.local', 'bin'), scope: 'user' },
		{ dir: '/usr/local/bin', scope: 'system' },
	];

	if (platform() === 'win32') {
		const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
		searchDirs.unshift({ dir: join(localAppData, 'Programs', 'aicommits'), scope: 'user' });
	}

	const found: Array<{ name: string; path: string; scope: InstallScope }> = [];

	for (const { dir, scope } of searchDirs) {
		for (const name of BINARY_NAMES) {
			const binPath = join(dir, name);
			if (existsSync(binPath)) {
				found.push({ name, path: binPath, scope });
			}
		}
	}

	return found;
}

export interface BinaryLocation {
	name: string;
	path: string;
	realPath: string;        // resolved symlink/actual file
	isSymlink: boolean;
	isActive: boolean;       // first in PATH (the one that runs)
	source: string;          // e.g., "pnpm", "aicommits install", "npm", "unknown"
}

function classifyBinarySource(filePath: string): string {
	try {
		const content = readFileSync(filePath, 'utf8');
		if (content.includes('pnpm')) return 'pnpm global';
		if (content.includes('npm')) return 'npm global';
		if (content.includes('dist/cli.mjs')) return 'aicommits install';
		if (content.includes('yarn')) return 'yarn global';
		if (content.includes('bun')) return 'bun global';
	} catch { /* binary file or unreadable */ }

	// Check if it's a symlink into a package manager store
	try {
		const real = realpathSync(filePath);
		if (real.includes('.pnpm') || real.includes('pnpm')) return 'pnpm global';
		if (real.includes('.npm') || real.includes('npm')) return 'npm global';
		if (real.includes('.yarn') || real.includes('yarn')) return 'yarn global';
		if (real.includes('.bun') || real.includes('bun')) return 'bun global';
		if (real.includes('homebrew') || real.includes('Cellar')) return 'homebrew';
	} catch { /* broken symlink */ }

	return 'unknown';
}

export function findAllBinariesInPath(): Map<string, BinaryLocation[]> {
	const results = new Map<string, BinaryLocation[]>();
	const pathDirs = (process.env.PATH || '').split(':').filter(Boolean);

	for (const name of BINARY_NAMES) {
		const locations: BinaryLocation[] = [];
		const seen = new Set<string>();

		for (const dir of pathDirs) {
			const binPath = join(dir, name);
			if (!existsSync(binPath)) continue;

			// Deduplicate by resolved path
			let realPath: string;
			let isSymlink = false;
			try {
				realPath = realpathSync(binPath);
				isSymlink = realPath !== resolve(binPath);
			} catch {
				realPath = resolve(binPath);
			}

			if (seen.has(realPath)) continue;
			seen.add(realPath);

			locations.push({
				name,
				path: binPath,
				realPath,
				isSymlink,
				isActive: locations.length === 0, // first one wins
				source: classifyBinarySource(binPath),
			});
		}

		if (locations.length > 0) {
			results.set(name, locations);
		}
	}

	return results;
}

export function hasPathConflicts(): boolean {
	const all = findAllBinariesInPath();
	for (const [, locations] of all) {
		if (locations.length > 1) return true;
	}
	return false;
}
