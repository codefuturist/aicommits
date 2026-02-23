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
import { groupChangesWithAI, groupBoundariesWithAI, type CommitGroup } from '../utils/openai.js';
import { detectProjectBoundaries, formatBoundarySummary } from '../utils/project-detection.js';
import { KnownError, handleCommandError } from '../utils/error.js';

const BOUNDARY_THRESHOLD = 50;

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
				description: 'Maximum number of groups per boundary (default: 3)',
				alias: 'm',
			},
			scope: {
				type: String,
				description: 'Only process changes in a specific directory/boundary',
				alias: 's',
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

			const repoRoot = await assertGitRepo();

			const detectingFiles = spinner();
			detectingFiles.start('Detecting unstaged changes');

			const changes = await getUnstagedChanges(argv.flags.all);

			if (!changes) {
				detectingFiles.stop('No changes detected');
				throw new KnownError(
					'No unstaged changes found. Make some changes first, or use `--all` to include untracked files.'
				);
			}

			let { files, modifiedFiles, untrackedFiles, diff } = changes;

			// Apply --scope filter
			if (argv.flags.scope) {
				const scope = argv.flags.scope.replace(/\/$/, ''); // trim trailing slash
				files = files.filter((f) => f.startsWith(scope + '/') || f === scope);
				modifiedFiles = modifiedFiles.filter((f) => f.startsWith(scope + '/') || f === scope);
				untrackedFiles = untrackedFiles.filter((f) => f.startsWith(scope + '/') || f === scope);

				if (files.length === 0) {
					detectingFiles.stop('No changes in scope');
					throw new KnownError(`No unstaged changes found in scope: ${scope}`);
				}
			}

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
			const maxGroups = argv.flags.maxGroups || 3;
			const baseUrl = providerInstance.getBaseUrl();
			const apiKey = providerInstance.getApiKey() || '';

			let groups: CommitGroup[];
			let usage: any;

			// Use boundary detection for large changesets
			if (files.length > BOUNDARY_THRESHOLD) {
				const boundarySpinner = spinner();
				boundarySpinner.start('🔍 Detecting project boundaries...');
				const boundaries = await detectProjectBoundaries(files, repoRoot);
				boundarySpinner.stop(formatBoundarySummary(boundaries));

				// Interactive boundary selection (unless --yes or --scope)
				let selectedBoundaries = boundaries;
				if (!argv.flags.yes && !argv.flags.scope && !argv.flags.dryRun && boundaries.length > 1) {
					const boundaryAction = await select({
						message: `Process all ${boundaries.length} boundaries, or select specific ones?`,
						options: [
							{ value: 'all', label: `Process all ${boundaries.length} boundaries` },
							{ value: 'select', label: 'Select which boundaries to process' },
							{ value: 'cancel', label: 'Cancel' },
						],
					});

					if (isCancel(boundaryAction) || boundaryAction === 'cancel') {
						outro('Cancelled');
						return;
					}

					if (boundaryAction === 'select') {
						const selected = await multiselect({
							message: 'Select boundaries to process:',
							options: boundaries.map((b, i) => ({
								value: i,
								label: `${b.name} (${b.files.length} files, ${b.type})${b.autoGroup ? ' [auto]' : ''}`,
							})),
							required: true,
						});

						if (isCancel(selected)) {
							outro('Cancelled');
							return;
						}

						selectedBoundaries = (selected as number[]).map((i) => boundaries[i]);
					}
				}

				const s = spinner();
				s.start(`🤖 Analyzing ${selectedBoundaries.length} boundaries...`);
				const startTime = Date.now();

				const result = await groupBoundariesWithAI(
					baseUrl,
					apiKey,
					config.model!,
					config.locale,
					selectedBoundaries,
					diff,
					maxGroups,
					config.type,
					timeout,
					argv.flags.prompt,
					(name, index, total) => {
						s.message(`🤖 [${index + 1}/${total}] Analyzing ${name}...`);
					},
				);

				groups = result.groups;
				usage = result.usage;
				const duration = Date.now() - startTime;
				s.stop(`✅ Grouped into ${groups.length} commit${groups.length === 1 ? '' : 's'} in ${(duration / 1000).toFixed(1)}s`);
			} else {
				// Small changeset: single AI call (original behavior)
				const s = spinner();
				s.start('🤖 Analyzing changes to suggest commit groups...');
				const startTime = Date.now();

				const result = await groupChangesWithAI(
					baseUrl,
					apiKey,
					config.model!,
					config.locale,
					files,
					diff,
					maxGroups * 2, // higher limit for single-call mode
					config.type,
					timeout,
					argv.flags.prompt,
				);

				groups = result.groups;
				usage = result.usage;
				const duration = Date.now() - startTime;
				s.stop(`✅ Grouped into ${groups.length} commit${groups.length === 1 ? '' : 's'} in ${(duration / 1000).toFixed(1)}s`);
			}

			// Display groups
			console.log('');
			for (let i = 0; i < groups.length; i++) {
				const group = groups[i];
				console.log(`  ${green(`Group ${i + 1}:`)} ${group.message}`);
				const maxDisplay = 10;
				const filesToShow = group.files.length > maxDisplay
					? group.files.slice(0, maxDisplay)
					: group.files;
				for (let j = 0; j < filesToShow.length; j++) {
					const isLast = j === filesToShow.length - 1 && group.files.length <= maxDisplay;
					const prefix = isLast ? '└' : '├';
					console.log(`    ${dim(prefix)} ${filesToShow[j]}`);
				}
				if (group.files.length > maxDisplay) {
					console.log(`    ${dim('└')} ${dim(`... and ${group.files.length - maxDisplay} more files`)}`);
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
