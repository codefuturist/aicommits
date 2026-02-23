import { command } from 'cleye';
import {
	green,
	yellow,
	red,
	dim,
	bold,
	cyan,
} from 'kolorist';
import {
	intro,
	outro,
	confirm,
	select,
	spinner,
	cancel,
	note,
} from '@clack/prompts';
import { writeFileSync, chmodSync, mkdirSync, existsSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { platform } from 'os';
import {
	type InstallScope,
	getDefaultInstallDir,
	isInPath,
	checkWriteable,
	getProjectEntrypoint,
	getNodePath,
	getShellWrapper,
	getPathHint,
	getBinaryNames,
	findInstalledBinaries,
	hasPathConflicts,
} from '../utils/install-paths.js';

function detectExistingInstall(binDir: string): Map<string, string | null> {
	const results = new Map<string, string | null>();
	for (const name of getBinaryNames()) {
		const binPath = join(binDir, name);
		if (existsSync(binPath)) {
			try {
				const content = readFileSync(binPath, 'utf8');
				results.set(name, content);
			} catch {
				results.set(name, null);
			}
		}
	}
	return results;
}

export default command(
	{
		name: 'install',
		description: 'Install aicommits binary to system PATH (~/.local/bin or /usr/local/bin)',
		help: {
			description: 'Install aicommits binary to system PATH (~/.local/bin or /usr/local/bin)',
		},
		parameters: [],
		flags: {
			scope: {
				type: String,
				description: 'Install scope: "user" (~/.local/bin) or "system" (/usr/local/bin)',
			},
			binDir: {
				type: String,
				description: 'Custom directory to install binaries to',
			},
			info: {
				type: Boolean,
				description: 'Show current installation details',
				default: false,
			},
			force: {
				type: Boolean,
				description: 'Overwrite existing binaries without prompting',
				alias: 'f',
				default: false,
			},
		},
	},
	(argv) => {
		(async () => {
			if (argv.flags.info) {
				showInstallInfo();
				return;
			}

			intro(bold('aicommits install'));

			// Determine scope
			let scope: InstallScope;
			if (argv.flags.scope) {
				if (argv.flags.scope !== 'user' && argv.flags.scope !== 'system') {
					cancel(`Invalid scope "${argv.flags.scope}". Use "user" or "system".`);
					process.exit(1);
				}
				scope = argv.flags.scope as InstallScope;
			} else if (argv.flags.binDir) {
				scope = 'user'; // custom dir treated as user scope
			} else {
				const userDir = getDefaultInstallDir('user');
				const systemDir = getDefaultInstallDir('system');

				const selected = await select({
					message: 'Install scope',
					options: [
						{
							value: 'user',
							label: `User — ${dim(userDir)}`,
							hint: 'no sudo required',
						},
						{
							value: 'system',
							label: `System — ${dim(systemDir)}`,
							hint: 'requires sudo',
						},
					],
				});

				if (typeof selected !== 'string') {
					cancel('Installation cancelled.');
					process.exit(0);
				}
				scope = selected as InstallScope;
			}

			const binDir = argv.flags.binDir
				? resolve(argv.flags.binDir)
				: getDefaultInstallDir(scope);

			// Ensure directory exists
			if (!existsSync(binDir)) {
				try {
					mkdirSync(binDir, { recursive: true, mode: 0o755 });
					console.log(dim(`  Created ${binDir}`));
				} catch {
					if (!checkWriteable(join(binDir, '..'))) {
						cancel(`Cannot create ${binDir} — permission denied. Try with sudo or use --scope user.`);
						process.exit(1);
					}
				}
			}

			// Check writeability
			const writeable = checkWriteable(binDir);
			if (!writeable && scope === 'system') {
				console.log(yellow(`\n  ⚠ ${binDir} requires elevated permissions.`));
				console.log(dim(`  Re-run with: sudo aicommits install --scope system\n`));
				process.exit(1);
			}
			if (!writeable) {
				cancel(`Cannot write to ${binDir}. Check permissions or use --bin-dir.`);
				process.exit(1);
			}

			// Resolve paths
			const entrypoint = resolve(getProjectEntrypoint());
			const nodePath = getNodePath();

			if (!existsSync(entrypoint)) {
				cancel(`Entry point not found: ${entrypoint}\nRun 'pnpm build' first.`);
				process.exit(1);
			}

			// Check for existing installs
			const existing = detectExistingInstall(binDir);
			if (existing.size > 0 && !argv.flags.force) {
				const names = [...existing.keys()].join(', ');
				const overwrite = await confirm({
					message: `${names} already exist in ${binDir}. Overwrite?`,
				});
				if (overwrite !== true) {
					cancel('Installation cancelled.');
					process.exit(0);
				}
			}

			// Install
			const s = spinner();
			s.start(`Installing to ${binDir}...`);

			const wrapperContent = getShellWrapper(nodePath, entrypoint);
			const isWindows = platform() === 'win32';
			const installed: string[] = [];

			for (const name of getBinaryNames()) {
				const binPath = join(binDir, isWindows ? `${name}.cmd` : name);
				writeFileSync(binPath, wrapperContent, { mode: 0o755 });
				if (!isWindows) {
					chmodSync(binPath, 0o755);
				}
				installed.push(binPath);
			}

			s.stop(green('✓ Installation complete'));

			// Show results
			const lines = installed.map((p) => `  ${green('✓')} ${p} ${dim('(755)')}`);

			const pathHint = getPathHint(binDir);
			if (pathHint) {
				lines.push('');
				lines.push(`  ${yellow('⚠')} ${binDir} is not in your PATH`);
				lines.push(`  ${dim(pathHint)}`);
			} else {
				lines.push(`  ${green('✓')} ${binDir} is in PATH`);
			}

			lines.push('');
			lines.push(dim(`  Points to: ${entrypoint}`));

			note(lines.join('\n'), 'Installed');

			// Warn about PATH conflicts after install
			if (hasPathConflicts()) {
				console.log(`  ${yellow('⚠')} Multiple aicommits binaries detected in PATH.`);
				console.log(dim(`    Run ${cyan('aicommits doctor --fix')} to resolve conflicts.\n`));
			}

			outro(`Run ${cyan('aicommits --version')} to verify.`);
		})();
	},
);

function showInstallInfo(): void {
	const found = findInstalledBinaries();

	console.log(bold('\nInstallation info:'));

	if (found.length === 0) {
		console.log(dim('  No aicommits binaries found in standard locations.'));
		console.log(dim('  Checked: ~/.local/bin, /usr/local/bin'));
		console.log('');
		return;
	}

	for (const { name, path: binPath, scope } of found) {
		console.log(`  ${green('●')} ${bold(name)}`);
		console.log(`    Path:   ${binPath}`);
		console.log(`    Scope:  ${scope}`);

		try {
			const stat = statSync(binPath);
			const perms = `0${(stat.mode & 0o777).toString(8)}`;
			console.log(`    Perms:  ${perms}`);
		} catch { /* ignore */ }

		try {
			const content = readFileSync(binPath, 'utf8');
			const match = content.match(/exec\s+"[^"]*"\s+"([^"]+)"/);
			if (match) {
				console.log(`    Target: ${dim(match[1])}`);
			}
		} catch { /* ignore */ }

		const dir = binPath.replace(/\/[^/]+$/, '');
		console.log(`    In PATH: ${isInPath(dir) ? green('yes') : red('no')}`);
		console.log('');
	}
}
