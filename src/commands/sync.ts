import { command } from 'cleye';
import { black, green, yellow, dim, bgCyan, bold } from 'kolorist';
import { execa } from 'execa';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
	intro,
	outro,
	spinner,
	select,
	confirm,
	isCancel,
	log,
} from '@clack/prompts';
import { assertGitRepo } from '../utils/git.js';
import { getConfig } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import { KnownError, handleCommandError } from '../utils/error.js';
import { detectBoundaryFromCwd } from '../utils/project-detection.js';
import {
	fetchOrigin,
	getDefaultBranch,
	getCurrentBranch,
	getBranchStatus,
	getCommitsBehindForScope,
	hasUncommittedChanges,
	stashChanges,
	popStash,
	rebaseOnto,
	mergeFrom,
	isRebaseInProgress,
	isMergeInProgress,
	abortRebase,
	abortMerge,
	continueRebase,
	continueMerge,
	getConflictedFiles,
	getConflictsInScope,
	isBranchPushed,
	getScopeDiffStat,
	getHeadRef,
} from '../utils/sync.js';

type SyncStrategy = 'merge' | 'rebase';

export default command(
	{
		name: 'sync',
		description:
			'Update current branch with latest changes from the default branch (merge or rebase)',
		flags: {
			merge: {
				type: Boolean,
				description: 'Use merge strategy',
				alias: 'm',
				default: false,
			},
			rebase: {
				type: Boolean,
				description: 'Use rebase strategy',
				alias: 'r',
				default: false,
			},
			abort: {
				type: Boolean,
				description: 'Abort an in-progress sync (rebase or merge)',
				default: false,
			},
			continue: {
				type: Boolean,
				description: 'Continue after resolving conflicts',
				default: false,
			},
			noStash: {
				type: Boolean,
				description: 'Don\'t auto-stash uncommitted changes',
				default: false,
			},
			noFetch: {
				type: Boolean,
				description: 'Skip fetching from remote',
				default: false,
			},
			scope: {
				type: String,
				description:
					'Scope sync analysis to project boundary (auto=detect from cwd, none=disabled, or a path)',
				alias: 's',
			},
		},
		help: {
			description: `Update current branch with latest changes from the default branch.

Provides a guided, interactive experience for merging or rebasing your
feature branch onto main/master. Scope-aware in monorepos.

Examples:
  aicommits sync                     Interactive sync (asks merge or rebase)
  aicommits sync --rebase            Rebase onto default branch
  aicommits sync --merge             Merge default branch into current
  aicommits sync --scope auto        Show scope-relevant sync analysis
  aicommits sync --abort             Abort an in-progress sync
  aicommits sync --continue          Continue after resolving conflicts`,
		},
	},
	(argv) => {
		(async () => {
			intro(bgCyan(black(' aicommits sync ')));

			const gitRoot = await assertGitRepo();
			const config = await getConfig();

			// --- Handle --abort ---
			if (argv.flags.abort) {
				await handleAbort();
				return;
			}

			// --- Handle --continue ---
			if (argv.flags.continue) {
				await handleContinue();
				return;
			}

			// --- Pre-flight checks ---
			const [currentBranch, defaultBranch] = await Promise.all([
				getCurrentBranch(),
				getDefaultBranch(),
			]);
			if (!currentBranch) {
				throw new KnownError('Not on a branch (detached HEAD state).');
			}

			if (currentBranch === defaultBranch) {
				throw new KnownError(
					`Already on the default branch (${defaultBranch}). Switch to a feature branch first.`,
				);
			}

			// Check for in-progress operations
			const [rebasing, merging] = await Promise.all([
				isRebaseInProgress(),
				isMergeInProgress(),
			]);
			if (rebasing || merging) {
				const op = rebasing ? 'rebase' : 'merge';
				throw new KnownError(
					`A ${op} is already in progress.\n` +
						`  Continue: aicommits sync --continue\n` +
						`  Abort:    aicommits sync --abort`,
				);
			}

			// --- Resolve scope ---
			const scopeFlag = argv.flags.scope;
			const scopeValue = scopeFlag || config.scope || 'none';
			let resolvedScope: string | undefined;
			let scopeBoundaryInfo: { name: string; type: string } | undefined;

			if (scopeValue === 'auto') {
				const boundary = detectBoundaryFromCwd(gitRoot);
				if (boundary) {
					resolvedScope = boundary.path;
					scopeBoundaryInfo = { name: boundary.name, type: boundary.type };
				}
			} else if (scopeValue !== 'none') {
				const boundary = detectBoundaryFromCwd(gitRoot, scopeValue);
				if (boundary) {
					resolvedScope = boundary.path;
					scopeBoundaryInfo = { name: boundary.name, type: boundary.type };
				} else {
					resolvedScope = scopeValue;
				}
			}

			// --- Display branch info ---
			log.info(`Branch: ${bold(currentBranch)} → ${dim(`origin/${defaultBranch}`)}`);
			if (resolvedScope) {
				const typeLabel = scopeBoundaryInfo ? ` (${scopeBoundaryInfo.type})` : '';
				log.info(`🎯 Scope: ${resolvedScope}${typeLabel}`);
			}

			// --- Fetch ---
			if (!argv.flags.noFetch) {
				const fetchSpinner = spinner();
				fetchSpinner.start('Fetching latest from origin...');
				await fetchOrigin();
				fetchSpinner.stop('Fetched latest from origin');
			}

			// --- Analyze status ---
			const status = await getBranchStatus(defaultBranch);

			if (status.behind === 0) {
				outro(`${green('✔')} Already up to date with ${defaultBranch}`);
				return;
			}

			let statusMsg = `Your branch is ${bold(String(status.behind))} commit${status.behind !== 1 ? 's' : ''} behind ${defaultBranch}`;
			if (status.ahead > 0) {
				statusMsg += ` and ${bold(String(status.ahead))} commit${status.ahead !== 1 ? 's' : ''} ahead`;
			}

			// Scope-aware behind count
			if (resolvedScope) {
				const scopeBehind = await getCommitsBehindForScope(
					defaultBranch,
					resolvedScope,
				);
				if (scopeBehind > 0) {
					statusMsg += `\n  📦 ${scopeBehind} of ${status.behind} commit${scopeBehind !== 1 ? 's' : ''} affect your scope (${resolvedScope})`;
				} else {
					statusMsg += `\n  📦 None of the incoming commits affect your scope (${resolvedScope})`;
				}
			}

			log.warn(statusMsg);

			// --- Stash if needed ---
			const autoStash = config['sync-auto-stash'] !== false && !argv.flags.noStash;
			let didStash = false;

			if (await hasUncommittedChanges()) {
				if (!autoStash) {
					throw new KnownError(
						'You have uncommitted changes. Commit or stash them first, or use --stash to auto-stash.',
					);
				}
				const stashSpinner = spinner();
				stashSpinner.start('Stashing uncommitted changes...');
				didStash = await stashChanges('aicommits sync: auto-stash');
				stashSpinner.stop(
					didStash
						? 'Stashed uncommitted changes'
						: 'No changes to stash',
				);
			}

			// --- Determine strategy ---
			let strategy: SyncStrategy;

			if (argv.flags.merge && argv.flags.rebase) {
				throw new KnownError('Cannot use both --merge and --rebase. Pick one.');
			}

			if (argv.flags.merge) {
				strategy = 'merge';
			} else if (argv.flags.rebase) {
				strategy = 'rebase';
			} else {
				const configStrategy = config['sync-strategy'] || 'ask';
				if (configStrategy === 'merge' || configStrategy === 'rebase') {
					strategy = configStrategy;
				} else {
					// Interactive pick with smart hint
					const pushed = await isBranchPushed(currentBranch);
					const rebaseLabel = pushed
						? 'Rebase onto ' + defaultBranch
						: 'Rebase onto ' + defaultBranch + dim(' (recommended — branch not pushed)');
					const mergeLabel = pushed
						? 'Merge ' + defaultBranch + ' into your branch' + dim(' (recommended — branch already pushed)')
						: 'Merge ' + defaultBranch + ' into your branch';

					const selected = await select({
						message: 'How would you like to update your branch?',
						options: pushed
							? [
									{ value: 'merge', label: mergeLabel },
									{ value: 'rebase', label: rebaseLabel },
									{ value: 'cancel', label: 'Cancel' },
								]
							: [
									{ value: 'rebase', label: rebaseLabel },
									{ value: 'merge', label: mergeLabel },
									{ value: 'cancel', label: 'Cancel' },
								],
					});

					if (isCancel(selected) || selected === 'cancel') {
						if (didStash) await popStash();
						outro('Sync cancelled');
						return;
					}
					strategy = selected as SyncStrategy;
				}
			}

			// --- Save ref for post-sync summary ---
			const beforeRef = await getHeadRef();

			// --- Execute ---
			const syncSpinner = spinner();
			const strategyLabel = strategy === 'rebase' ? 'Rebasing' : 'Merging';
			syncSpinner.start(
				`${strategyLabel} ${currentBranch} ${strategy === 'rebase' ? 'onto' : 'with'} origin/${defaultBranch}...`,
			);

			const result =
				strategy === 'rebase'
					? await rebaseOnto(defaultBranch)
					: await mergeFrom(defaultBranch);

			if (result.success) {
				syncSpinner.stop(
					`${green('✔')} Successfully ${strategy === 'rebase' ? 'rebased' : 'merged'}!`,
				);

				// Scope impact summary
				if (resolvedScope && beforeRef) {
					const scopeStat = await getScopeDiffStat(
						resolvedScope,
						beforeRef,
					);
					if (scopeStat) {
						log.info(
							`📦 Scope impact (${resolvedScope}):\n${scopeStat
								.split('\n')
								.map((l) => `  ${l}`)
								.join('\n')}`,
						);
					}
				}

				// Pop stash
				if (didStash) {
					const popSpinner = spinner();
					popSpinner.start('Restoring stashed changes...');
					const popped = await popStash();
					popSpinner.stop(
						popped
							? 'Restored stashed changes'
							: `${yellow('⚠')} Could not restore stash (may have conflicts)`,
					);
				}

				outro(
					`${green('✔')} Branch is now up to date with ${defaultBranch}`,
				);
			} else {
				syncSpinner.stop(`${yellow('⚠')} Conflicts detected`);
				await displayConflicts(resolvedScope);

				// Offer AI conflict analysis if a provider is configured
				await offerAiConflictAnalysis(config, resolvedScope);

				log.info(
					`${bold('Next steps:')}\n` +
						`  1. Resolve conflicts in your editor\n` +
						`  2. Stage resolved files: ${dim('git add <file>')}\n` +
						`  3. Continue: ${dim('aicommits sync --continue')}\n` +
						`  Or abort:  ${dim('aicommits sync --abort')}`,
				);

				outro(yellow('Sync paused — resolve conflicts to continue'));
			}
		})().catch(handleCommandError);
	},
);

async function handleAbort(): Promise<void> {
	const [rebasing, merging] = await Promise.all([
		isRebaseInProgress(),
		isMergeInProgress(),
	]);

	if (!rebasing && !merging) {
		throw new KnownError('No sync operation in progress to abort.');
	}

	const abortSpinner = spinner();
	if (rebasing) {
		abortSpinner.start('Aborting rebase...');
		await abortRebase();
		abortSpinner.stop('Rebase aborted');
	} else {
		abortSpinner.start('Aborting merge...');
		await abortMerge();
		abortSpinner.stop('Merge aborted');
	}

	outro(`${green('✔')} Sync aborted — branch restored to previous state`);
}

async function handleContinue(): Promise<void> {
	const [rebasing, merging] = await Promise.all([
		isRebaseInProgress(),
		isMergeInProgress(),
	]);

	if (!rebasing && !merging) {
		throw new KnownError('No sync operation in progress to continue.');
	}

	// Check for remaining conflicts
	const conflicts = await getConflictedFiles();
	if (conflicts.length > 0) {
		log.warn(
			`${yellow('⚠')} Unresolved conflicts remain:\n${conflicts
				.map((f) => `  · ${f}`)
				.join('\n')}`,
		);
		throw new KnownError(
			'Resolve all conflicts and stage the files before continuing.',
		);
	}

	const contSpinner = spinner();
	if (rebasing) {
		contSpinner.start('Continuing rebase...');
		const result = await continueRebase();
		if (!result.success) {
			contSpinner.stop(`${yellow('⚠')} Rebase continue failed`);
			throw new KnownError(
				result.error || 'Failed to continue rebase. Check for unresolved conflicts.',
			);
		}
		contSpinner.stop(`${green('✔')} Rebase continued successfully`);
	} else {
		contSpinner.start('Continuing merge...');
		const result = await continueMerge();
		if (!result.success) {
			contSpinner.stop(`${yellow('⚠')} Merge continue failed`);
			throw new KnownError(
				result.error || 'Failed to continue merge. Check for unresolved conflicts.',
			);
		}
		contSpinner.stop(`${green('✔')} Merge completed successfully`);
	}

	outro(`${green('✔')} Sync completed`);
}

async function displayConflicts(scopePath?: string): Promise<void> {
	if (scopePath) {
		const { inScope, outsideScope } = await getConflictsInScope(scopePath);

		if (inScope.length > 0) {
			log.warn(
				`📦 Conflicts in your scope (${scopePath}):\n${inScope
					.map((f) => `  · ${f}`)
					.join('\n')}`,
			);
		}
		if (outsideScope.length > 0) {
			log.info(
				`📁 Conflicts outside scope:\n${outsideScope
					.map((f) => `  · ${dim(f)}`)
					.join('\n')}`,
			);
		}
	} else {
		const files = await getConflictedFiles();
		log.warn(
			`Conflicts in ${files.length} file${files.length !== 1 ? 's' : ''}:\n${files
				.map((f) => `  · ${f}`)
				.join('\n')}`,
		);
	}
}

async function offerAiConflictAnalysis(
	config: any,
	scopePath?: string,
): Promise<void> {
	try {
		const providerInstance = getProvider(config);
		if (!providerInstance) return;

		let baseUrl = providerInstance.getBaseUrl();
		const apiKey = providerInstance.getApiKey();
		if (!baseUrl || !apiKey) return;

		// Ask user if they want AI analysis
		const wantAnalysis = await confirm({
			message: '🤖 Analyze conflicts with AI?',
		});

		if (isCancel(wantAnalysis) || !wantAnalysis) return;

		// Get conflicted files — prioritize scope if set
		let filesToAnalyze: string[];
		if (scopePath) {
			const { inScope } = await getConflictsInScope(scopePath);
			filesToAnalyze = inScope.length > 0 ? inScope : await getConflictedFiles();
		} else {
			filesToAnalyze = await getConflictedFiles();
		}

		// Limit to first 5 files to avoid token limits
		const maxFiles = 5;
		const truncated = filesToAnalyze.length > maxFiles;
		filesToAnalyze = filesToAnalyze.slice(0, maxFiles);

		// Read conflict diffs
		let conflictDiff = '';
		for (const file of filesToAnalyze) {
			try {
				const { stdout } = await execa('git', ['diff', '--', file]);
				if (stdout) {
					conflictDiff += `\n=== ${file} ===\n${stdout.substring(0, 5000)}\n`;
				}
			} catch {
				// Skip files we can't read
			}
		}

		if (!conflictDiff) return;

		if (!baseUrl.endsWith('/v1')) {
			baseUrl += '/v1';
		}

		const aiProvider =
			baseUrl === 'https://api.openai.com/v1'
				? createOpenAI({ apiKey })
				: createOpenAICompatible({
						name: 'custom',
						apiKey,
						baseURL: baseUrl,
					});

		const model = config.OPENAI_MODEL || providerInstance.getDefaultModel();
		const analysisSpinner = spinner();
		analysisSpinner.start('Analyzing conflicts...');

		const result = await generateText({
			model: aiProvider(model) as any,
			system: `You are a git conflict resolution assistant. Analyze the following git conflict diffs and provide a brief, actionable summary for each file. For each conflicting file:
1. Explain what both sides changed (in 1-2 sentences)
2. Suggest the best resolution approach (keep ours, keep theirs, combine both, or manual review needed)

Be concise. Use plain text, no markdown. Format:
<filename> — <what conflicted>
  Suggestion: <resolution approach>`,
			prompt: conflictDiff,
			maxRetries: 1,
			maxOutputTokens: 2000,
		});

		analysisSpinner.stop('🤖 AI conflict analysis:');
		const analysis = result.text.trim();
		if (analysis) {
			log.info(
				analysis
					.split('\n')
					.map((l) => `  ${l}`)
					.join('\n'),
			);
			if (truncated) {
				log.info(
					dim(`  (${filesToAnalyze.length} of ${filesToAnalyze.length + (truncated ? '+' : '')} files analyzed)`),
				);
			}
		}
		console.log('');
	} catch {
		// Silently skip AI analysis on any error — it's a nice-to-have
	}
}
