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
	multiselect,
	isCancel,
	note,
} from '@clack/prompts';
import { unlinkSync, existsSync } from 'fs';
import {
	findAllBinariesInPath,
	checkWriteable,
	type BinaryLocation,
} from '../utils/install-paths.js';

export default command(
	{
		name: 'doctor',
		description: 'Diagnose installation issues and detect PATH conflicts',
		help: {
			description: `Diagnose installation issues and detect PATH conflicts

Examples:
  aicommits doctor                     Check for duplicate binaries in PATH
  aicommits doctor --fix               Interactively remove shadowed duplicates`,
		},
		parameters: [],
		flags: {
			fix: {
				type: Boolean,
				description: 'Interactively remove duplicate binaries',
				default: false,
			},
		},
	},
	(argv) => {
		(async () => {
			intro(bold('aicommits doctor'));

			const allBinaries = findAllBinariesInPath();
			let hasIssues = false;

			if (allBinaries.size === 0) {
				console.log(`  ${red('✗')} No aicommits binaries found in PATH`);
				console.log(dim(`    Run: aicommits install`));
				outro('');
				return;
			}

			// Report for each binary name
			for (const [name, locations] of allBinaries) {
				const hasConflict = locations.length > 1;

				if (hasConflict) {
					hasIssues = true;
					console.log(`\n  ${yellow('⚠')} ${bold(name)} — ${yellow(`${locations.length} copies found`)}`);
				} else {
					console.log(`\n  ${green('✓')} ${bold(name)} — ${green('no conflicts')}`);
				}

				for (const loc of locations) {
					const badge = loc.isActive
						? green('● active')
						: dim('○ shadowed');
					const source = dim(`(${loc.source})`);
					const symlink = loc.isSymlink ? dim(' → ' + loc.realPath) : '';

					console.log(`    ${badge}  ${loc.path}${symlink}  ${source}`);
				}

				if (hasConflict) {
					const active = locations.find((l) => l.isActive);
					const shadowed = locations.filter((l) => !l.isActive);
					console.log('');
					console.log(dim(`    The active binary is: ${active?.path}`));
					console.log(dim(`    ${shadowed.length} shadowed cop${shadowed.length === 1 ? 'y' : 'ies'} will never run`));
				}
			}

			console.log('');

			// Offer to fix if conflicts found
			if (hasIssues && argv.flags.fix) {
				await offerCleanup(allBinaries);
			} else if (hasIssues) {
				note(
					`Run ${cyan('aicommits doctor --fix')} to interactively remove duplicates.`,
					'Tip',
				);
			}

			if (!hasIssues) {
				outro(green('No issues found.'));
			} else {
				outro('');
			}
		})();
	},
);

async function offerCleanup(allBinaries: Map<string, BinaryLocation[]>): Promise<void> {
	// Collect all shadowed (non-active) binaries
	const removable: BinaryLocation[] = [];
	for (const [, locations] of allBinaries) {
		if (locations.length <= 1) continue;
		for (const loc of locations) {
			if (!loc.isActive) {
				removable.push(loc);
			}
		}
	}

	if (removable.length === 0) return;

	const selected = await multiselect({
		message: 'Select binaries to remove',
		options: removable.map((loc) => ({
			value: loc.path,
			label: `${loc.name} — ${loc.path}`,
			hint: `${loc.source}, shadowed`,
		})),
	});

	if (isCancel(selected) || selected.length === 0) {
		console.log(dim('  No binaries removed.'));
		return;
	}

	let removed = 0;
	for (const binPath of selected) {
		const path = binPath as string;
		const dir = path.replace(/\/[^/]+$/, '');

		if (!checkWriteable(dir)) {
			console.log(`  ${red('✗')} ${path} — permission denied (try with sudo)`);
			continue;
		}

		try {
			if (existsSync(path)) {
				unlinkSync(path);
				console.log(`  ${green('✓')} Removed ${path}`);
				removed++;
			}
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			console.log(`  ${red('✗')} ${path} — ${msg}`);
		}
	}

	if (removed > 0) {
		console.log(`\n  ${green('✓')} Removed ${removed} duplicate${removed === 1 ? '' : 's'}.`);
	}
}
