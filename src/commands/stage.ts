import { command } from 'cleye';
import { execa } from 'execa';
import { black, green, yellow, dim, bgCyan } from 'kolorist';
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
	getStagedDiff,
	getPartiallyStaged,
	unstageFiles,
	stageFiles,
	getUnstagedDiffForFiles,
	getStagedDiffForBoundary,
} from '../utils/git.js';
import { getConfig } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import { groupChangesWithAI, groupBoundariesWithAI, type CommitGroup } from '../utils/openai.js';
import { detectProjectBoundaries, formatBoundarySummary, formatBoundaryDetails } from '../utils/project-detection.js';
import { KnownError, handleCommandError } from '../utils/error.js';
import { runPostCommit } from '../utils/post-commit.js';

const BOUNDARY_THRESHOLD = 50;

export default command(
	{
		name: 'split',
		alias: 'stage',
		description: 'AI-powered commit splitting — group changes into logical atomic commits',
		help: {
			description:
				'Analyze changes, group them into logical atomic commits using AI, then commit each group.',
		},
		flags: {
			all: {
				type: Boolean,
				description: 'Include untracked files (default: tracked only)',
				alias: 'a',
				default: false,
			},
			staged: {
				type: Boolean,
				description: 'Group already-staged files into multiple commits',
				alias: 'S',
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
			scan: {
				type: Boolean,
				description: 'Show detected project boundaries and exit (no AI calls)',
				default: false,
			},
			flat: {
				type: Boolean,
				description: 'Skip boundary detection — let AI group all changes freely',
				alias: 'F',
				default: false,
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
			noPostCommit: {
				type: Boolean,
				description: 'Skip post-commit actions for this invocation',
				default: false,
			},
		},
	},
	(argv) => {
		(async () => {
			intro(bgCyan(black(' aicommits · split ')));

			const repoRoot = await assertGitRepo();
			const isStaged = argv.flags.staged;

			// Validate mutually exclusive flags
			if (isStaged && argv.flags.all) {
				throw new KnownError(
					'--staged and --all are mutually exclusive. --all includes untracked files (unstaged mode only).'
				);
			}

			const detectingFiles = spinner();
			let files: string[];
			let diff: string;

			if (isStaged) {
				// Staged mode: work with files already in the git index
				detectingFiles.start('Detecting staged changes');

				const stagedResult = await getStagedDiff();
				if (!stagedResult) {
					detectingFiles.stop('No staged changes detected');
					throw new KnownError(
						'No staged changes found. Stage some files with `git add` first, or omit `--staged` to work with unstaged changes.'
					);
				}

				files = stagedResult.files;
				diff = stagedResult.diff;

				// Apply --scope filter
				if (argv.flags.scope) {
					const scope = argv.flags.scope.replace(/\/$/, '');
					files = files.filter((f) => f.startsWith(scope + '/') || f === scope);
					if (files.length === 0) {
						detectingFiles.stop('No staged changes in scope');
						throw new KnownError(`No staged changes found in scope: ${scope}`);
					}
				}

				let filesSummary = `📦 Detected ${files.length} staged file${files.length === 1 ? '' : 's'}`;
				if (files.length <= 15) {
					filesSummary += `:\n${files.map((f) => `     ${f}`).join('\n')}`;
				}
				detectingFiles.stop(filesSummary);

				// Warn about partially staged files
				if (!argv.flags.dryRun && !argv.flags.scan) {
					const partiallyStaged = await getPartiallyStaged();
					const relevant = partiallyStaged.filter((f) => files.includes(f));

					if (relevant.length > 0) {
						console.log('');
						console.log(`  ${yellow('⚠')}  ${yellow(`${relevant.length} file${relevant.length === 1 ? ' is' : 's are'} partially staged:`)}`);
						const show = relevant.slice(0, 5);
						for (const f of show) {
							console.log(`     ${dim('·')} ${f}`);
						}
						if (relevant.length > 5) {
							console.log(`     ${dim(`… and ${relevant.length - 5} more`)}`);
						}
						console.log(`  ${dim('Proceeding will stage ALL changes for these files (partial staging will be lost).')}`);
						console.log('');

						if (!argv.flags.yes) {
							const proceed = await confirm({
								message: 'Continue anyway?',
							});
							if (isCancel(proceed) || !proceed) {
								outro('Cancelled');
								return;
							}
						}
					}
				}
			} else {
				// Unstaged mode (default)
				detectingFiles.start('Detecting unstaged changes');

				const changes = await getUnstagedChanges(argv.flags.all);
				if (!changes) {
					detectingFiles.stop('No changes detected');
					throw new KnownError(
						'No unstaged changes found. Make some changes first, or use `--all` to include untracked files.'
					);
				}

				let { files: allFiles, modifiedFiles, untrackedFiles, diff: unstagedDiff } = changes;
				files = allFiles;
				diff = unstagedDiff;

				// Apply --scope filter
				if (argv.flags.scope) {
					const scope = argv.flags.scope.replace(/\/$/, '');
					files = files.filter((f) => f.startsWith(scope + '/') || f === scope);
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
			}

			// --scan mode: show boundaries and exit (no AI needed)
			if (argv.flags.scan) {
				if (argv.flags.flat) {
					outro(dim(`Flat mode — ${files.length} file${files.length === 1 ? '' : 's'} will be grouped freely by AI (no boundary detection).`));
					return;
				}
				const scanSpinner = spinner();
				scanSpinner.start('🔍 Detecting project boundaries...');
				const boundaries = await detectProjectBoundaries(files, repoRoot);
				scanSpinner.stop(formatBoundarySummary(boundaries));

				console.log('');
				console.log(formatBoundaryDetails(boundaries));

				outro(dim(`Use ${green('aicommits split')} to group and commit, or ${green('--scope <dir>')} to focus on one boundary.`));
				return;
			}

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

			// Helper: flat grouping — chunk files and call groupChangesWithAI per chunk
			const runFlatGrouping = async (): Promise<CommitGroup[]> => {
				const getDiff = isStaged ? getStagedDiffForBoundary : getUnstagedDiffForFiles;
				const chunks: string[][] = [];
				for (let i = 0; i < files.length; i += BOUNDARY_THRESHOLD) {
					chunks.push(files.slice(i, i + BOUNDARY_THRESHOLD));
				}

				const s = spinner();
				const totalChunks = chunks.length;
				s.start(totalChunks > 1
					? `🤖 Analyzing ${files.length} files in ${totalChunks} chunks (flat mode)...`
					: '🤖 Analyzing changes to suggest commit groups...');
				const startTime = Date.now();

				const allGroups: CommitGroup[] = [];
				for (let i = 0; i < chunks.length; i++) {
					if (totalChunks > 1) {
						s.message(`🤖 [${i + 1}/${totalChunks}] Analyzing chunk ${i + 1}...`);
					}
					const chunkDiff = await getDiff(chunks[i]);
					const result = await groupChangesWithAI(
						baseUrl,
						apiKey,
						config.model!,
						config.locale,
						chunks[i],
						chunkDiff,
						maxGroups * 2,
						config.type,
						timeout,
						argv.flags.prompt,
					);
					allGroups.push(...result.groups);
				}

				const duration = Date.now() - startTime;
				s.stop(`✅ Grouped into ${allGroups.length} commit${allGroups.length === 1 ? '' : 's'} in ${(duration / 1000).toFixed(1)}s`);
				return allGroups;
			};

			// Use flat grouping when --flat is set, or boundary detection otherwise
			if (argv.flags.flat) {
				groups = await runFlatGrouping();
			} else if (files.length > BOUNDARY_THRESHOLD) {
				// Use boundary detection for large changesets
				const boundarySpinner = spinner();
				boundarySpinner.start('🔍 Detecting project boundaries...');
				const boundaries = await detectProjectBoundaries(files, repoRoot);
				boundarySpinner.stop(formatBoundarySummary(boundaries));

				// Interactive boundary selection (unless --yes or --scope)
				let selectedBoundaries = boundaries;
				let useFlatMode = false;
				if (!argv.flags.yes && !argv.flags.scope && !argv.flags.dryRun && boundaries.length > 1) {
					const boundaryAction = await select({
						message: `Process all ${boundaries.length} boundaries, or select specific ones?`,
						options: [
							{ value: 'all', label: `Process all ${boundaries.length} boundaries` },
							{ value: 'select', label: 'Select which boundaries to process' },
							{ value: 'flat', label: 'Group without boundaries (flat — AI decides freely)' },
							{ value: 'cancel', label: 'Cancel' },
						],
					});

					if (isCancel(boundaryAction) || boundaryAction === 'cancel') {
						outro('Cancelled');
						return;
					}

					if (boundaryAction === 'flat') {
						useFlatMode = true;
					} else if (boundaryAction === 'select') {
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

				if (useFlatMode) {
					groups = await runFlatGrouping();
				} else {
					const s = spinner();
					s.start(`🤖 Analyzing ${selectedBoundaries.length} boundaries...`);
					const startTime = Date.now();

					const result = await groupBoundariesWithAI(
						baseUrl,
						apiKey,
						config.model!,
						config.locale,
						selectedBoundaries,
						maxGroups,
						config.type,
						timeout,
						argv.flags.prompt,
						(name, index, total) => {
							s.message(`🤖 [${index + 1}/${total}] Analyzing ${name}...`);
						},
						isStaged,
					);

					groups = result.groups;
					const duration = Date.now() - startTime;
					s.stop(`✅ Grouped into ${groups.length} commit${groups.length === 1 ? '' : 's'} in ${(duration / 1000).toFixed(1)}s`);
				}
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

			// Dry-run mode: show preview, optionally proceed
			if (argv.flags.dryRun) {
				if (!argv.flags.yes && process.stdout.isTTY) {
					const proceed = await confirm({
						message: 'Would you like to proceed and commit these groups?',
					});
					if (!isCancel(proceed) && proceed) {
						// Fall through to interactive commit flow below
					} else {
						outro(`${dim('Dry run — no changes were made')}`);
						return;
					}
				} else {
					outro(`${dim('Dry run — no changes were made')}`);
					return;
				}
			}

			// Auto-commit mode
			if (argv.flags.yes) {
				await commitGroups(groups, isStaged, files);
				outro(`${green('✔')} All ${groups.length} group${groups.length === 1 ? '' : 's'} committed!`);
				if (!argv.flags.noPostCommit) await runPostCommit(config, false);
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
				await commitGroups(groups, isStaged, files);
				outro(`${green('✔')} All ${groups.length} group${groups.length === 1 ? '' : 's'} committed!`);
				if (!argv.flags.noPostCommit) await runPostCommit(config, true);
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
				await commitGroups(selectedGroups, isStaged, files);
				outro(`${green('✔')} ${selectedGroups.length} group${selectedGroups.length === 1 ? '' : 's'} committed!`);
				if (!argv.flags.noPostCommit) await runPostCommit(config, true);
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

				await commitGroups(editedGroups, isStaged, files);
				outro(`${green('✔')} All ${editedGroups.length} group${editedGroups.length === 1 ? '' : 's'} committed!`);
				if (!argv.flags.noPostCommit) await runPostCommit(config, true);
				return;
			}
		})().catch(handleCommandError);
	}
);

async function commitGroups(groups: CommitGroup[], staged?: boolean, allFiles?: string[]) {
	// In staged mode: unstage all files first, then re-stage per group
	if (staged && allFiles) {
		// Collect all files that will be committed
		const committedFiles = new Set<string>();

		for (let i = 0; i < groups.length; i++) {
			const group = groups[i];
			const progress = spinner();
			progress.start(`[${i + 1}/${groups.length}] Committing: ${dim(group.message)}`);

			// Unstage files not in this group (that haven't been committed yet)
			const remainingFiles = allFiles.filter(
				(f) => !committedFiles.has(f) && !group.files.includes(f),
			);
			await unstageFiles(remainingFiles);

			// Ensure this group's files are staged
			await stageFiles(group.files);
			await execa('git', ['commit', '-m', group.message]);

			for (const f of group.files) committedFiles.add(f);

			// Re-stage remaining files for the next iteration
			const nextRemaining = allFiles.filter((f) => !committedFiles.has(f));
			if (nextRemaining.length > 0) {
				await stageFiles(nextRemaining);
			}

			progress.stop(`${green('✔')} [${i + 1}/${groups.length}] ${group.message}`);
		}
	} else {
		// Unstaged mode: stage and commit each group
		for (let i = 0; i < groups.length; i++) {
			const group = groups[i];
			const progress = spinner();
			progress.start(`[${i + 1}/${groups.length}] Staging & committing: ${dim(group.message)}`);

			await stageFiles(group.files);
			await execa('git', ['commit', '-m', group.message]);

			progress.stop(`${green('✔')} [${i + 1}/${groups.length}] ${group.message}`);
		}
	}
}
