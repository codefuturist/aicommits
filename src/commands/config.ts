import { command } from 'cleye';
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

export default command(
	{
		name: 'config',
		description: 'View or modify configuration settings',
		help: {
			description: `View or modify configuration settings

Modes:
  (none)   Show active config summary
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

			// If no mode provided, show all current config (excluding defaults)
			if (!mode) {
				const config = await getConfig({}, {}, true);

				console.log('Provider:', config.provider);
				if (config.OPENAI_API_KEY) {
					console.log('API Key:', `${config.OPENAI_API_KEY.substring(0, 4)}****`);
				}
				if (config.OPENAI_BASE_URL) {
					console.log('Base URL:', config.OPENAI_BASE_URL);
				}
				if (config.OPENAI_MODEL) {
					console.log('Model:', config.OPENAI_MODEL);
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

			throw new KnownError(`Invalid mode: ${mode}`);
		})().catch(handleCommandError);
	}
);
