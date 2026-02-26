import { execa } from 'execa';
import { black, green, yellow, dim, bgCyan, bold } from 'kolorist';
import { copyToClipboard as copyMessage } from '../utils/clipboard.js';
import {
	intro,
	outro,
	spinner,
	select,
	isCancel,
	log,
} from '@clack/prompts';
import {
	assertGitRepo,
	getStagedDiff,
	getStagedDiffForFiles,
	getStagedFilesOutsideScope,
	getDetectedMessage,
} from '../utils/git.js';
import { getConfig } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import {
	generateCommitMessage,
	combineCommitMessages,
} from '../utils/openai.js';
import { KnownError, handleCommandError } from '../utils/error.js';
import { runPostCommit } from '../utils/post-commit.js';
import { detectBoundaryFromCwd } from '../utils/project-detection.js';

import { getCommitMessage } from '../utils/commit-helpers.js';
import {
	fetchOrigin,
	getDefaultBranch,
	getCurrentBranch as getSyncCurrentBranch,
	getBranchStatus,
	getCommitsBehindForScope,
	rebaseOnto,
	mergeFrom,
} from '../utils/sync.js';

export default async (
	generate: number | undefined,
	excludeFiles: string[],
	stageAll: boolean,
	commitType: string | undefined,
	skipConfirm: boolean,
	copyToClipboard: boolean,
	noVerify: boolean,
	noPostCommit: boolean,
	customPrompt: string | undefined,
	scopeFlag: string | undefined,
	rawArgv: string[]
) =>
	(async () => {
		intro(bgCyan(black(' aicommits ')));

		const gitRoot = await assertGitRepo();

		// Resolve scope: CLI flag > config > default ('none')
		const config = await getConfig({
			generate: generate?.toString(),
			type: commitType?.toString(),
		});
		const scopeValue = scopeFlag || config.scope || 'none';
		let resolvedScope: string | undefined;
		let scopeBoundaryInfo: { name: string; type: string } | undefined;

		if (scopeValue === 'auto') {
			const boundary = detectBoundaryFromCwd(gitRoot);
			if (boundary) {
				resolvedScope = boundary.path;
				scopeBoundaryInfo = { name: boundary.name, type: boundary.type };
			}
			// If no boundary detected (CWD is at git root), no scoping applied
		} else if (scopeValue !== 'none') {
			// Explicit path: detect boundary from that path (walks up to nearest marker)
			const boundary = detectBoundaryFromCwd(gitRoot, scopeValue);
			if (boundary) {
				resolvedScope = boundary.path;
				scopeBoundaryInfo = { name: boundary.name, type: boundary.type };
			} else {
				// No marker found — use the literal path as scope
				resolvedScope = scopeValue;
			}
		}

		const detectingFiles = spinner();

		if (stageAll) {
			// This should be equivalent behavior to `git commit --all`
			await execa('git', ['add', '--update']);
		}

		detectingFiles.start('Detecting staged files');
		const staged = await getStagedDiff(excludeFiles, resolvedScope);

		if (!staged) {
			detectingFiles.stop('Detecting staged files');
			if (resolvedScope) {
				throw new KnownError(
					`No staged changes found within scope: ${resolvedScope}\nStage your changes manually, or use \`--scope none\` to commit all staged files.`
				);
			}
			throw new KnownError(
				'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.'
			);
		}

		// Show scope indicator and file summary
		if (resolvedScope) {
			const typeLabel = scopeBoundaryInfo ? ` (${scopeBoundaryInfo.type})` : '';
			if (staged.files.length <= 10) {
				detectingFiles.stop(
					`🎯 Scope: ${resolvedScope}${typeLabel}\n📁 ${getDetectedMessage(staged.files)}:\n${staged.files
						.map((file) => `     ${file}`)
						.join('\n')}`
				);
			} else {
				detectingFiles.stop(
					`🎯 Scope: ${resolvedScope}${typeLabel}\n📁 ${getDetectedMessage(staged.files)}`
				);
			}

			// Show excluded files summary
			const outsideFiles = await getStagedFilesOutsideScope(resolvedScope, excludeFiles);
			if (outsideFiles.length > 0) {
				// Group by top-level directory
				const groups = new Map<string, number>();
				for (const f of outsideFiles) {
					const topDir = f.includes('/') ? f.split('/')[0] : '.';
					groups.set(topDir, (groups.get(topDir) || 0) + 1);
				}
				const groupLines = [...groups.entries()]
					.sort((a, b) => b[1] - a[1])
					.slice(0, 5)
					.map(([dir, count]) => `     ${dim('·')} ${dir} — ${count} file${count > 1 ? 's' : ''}`);
				console.log(`  ${yellow('⚠')}  ${outsideFiles.length} staged file${outsideFiles.length > 1 ? 's' : ''} outside scope (not included in this commit):`);
				for (const line of groupLines) {
					console.log(line);
				}
				if (groups.size > 5) {
					console.log(`     ${dim(`… and ${groups.size - 5} more directories`)}`);
				}
				console.log('');
			}
		} else if (staged.files.length <= 10) {
			detectingFiles.stop(
				`📁 ${getDetectedMessage(staged.files)}:\n${staged.files
					.map((file) => `     ${file}`)
					.join('\n')}`
			);
		} else {
			detectingFiles.stop(`📁 ${getDetectedMessage(staged.files)}`);
		}

		const providerInstance = getProvider(config);
		if (!providerInstance) {
			const isInteractive = process.stdout.isTTY && !process.env.CI;
			if (isInteractive) {
				console.log("Welcome to aicommits! Let's set up your AI provider.");
				console.log('Run `aicommits setup` to configure your provider.');
				outro('Setup required. Please run: aicommits setup');
				return;
			} else {
				throw new KnownError(
					'No configuration found. Run `aicommits setup` in an interactive terminal, or set environment variables (OPENAI_API_KEY, etc.)'
				);
			}
		}

		// Use config timeout, or default per provider
		const timeout =
			config.timeout || (providerInstance.name === 'ollama' ? 30_000 : 10_000);

		// Validate provider config
		const validation = providerInstance.validateConfig();
		if (!validation.valid) {
			throw new KnownError(
				`Provider configuration issues: ${validation.errors.join(
					', '
				)}. Run \`aicommits setup\` to reconfigure.`
			);
		}

		// Use the unified model setting or provider default
		config.model = config.OPENAI_MODEL || providerInstance.getDefaultModel();

		// Check if diff is large and needs chunking
		const MAX_FILES = 50;
		const CHUNK_SIZE = 50;
		const CHUNK_DELAY_MS = 6500; // ~9 requests/min, stays under rate limits
		let isChunking = false;
		if (staged.files.length > MAX_FILES) {
			isChunking = true;
		}

		const s = spinner();
		s.start(
			`🔍 Analyzing changes in ${staged.files.length} file${
				staged.files.length === 1 ? '' : 's'
			}`
		);
		const startTime = Date.now();
		let messages: string[];
		let usage: any;
		try {
			const baseUrl = providerInstance.getBaseUrl();
			const apiKey = providerInstance.getApiKey() || '';

			if (isChunking) {
				// Split files into chunks
				const chunks: string[][] = [];
				for (let i = 0; i < staged.files.length; i += CHUNK_SIZE) {
					chunks.push(staged.files.slice(i, i + CHUNK_SIZE));
				}

				const chunkMessages: string[] = [];
				let totalUsage = {
					promptTokens: 0,
					completionTokens: 0,
					totalTokens: 0,
				};

				for (let ci = 0; ci < chunks.length; ci++) {
					const chunk = chunks[ci];
					const chunkDiff = await getStagedDiffForFiles(chunk, excludeFiles);
					if (chunkDiff && chunkDiff.diff) {
						// Truncate diff if too large to avoid context limits
						const maxDiffLength = 30000; // Approximate 7.5k tokens
						let diffToUse = chunkDiff.diff;
						if (diffToUse.length > maxDiffLength) {
							diffToUse =
								diffToUse.substring(diffToUse.length - maxDiffLength) +
								'\n\n[Diff truncated due to size]';
						}
						const result = await generateCommitMessage(
							baseUrl,
							apiKey,
							config.model!,
							config.locale,
							diffToUse,
							config.generate,
							config['max-length'],
							config.type,
							timeout,
							customPrompt
						);
						chunkMessages.push(...result.messages);
						if (result.usage) {
							totalUsage.promptTokens +=
								(result.usage as any).promptTokens || 0;
							totalUsage.completionTokens +=
								(result.usage as any).completionTokens || 0;
							totalUsage.totalTokens += (result.usage as any).totalTokens || 0;
						}
					}
					// Rate-limit delay between chunks to avoid 429s
					if (ci < chunks.length - 1) {
						await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
					}
				}

				// Combine the chunk messages
				const combineResult = await combineCommitMessages(
					chunkMessages,
					baseUrl,
					apiKey,
					config.model!,
					config['max-length'],
					timeout,
				);
				messages = combineResult.messages;
				if (combineResult.usage) {
					totalUsage.promptTokens +=
						(combineResult.usage as any).promptTokens || 0;
					totalUsage.completionTokens +=
						(combineResult.usage as any).completionTokens || 0;
					totalUsage.totalTokens +=
						(combineResult.usage as any).totalTokens || 0;
				}
				usage = totalUsage;
			} else {
				// Truncate diff if too large to avoid context limits
				const maxDiffLength = 30000; // Approximate 7.5k tokens
				let diffToUse = staged.diff;
				if (diffToUse.length > maxDiffLength) {
					diffToUse =
						diffToUse.substring(diffToUse.length - maxDiffLength) +
						'\n\n[Diff truncated due to size]';
				}
				const result = await generateCommitMessage(
					baseUrl,
					apiKey,
					config.model!,
					config.locale,
					diffToUse,
					config.generate,
					config['max-length'],
					config.type,
					timeout,
					customPrompt
				);
				messages = result.messages;
				usage = result.usage;
			}
		} finally {
			const duration = Date.now() - startTime;
			let tokensStr = '';
			if (usage?.total_tokens) {
				const tokens = usage.total_tokens;
				const formattedTokens =
					tokens >= 1000 ? `${(tokens / 1000).toFixed(0)}k` : tokens.toString();
				const speed = Math.round(tokens / (duration / 1000));
				tokensStr = `, ${formattedTokens} tokens (${speed} tokens/s)`;
			}
			s.stop(
				`✅ Changes analyzed in ${(duration / 1000).toFixed(1)}s${tokensStr}`
			);
		}

		if (messages.length === 0) {
			throw new KnownError('No commit messages were generated. Try again.');
		}

		// Get the commit message
		const message = await getCommitMessage(messages, skipConfirm);
		if (!message) {
			outro('Commit cancelled');
			return;
		}

		// Handle clipboard mode (early return)
		if (copyToClipboard) {
			const success = await copyMessage(message);
			if (success) {
				outro(`${green('✔')} Message copied to clipboard`);
			}
			return;
		}

		// Commit the message with timeout
			try {
				const commitArgs = ['-m', message];
				if (noVerify) {
					commitArgs.push('--no-verify');
				}
				// When scoped, use pathspec to commit only in-scope files
				if (resolvedScope) {
					commitArgs.push('--', resolvedScope);
				}
				await execa('git', ['commit', ...commitArgs, ...rawArgv], {
					stdio: 'inherit',
					cleanup: true,
					timeout: 10000
				});
			outro(`${green('✔')} Successfully committed!`);

			// Run post-commit actions
			if (!noPostCommit) {
				await runPostCommit(config, !skipConfirm);
			}

			// Optional sync-after-commit check
			if (!noPostCommit && config['sync-after-commit'] === 'prompt' && !skipConfirm) {
				await checkSyncAfterCommit(resolvedScope);
			}
		} catch (error: any) {
			if (error.timedOut) {
				// Copy to clipboard if commit times out
				const success = await copyMessage(message);
				if (success) {
					outro(
						`${yellow(
							'⚠'
						)} Commit timed out after 10 seconds. Message copied to clipboard.`
					);
				} else {
					outro(
						`${yellow(
							'⚠'
						)} Commit timed out after 10 seconds. Could not copy to clipboard.`
					);
				}
				return;
			}
			throw error;
		}
	})().catch(handleCommandError);

async function checkSyncAfterCommit(
	scopePath?: string,
): Promise<void> {
	try {
		const [currentBranch, defaultBranch] = await Promise.all([
			getSyncCurrentBranch(),
			getDefaultBranch(),
		]);
		if (!currentBranch || currentBranch === defaultBranch) return;

		await fetchOrigin();
		const status = await getBranchStatus(defaultBranch);
		if (status.behind === 0) return;

		// Scope-aware: only prompt if incoming commits affect the scope
		let scopeRelevant = true;
		let scopeInfo = '';
		if (scopePath) {
			const scopeBehind = await getCommitsBehindForScope(defaultBranch, scopePath);
			if (scopeBehind === 0) {
				scopeRelevant = false;
			} else {
				scopeInfo = ` (${scopeBehind} affect ${scopePath})`;
			}
		}

		if (!scopeRelevant) return;

		log.info(
			`ℹ Your branch is ${bold(String(status.behind))} commit${status.behind !== 1 ? 's' : ''} behind ${defaultBranch}${scopeInfo}`,
		);

		const action = await select({
			message: `Sync with ${defaultBranch}?`,
			options: [
				{ value: 'skip', label: 'Skip' },
				{ value: 'rebase', label: `Rebase onto ${defaultBranch}` },
				{ value: 'merge', label: `Merge ${defaultBranch}` },
			],
		});

		if (isCancel(action) || action === 'skip') return;

		const result =
			action === 'rebase'
				? await rebaseOnto(defaultBranch)
				: await mergeFrom(defaultBranch);

		if (result.success) {
			log.success(
				`✔ ${action === 'rebase' ? 'Rebased' : 'Merged'} successfully`,
			);
		} else {
			log.warn(
				`⚠ Conflicts detected. Run ${dim('aicommits sync --continue')} after resolving.`,
			);
		}
	} catch {
		// Silently ignore sync check failures — don't break the commit flow
	}
}
