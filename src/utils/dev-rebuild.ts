import { execSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { yellow, dim, green, bold } from 'kolorist';
import {
	checkBuildFreshness,
	getProjectRootPath,
	detectProjectType,
} from './build-freshness.js';
import { resolveConfigPath } from './paths.js';

interface RebuildOptions {
	force?: boolean;
}

function loadAutoRebuildConfig(): 'prompt' | 'auto' | 'off' {
	try {
		const configPath = resolveConfigPath();
		if (!existsSync(configPath)) return 'prompt';

		const raw = readFileSync(configPath, 'utf8');
		const match = raw.match(/^auto-rebuild\s*=\s*(.+)$/m);
		if (!match) return 'prompt';

		const val = match[1].trim().toLowerCase();
		if (val === 'auto' || val === 'off') return val;
		return 'prompt';
	} catch {
		return 'prompt';
	}
}

function loadConfigOverrides(): { buildCommand?: string; sourceDir?: string } {
	try {
		const configPath = resolveConfigPath();
		if (!existsSync(configPath)) return {};

		const raw = readFileSync(configPath, 'utf8');
		const cmdMatch = raw.match(/^rebuild-command\s*=\s*(.+)$/m);
		const dirMatch = raw.match(/^rebuild-source-dir\s*=\s*(.+)$/m);

		return {
			buildCommand: cmdMatch?.[1]?.trim() || undefined,
			sourceDir: dirMatch?.[1]?.trim() || undefined,
		};
	} catch {
		return {};
	}
}

export function checkAndRebuildIfStale(options: RebuildOptions = {}): void {
	// Skip in CI/test environments
	if (process.env.CI || process.env.VITEST || process.env.NODE_ENV === 'test') return;

	const { force = false } = options;
	const overrides = loadConfigOverrides();
	const freshness = checkBuildFreshness(overrides.sourceDir);

	if (freshness.fresh && !force) return;

	const mode = loadAutoRebuildConfig();
	if (mode === 'off' && !force) {
		// Just warn
		console.log(`${yellow('⚠')} ${freshness.reason}`);
		return;
	}

	const projectRoot = getProjectRootPath();
	const projectType = detectProjectType(projectRoot);
	const buildCommand = overrides.buildCommand || projectType?.buildCommand || 'npm run build';

	// Show stale info
	console.log(`${yellow('⚠')} ${bold(freshness.reason)}`);
	if (projectType) {
		console.log(`  ${dim(`Project: ${projectType.name}`)}`);
	}
	if (freshness.meta) {
		console.log(`  ${dim(`Built: ${freshness.meta.gitCommit} (${freshness.meta.builtAt})`)}`);
	}

	if (mode === 'auto' || force) {
		// Auto-rebuild without prompting
		rebuild(buildCommand, projectRoot);
		return;
	}

	// prompt mode — synchronous prompt since we're in top-level init
	if (process.stdout.isTTY && process.stdin.isTTY) {
		try {
			const result = execSync(
				'printf "? Rebuild now? [Y/n/a(lways)] " >&2 && read -r answer && echo "$answer"',
				{ encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] },
			).trim().toLowerCase();

			if (result === 'a' || result === 'always') {
				// Set auto-rebuild=auto in config
				try {
					const configPath = resolveConfigPath();
					const configDir = dirname(configPath);
					if (!existsSync(configDir)) {
						mkdirSync(configDir, { recursive: true });
					}
					let content = '';
					try { content = readFileSync(configPath, 'utf8'); } catch { /* empty */ }

					if (content.match(/^auto-rebuild\s*=/m)) {
						content = content.replace(/^auto-rebuild\s*=.*/m, 'auto-rebuild=auto');
					} else {
						content += '\nauto-rebuild=auto';
					}
					writeFileSync(configPath, content);
					console.log(dim(`  Set auto-rebuild=auto in ${configPath}`));
				} catch { /* ignore config write failure */ }
				rebuild(buildCommand, projectRoot);
			} else if (result === '' || result === 'y' || result === 'yes') {
				rebuild(buildCommand, projectRoot);
			} else {
				console.log(dim('  Continuing with stale build...'));
			}
		} catch {
			// User cancelled or non-interactive — continue with stale build
			console.log(dim('  Continuing with stale build...'));
		}
	} else {
		// Non-TTY: just warn
		console.log(dim('  Run `aicommits rebuild` to rebuild'));
	}
}

function rebuild(buildCommand: string, projectRoot: string): void {
	console.log(dim(`  Running: ${buildCommand}`));
	try {
		execSync(buildCommand, {
			cwd: projectRoot,
			stdio: 'pipe',
			encoding: 'utf8',
		});
		console.log(`${green('✓')} Rebuilt successfully`);

		// Re-exec with fresh binary
		const args = process.argv.slice(1);
		execSync(
			`"${process.execPath}" ${args.map((a) => `"${a}"`).join(' ')}`,
			{ stdio: 'inherit', cwd: process.cwd() },
		);
		process.exit(0);
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		console.log(`${yellow('⚠')} Rebuild failed — continuing with stale build`);
		if (process.env.DEBUG || process.env.AICOMMITS_DEBUG) {
			console.error(dim(msg));
		}
	}
}
