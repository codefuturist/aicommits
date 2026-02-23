import { command } from 'cleye';
import { execa } from 'execa';
import { black, green, red, yellow, dim, bgCyan } from 'kolorist';
import {
	intro,
	outro,
	spinner,
	select,
	confirm,
	multiselect,
	text,
	isCancel,
} from '@clack/prompts';
import {
	assertGitRepo,
	getUnstagedChanges,
	stageFiles,
} from '../utils/git.js';
import { getConfig } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import { groupChangesWithAI, type CommitGroup } from '../utils/openai.js';
import { KnownError, handleCommandError } from '../utils/error.js';

export default command(
	{
		name: 'stage',
		description: 'AI-powered smart staging — group changes into logical commits',
		help: {
			description:
				'Analyze unstaged changes, group them into logical atomic commits using AI, then stage and commit each group.',
		},
		flags: {
			all: {
				type: Boolean,
				description: 'Include untracked files (default: tracked only)',
				alias: 'a',
				default: false,
			},
			yes: {
				type: Boolean,
				description: 'Auto-commit all groups without confirmation',
				alias: 'y',
				default: false,
			},
			dryRun: {
				type: Boolean,
				description: 'Show groups without committing',
				alias: 'd',
				default: false,
			},
			maxGroups: {
				type: Number,
				description: 'Maximum number of groups (default: 10)',
				alias: 'm',
			},
			prompt: {
				type: String,
				description: 'Custom prompt to guide grouping behavior',
				alias: 'p',
			},
			type: {
				type: String,
				description: 'Commit message format (plain, conventional, gitmoji)',
				alias: 't',
			},
		},
	},
	(argv) => {
		(async () => {
			intro(bgCyan(black(' aicommits · smart stage ')));

			await assertGitRepo();

			const detectingFiles = spinner();
			detectingFiles.start('Detecting unstaged changes');

			const changes = await getUnstagedChanges(argv.flags.all);

			if (!changes) {
				detectingFiles.stop('No changes detected');
				throw new KnownError(
					'No unstaged changes found. Make some changes first, or use `--all` to include untracked files.'
				);
			}

			const { files, modifiedFiles, untrackedFiles, diff } = changes;

			let filesSummary = `📁 Detected ${files.length} changed file${files.length === 1 ? '' : 's'}`;
			if (untrackedFiles.length > 0) {
				filesSummary += ` (${modifiedFiles.length} modified, ${untrackedFiles.length} untracked)`;
			}
			if (files.length <= 15) {
				filesSummary += `:\n${files.map((f) => `     ${f}`).join('\n')}`;
			}
			detectingFiles.stop(filesSummary);

			// Load config and provider
			const config = await getConfig({
				type: argv.flags.type?.toString(),
			});

			const providerInstance = getProvider(config);
			if (!providerInstance) {
				throw new KnownError(
					'No AI provider configured. Run `aicommits setup` first.'
				);
			}

			const validation = providerInstance.validateConfig();
			if (!validation.valid) {
				throw new KnownError(
					`Provider configuration issues: ${validation.errors.join(', ')}. Run \`aicommits setup\` to reconfigure.`
				);
			}

			config.model = config.OPENAI_MODEL || providerInstance.getDefaultModel();
			const timeout = config.timeout || (providerInstance.name === 'ollama' ? 30_000 : 10_000);
			const maxGroups = argv.flags.maxGroups || 10;

			// AI grouping
			const s = spinner();
			s.start('🤖 Analyzing changes to suggest commit groups...');
			const startTime = Date.now();

			const { groups, usage } = await groupChangesWithAI(
				providerInstance.getBaseUrl(),
				providerInstance.getApiKey() || '',
				config.model!,
				config.locale,
				files,
				diff,
				maxGroups,
				config.type,
				timeout,
				argv.flags.prompt,
			);

			const duration = Date.now() - startTime;
			s.stop(`✅ Grouped into ${groups.length} commit${groups.length === 1 ? '' : 's'} in ${(duration / 1000).toFixed(1)}s`);

			// Display groups
			console.log('');
			for (let i = 0; i < groups.length; i++) {
				const group = groups[i];
				console.log(`  ${green(`Group ${i + 1}:`)} ${group.message}`);
				for (let j = 0; j < group.files.length; j++) {
					const prefix = j === group.files.length - 1 ? '└' : '├';
					console.log(`    ${dim(prefix)} ${group.files[j]}`);
				}
				console.log('');
			}

			// Dry-run mode: stop here
			if (argv.flags.dryRun) {
				outro(`${dim('Dry run — no changes were made')}`);
				return;
			}

			// Auto-commit mode
			if (argv.flags.yes) {
				await commitGroups(groups);
				outro(`${green('✔')} All ${groups.length} group${groups.length === 1 ? '' : 's'} committed!`);
				return;
			}

			// Interactive mode
			const action = await select({
				message: 'What would you like to do?',
				options: [
					{ value: 'all', label: `Commit all ${groups.length} groups` },
					{ value: 'select', label: 'Select which groups to commit' },
					{ value: 'edit', label: 'Edit commit messages before committing' },
					{ value: 'cancel', label: 'Cancel' },
				],
			});

			if (isCancel(action) || action === 'cancel') {
				outro('Cancelled');
				return;
			}

			if (action === 'all') {
				await commitGroups(groups);
				outro(`${green('✔')} All ${groups.length} group${groups.length === 1 ? '' : 's'} committed!`);
				return;
			}

			if (action === 'select') {
				const selected = await multiselect({
					message: 'Select groups to commit:',
					options: groups.map((g, i) => ({
						value: i,
						label: g.message,
						hint: `${g.files.length} file${g.files.length === 1 ? '' : 's'}`,
					})),
					required: true,
				});

				if (isCancel(selected)) {
					outro('Cancelled');
					return;
				}

				const selectedGroups = (selected as number[]).map((i) => groups[i]);
				await commitGroups(selectedGroups);
				outro(`${green('✔')} ${selectedGroups.length} group${selectedGroups.length === 1 ? '' : 's'} committed!`);
				return;
			}

			if (action === 'edit') {
				const editedGroups: CommitGroup[] = [];
				for (const group of groups) {
					const newMessage = await text({
						message: `Edit message for ${group.files.length} file${group.files.length === 1 ? '' : 's'}:`,
						defaultValue: group.message,
						initialValue: group.message,
					});

					if (isCancel(newMessage)) {
						outro('Cancelled');
						return;
					}

					editedGroups.push({ ...group, message: newMessage as string });
				}

				await commitGroups(editedGroups);
				outro(`${green('✔')} All ${editedGroups.length} group${editedGroups.length === 1 ? '' : 's'} committed!`);
				return;
			}
		})().catch(handleCommandError);
	}
);

async function commitGroups(groups: CommitGroup[]) {
	for (let i = 0; i < groups.length; i++) {
		const group = groups[i];
		const progress = spinner();
		progress.start(`[${i + 1}/${groups.length}] Staging & committing: ${dim(group.message)}`);

		await stageFiles(group.files);
		await execa('git', ['commit', '-m', group.message]);

		progress.stop(`${green('✔')} [${i + 1}/${groups.length}] ${group.message}`);
	}
}
