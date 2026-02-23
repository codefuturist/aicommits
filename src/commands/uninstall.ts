import { command } from 'cleye';
import { green, yellow, dim, bold, red } from 'kolorist';
import { intro, outro, confirm, cancel } from '@clack/prompts';
import { unlinkSync, existsSync } from 'fs';
import { findInstalledBinaries } from '../utils/install-paths.js';

export default command(
	{
		name: 'uninstall',
		parameters: [],
		flags: {
			yes: {
				type: Boolean,
				description: 'Skip confirmation prompt',
				alias: 'y',
				default: false,
			},
		},
	},
	(argv) => {
		(async () => {
			intro(bold('aicommits uninstall'));

			const found = findInstalledBinaries();

			if (found.length === 0) {
				console.log(dim('  No aicommits binaries found in standard locations.'));
				console.log(dim('  Checked: ~/.local/bin, /usr/local/bin'));
				outro('Nothing to uninstall.');
				return;
			}

			console.log('  Found installed binaries:\n');
			for (const { name, path: binPath, scope } of found) {
				console.log(`  ${bold(name)} — ${binPath} ${dim(`(${scope})`)}`);
			}
			console.log('');

			if (!argv.flags.yes) {
				const proceed = await confirm({
					message: `Remove ${found.length} binary file(s)?`,
				});
				if (proceed !== true) {
					cancel('Uninstall cancelled.');
					process.exit(0);
				}
			}

			let removed = 0;
			let failed = 0;

			for (const { path: binPath } of found) {
				try {
					if (existsSync(binPath)) {
						unlinkSync(binPath);
						console.log(`  ${green('✓')} Removed ${binPath}`);
						removed++;
					}
				} catch (error: unknown) {
					const msg = error instanceof Error ? error.message : String(error);
					if (msg.includes('EACCES') || msg.includes('permission')) {
						console.log(`  ${red('✗')} ${binPath} — permission denied (try with sudo)`);
					} else {
						console.log(`  ${red('✗')} ${binPath} — ${msg}`);
					}
					failed++;
				}
			}

			console.log('');
			if (failed > 0) {
				outro(yellow(`Removed ${removed}, failed ${failed}. Re-run with sudo for system binaries.`));
			} else {
				outro(green(`Removed ${removed} binary file(s).`));
			}
		})();
	},
);
