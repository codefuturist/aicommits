import { command } from 'cleye';
import { execSync } from 'child_process';
import fs from 'fs';
import { hasOwn } from '../utils/config-types.js';
import { getConfig, setConfigs } from '../utils/config-runtime.js';
import { KnownError, handleCommandError } from '../utils/error.js';
import {
	resolveConfigPath,
	getConfigFilePath,
	getConfigDir,
	getLegacyConfigPath,
	getProjectConfigPath,
	getSystemConfigPaths,
	getCacheDir,
} from '../utils/paths.js';
import { green, dim, yellow, bold } from 'kolorist';
import { intro, outro, select, text, confirm, note, log, isCancel } from '@clack/prompts';

export default command(
	{
		name: 'config',
		description: 'View or modify configuration settings',
		help: {
			description: `View or modify configuration settings

Modes:
  (none)   Show active config summary
  edit     Interactive config editor (TUI wizard)
  open     Open config file in $VISUAL / $EDITOR / system default
  get      Get a config value:   aicommits config get OPENAI_API_KEY
  set      Set a config value:   aicommits config set OPENAI_MODEL=gpt-4o
  info     Show all config sources and precedence
  migrate  Move legacy ~/.aicommits to XDG path (~/.config/aicommits/config)
  path     Print the resolved config file path

Common config keys:
  OPENAI_API_KEY          Your provider API key
  OPENAI_BASE_URL         Provider base URL (auto-set by setup)
  OPENAI_MODEL            Model to use (e.g. gpt-4o, openai/gpt-4.1)
  type                    Default commit format: plain | conventional | gitmoji
  locale                  Language for commit messages (e.g. en, de, fr)
  max-length              Max commit message length (default: 72)
  post-commit             Command to run after commit (e.g. "git push")
  post-commit-rebuild     Rebuild binary after commit: smart | always | off
  post-commit-install     Auto-install rebuilt binary: true | false
  post-commit-branches    Only rebuild on matching branches (glob, e.g. "main,release/*")
  auto-rebuild            Dev rebuild mode: prompt | auto | off`,
		},
		parameters: ['[mode]', '[key=value...]'],
	},
	(argv) => {
		(async () => {
			const [mode, ...keyValues] = argv._;

			// If no mode provided, show all current config
			if (!mode) {
				const config = await getConfig({}, {}, true);
				const configPath = resolveConfigPath();

				console.log(bold('Active config') + dim(` (${configPath})`));
				console.log('');

				// Provider section
				if (config.provider) console.log(`  Provider:              ${config.provider}`);
				if (config.OPENAI_API_KEY) console.log(`  API Key:               ${config.OPENAI_API_KEY.substring(0, 4)}****`);
				if (config.OPENAI_BASE_URL) console.log(`  Base URL:              ${config.OPENAI_BASE_URL}`);
				if (config.OPENAI_MODEL) console.log(`  Model:                 ${config.OPENAI_MODEL}`);

				// Commit format
				if (config.type) console.log(`  Commit type:           ${config.type}`);
				if (config.locale) console.log(`  Locale:                ${config.locale}`);
				if (config['max-length']) console.log(`  Max length:            ${config['max-length']}`);

				// Post-commit
				if (config['post-commit']) console.log(`  Post-commit:           ${config['post-commit']}`);
				if (config['post-commit-rebuild']) console.log(`  Post-commit rebuild:   ${config['post-commit-rebuild']}`);
				if (config['post-commit-install'] !== undefined) console.log(`  Post-commit install:   ${config['post-commit-install']}`);
				if (config['post-commit-branches']) console.log(`  Post-commit branches:  ${config['post-commit-branches']}`);
				if (config['post-commit-tag-pattern']) console.log(`  Post-commit tag:       ${config['post-commit-tag-pattern']}`);

				// Developer
				if (config['auto-rebuild']) console.log(`  Auto-rebuild:          ${config['auto-rebuild']}`);
				if (config['rebuild-command']) console.log(`  Rebuild command:       ${config['rebuild-command']}`);
				if (config['rebuild-source-dir']) console.log(`  Rebuild source dir:    ${config['rebuild-source-dir']}`);

				if (process.stdout.isTTY) {
					console.log('');
					console.log(dim(`  Run ${bold('aicommits config edit')} to edit interactively`));
				}

				return;
			}

			if (mode === 'get') {
				const config = await getConfig({}, {}, true);
				const sensitiveKeys = ['OPENAI_API_KEY', 'TOGETHER_API_KEY', 'api-key'];
				for (const key of keyValues) {
					if (hasOwn(config, key)) {
						const value = config[key as keyof typeof config];
						const displayValue = sensitiveKeys.includes(key)
							? `${String(value).substring(0, 4)}****`
							: String(value);
						console.log(`${key}=${displayValue}`);
					}
				}
				return;
			}

			if (mode === 'set') {
				await setConfigs(
					keyValues.map((keyValue) => {
						const idx = keyValue.indexOf('=');
						if (idx === -1) return [keyValue, ''] as [string, string];
						return [keyValue.slice(0, idx), keyValue.slice(idx + 1)] as [string, string];
					})
				);
				return;
			}

			if (mode === 'info') {
				const activeConfig = resolveConfigPath();
				const xdgPath = getConfigFilePath();
				const legacyPath = getLegacyConfigPath();
				const projectPath = getProjectConfigPath();
				const systemPaths = getSystemConfigPaths();
				const cacheDir = getCacheDir();

				console.log(bold('Configuration sources (highest precedence first):'));
				console.log(`  1. CLI flags          ${dim('(active)')}`);

				const envOverride = process.env.AICOMMITS_CONFIG;
				console.log(
					`  2. AICOMMITS_CONFIG   ${envOverride ? envOverride : dim('not set')}`,
				);

				console.log(
					`  3. Project config     ${projectPath ? green(projectPath) : dim('not found')}`,
				);

				const xdgExists = fs.existsSync(xdgPath);
				console.log(
					`  4. User config (XDG)  ${xdgExists ? green(xdgPath) : dim(xdgPath + ' (not found)')}`,
				);

				const legacyExists = fs.existsSync(legacyPath);
				if (legacyExists) {
					console.log(
						`     Legacy fallback    ${yellow(legacyPath + ' (active — run "aicommits config migrate")')}`,
					);
				}

				const foundSystem = systemPaths.find((p) => fs.existsSync(p));
				console.log(
					`  5. System config      ${foundSystem ? green(foundSystem) : dim(systemPaths[0] + ' (not found)')}`,
				);

				console.log('');
				console.log(`Active config:  ${bold(activeConfig)}`);
				console.log(`Cache dir:      ${cacheDir}`);
				return;
			}

			if (mode === 'migrate') {
				const legacyPath = getLegacyConfigPath();
				const xdgPath = getConfigFilePath();
				const xdgDir = getConfigDir();

				if (!fs.existsSync(legacyPath)) {
					if (fs.existsSync(xdgPath)) {
						console.log(`${green('✓')} Already using XDG config at ${xdgPath}`);
					} else {
						console.log(`No config file found. New config will be created at ${xdgPath}`);
					}
					return;
				}

				if (fs.existsSync(xdgPath)) {
					console.log(
						`${yellow('⚠')} Both legacy (${legacyPath}) and XDG (${xdgPath}) configs exist.`,
					);
					console.log(`  XDG config takes precedence. Remove the legacy file manually if desired.`);
					return;
				}

				// Perform migration
				console.log(`Moving config from ${legacyPath} to ${xdgPath}...`);

				if (!fs.existsSync(xdgDir)) {
					fs.mkdirSync(xdgDir, { recursive: true });
					console.log(`  ${green('✓')} Created ${xdgDir}/`);
				}

				fs.copyFileSync(legacyPath, xdgPath);
				console.log(`  ${green('✓')} Copied config file`);

				fs.unlinkSync(legacyPath);
				console.log(`  ${green('✓')} Removed legacy file`);

				console.log(`\n${green('✓')} Migration complete! Config now at ${xdgPath}`);
				return;
			}

			if (mode === 'path') {
				console.log(resolveConfigPath());
				return;
			}

			if (mode === 'open') {
				const configPath = resolveConfigPath();

				// Ensure the config file exists before opening
				if (!fs.existsSync(configPath)) {
					const dir = getConfigDir();
					fs.mkdirSync(dir, { recursive: true });
					fs.writeFileSync(configPath, '', 'utf8');
				}

				// Resolve editor: $VISUAL → $EDITOR → OS default
				const editor = process.env.VISUAL
					|| process.env.EDITOR
					|| (process.platform === 'darwin' ? 'open -t'
						: process.platform === 'win32' ? 'notepad'
						: 'xdg-open');

				console.log(dim(`Opening ${configPath} with ${editor}...`));

				try {
					execSync(`${editor} "${configPath}"`, {
						stdio: 'inherit',
						// Terminal editors (vim, nano) need the TTY
						...(process.stdin.isTTY ? {} : { stdio: 'pipe' }),
					});
				} catch {
					throw new KnownError(
						`Failed to open editor "${editor}". Set $VISUAL or $EDITOR to your preferred editor.\n`
						+ `  Example: export EDITOR=nano`,
					);
				}
				return;
			}

			if (mode === 'edit') {
				if (!process.stdout.isTTY) {
					throw new KnownError('Interactive mode requires a terminal. Use "aicommits config set key=value" instead.');
				}

				const config = await getConfig({}, {}, true);
				const configPath = resolveConfigPath();

				intro(bold('aicommits config'));
				note(
					`Config file: ${configPath}\n` +
					`Provider settings → use ${bold('aicommits setup')}\n` +
					`Model selection  → use ${bold('aicommits model')}`,
				);

				const changes: [string, string][] = [];

				// Helper: cancel-aware wrapper
				const cancelled = (val: unknown): val is symbol => {
					if (isCancel(val)) {
						outro(dim('No changes made.'));
						process.exit(0);
					}
					return false;
				};

				// --- Section 1: Commit Format ---
				log.step(bold('Commit Format'));

				const typeVal = await select({
					message: 'Commit message format',
					options: [
						{ value: 'conventional', label: 'conventional', hint: 'feat:, fix:, chore:, etc.' },
						{ value: 'plain', label: 'plain', hint: 'Simple freeform messages' },
						{ value: 'gitmoji', label: 'gitmoji', hint: '🎉 🐛 ✨ etc.' },
					],
					initialValue: String(config.type || 'conventional'),
				});
				if (cancelled(typeVal)) return;
				if (typeVal !== config.type) changes.push(['type', typeVal as string]);

				const localeVal = await text({
					message: 'Commit message locale',
					placeholder: 'en',
					initialValue: String(config.locale || 'en'),
				});
				if (cancelled(localeVal)) return;
				if (localeVal !== (config.locale || 'en')) changes.push(['locale', localeVal as string]);

				const maxLenVal = await text({
					message: 'Max commit message length',
					placeholder: '72',
					initialValue: String(config['max-length'] || 72),
					validate: (v) => {
						if (!v || !/^\d+$/.test(v)) return 'Must be a number';
						if (Number(v) < 20) return 'Must be at least 20';
					},
				});
				if (cancelled(maxLenVal)) return;
				if (String(maxLenVal) !== String(config['max-length'] || 72)) changes.push(['max-length', maxLenVal as string]);

				// --- Section 2: Post-Commit Actions ---
				log.step(bold('Post-Commit Actions'));

				const hasPostCommit = !!config['post-commit'];
				const enablePostCommit = await confirm({
					message: 'Run a command after each commit?',
					initialValue: hasPostCommit,
				});
				if (cancelled(enablePostCommit)) return;

				if (enablePostCommit) {
					const postCommitCmd = await text({
						message: 'Command to run after commit',
						placeholder: 'git push',
						initialValue: String(config['post-commit'] || ''),
					});
					if (cancelled(postCommitCmd)) return;
					if (postCommitCmd !== (config['post-commit'] || '')) changes.push(['post-commit', postCommitCmd as string]);
				} else if (hasPostCommit) {
					changes.push(['post-commit', '']);
				}

				// --- Section 3: Build Pipeline ---
				log.step(bold('Build Pipeline'));

				const rebuildVal = await select({
					message: 'Auto-rebuild after commit',
					options: [
						{ value: 'smart', label: 'smart', hint: 'Only when source files changed' },
						{ value: 'always', label: 'always', hint: 'Rebuild on every commit' },
						{ value: 'off', label: 'off', hint: 'Never auto-rebuild' },
					],
					initialValue: String(config['post-commit-rebuild'] || 'off'),
				});
				if (cancelled(rebuildVal)) return;
				if (rebuildVal !== (config['post-commit-rebuild'] || 'off')) changes.push(['post-commit-rebuild', rebuildVal as string]);

				if (rebuildVal !== 'off') {
					const installVal = await confirm({
						message: 'Auto-install binary after rebuild?',
						initialValue: config['post-commit-install'] === true || String(config['post-commit-install']) === 'true',
					});
					if (cancelled(installVal)) return;
					const installStr = installVal ? 'true' : 'false';
					if (installStr !== String(config['post-commit-install'] || 'false')) changes.push(['post-commit-install', installStr]);

					const branchesVal = await text({
						message: 'Limit rebuild to branches (glob, comma-separated)',
						placeholder: 'all branches',
						initialValue: String(config['post-commit-branches'] || ''),
					});
					if (cancelled(branchesVal)) return;
					if (branchesVal !== (config['post-commit-branches'] || '')) changes.push(['post-commit-branches', branchesVal as string]);

					const tagVal = await text({
						message: 'Limit rebuild to tags (glob pattern)',
						placeholder: 'all tags',
						initialValue: String(config['post-commit-tag-pattern'] || ''),
					});
					if (cancelled(tagVal)) return;
					if (tagVal !== (config['post-commit-tag-pattern'] || '')) changes.push(['post-commit-tag-pattern', tagVal as string]);
				}

				// --- Section 4: Developer ---
				log.step(bold('Developer'));

				const autoRebuildVal = await select({
					message: 'Dev auto-rebuild on stale binary',
					options: [
						{ value: 'prompt', label: 'prompt', hint: 'Ask before rebuilding' },
						{ value: 'auto', label: 'auto', hint: 'Rebuild silently' },
						{ value: 'off', label: 'off', hint: 'Just warn, don\'t rebuild' },
					],
					initialValue: String(config['auto-rebuild'] || 'prompt'),
				});
				if (cancelled(autoRebuildVal)) return;
				if (autoRebuildVal !== (config['auto-rebuild'] || 'prompt')) changes.push(['auto-rebuild', autoRebuildVal as string]);

				const rebuildCmdVal = await text({
					message: 'Custom rebuild command',
					placeholder: 'auto-detect',
					initialValue: String(config['rebuild-command'] || ''),
				});
				if (cancelled(rebuildCmdVal)) return;
				if (rebuildCmdVal !== (config['rebuild-command'] || '')) changes.push(['rebuild-command', rebuildCmdVal as string]);

				const srcDirVal = await text({
					message: 'Source directory to watch for changes',
					placeholder: 'auto-detect',
					initialValue: String(config['rebuild-source-dir'] || ''),
				});
				if (cancelled(srcDirVal)) return;
				if (srcDirVal !== (config['rebuild-source-dir'] || '')) changes.push(['rebuild-source-dir', srcDirVal as string]);

				// --- Summary & Save ---
				if (changes.length === 0) {
					outro(dim('No changes made.'));
					return;
				}

				console.log('');
				log.step(bold('Changes'));
				for (const [key, value] of changes) {
					if (value === '') {
						console.log(`  ${yellow('−')} ${key} ${dim('(removed)')}`);
					} else {
						console.log(`  ${green('+')} ${key} = ${bold(value)}`);
					}
				}
				console.log('');

				const doSave = await confirm({
					message: `Save ${changes.length} change${changes.length > 1 ? 's' : ''}?`,
					initialValue: true,
				});
				if (cancelled(doSave)) return;

				if (doSave) {
					await setConfigs(changes);
					outro(`${green('✓')} Config saved to ${configPath}`);
				} else {
					outro(dim('Discarded.'));
				}
				return;
			}

			throw new KnownError(`Invalid mode: ${mode}`);
		})().catch(handleCommandError);
	}
);
