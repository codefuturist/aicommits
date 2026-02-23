import { execa } from 'execa';
import { execSync } from 'child_process';
import { green, yellow, dim, bold } from 'kolorist';
import { spinner, confirm, isCancel } from '@clack/prompts';
import type { ValidConfig } from './config-types.js';
import {
	detectProjectType,
	getProjectRootPath,
	didCommitChangeSource,
	getCurrentBranch,
	getHeadTags,
	matchesGlobPattern,
} from './build-freshness.js';
import {
	getDefaultInstallDir,
	getProjectEntrypoint,
	getNodePath,
	getShellWrapper,
	getBinaryNames,
	checkWriteable,
	isInPath,
} from './install-paths.js';
import { writeFileSync, chmodSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';

function matchesBranchFilter(branch: string, filter: string): boolean {
	const patterns = filter.split(',').map((p) => p.trim()).filter(Boolean);
	if (patterns.length === 0) return true;
	return patterns.some((p) => matchesGlobPattern(branch, p));
}

function matchesTagFilter(tags: string[], pattern: string): boolean {
	if (!pattern) return true;
	return tags.some((tag) => matchesGlobPattern(tag, pattern));
}

export const runPostCommit = async (
	config: ValidConfig,
	interactive: boolean,
): Promise<void> => {
	const postCommit = config['post-commit'];
	const rebuildMode = config['post-commit-rebuild'] || 'off';
	const shouldInstall = config['post-commit-install'] || false;
	const branchFilter = config['post-commit-branches'];
	const tagPattern = config['post-commit-tag-pattern'];

	const hasRebuild = rebuildMode !== 'off';
	const hasCommands = postCommit && postCommit.trim().length > 0;

	// Nothing configured → early return
	if (!hasRebuild && !shouldInstall && !hasCommands) return;

	// Branch filter — applies to all post-commit actions
	if (branchFilter) {
		const branch = getCurrentBranch();
		if (branch && !matchesBranchFilter(branch, branchFilter)) {
			console.log(dim(`  Skipped post-commit: branch "${branch}" doesn't match "${branchFilter}"`));
			return;
		}
	}

	// Tag filter — applies to all post-commit actions
	if (tagPattern) {
		const tags = getHeadTags();
		if (tags.length === 0 || !matchesTagFilter(tags, tagPattern)) {
			console.log(dim(`  Skipped post-commit: HEAD not tagged (filter: "${tagPattern}")`));
			return;
		}
	}

	console.log('');
	console.log(bold('⚙ Post-commit pipeline:'));

	// Log branch/tag context
	const branch = getCurrentBranch();
	if (branch && branchFilter) {
		console.log(`  ${green('✓')} Branch: ${branch} ${dim(`(matches ${branchFilter})`)}`);
	}

	// Step 1: Rebuild
	let rebuildSucceeded = false;
	if (hasRebuild) {
		rebuildSucceeded = await runRebuildStep(rebuildMode, config, interactive);
	}

	// Step 2: Install (only after successful rebuild)
	if (shouldInstall && rebuildSucceeded) {
		await runInstallStep();
	}

	// Step 3: Custom post-commit commands
	if (hasCommands) {
		await runCommandsStep(postCommit!, interactive);
	}

	console.log('');
};

async function runRebuildStep(
	mode: 'smart' | 'always',
	config: ValidConfig,
	interactive: boolean,
): Promise<boolean> {
	const sourceDir = config['rebuild-source-dir'];

	// Smart mode: check if source files changed in this commit
	if (mode === 'smart') {
		const changed = didCommitChangeSource(sourceDir);
		if (!changed) {
			console.log(`  ${dim('○')} Rebuild: skipped ${dim('(no source changes in commit)')}`);
			return false;
		}
		console.log(`  ${green('✓')} Source changed in commit`);
	}

	// Determine build command
	const projectRoot = getProjectRootPath();
	const projectType = detectProjectType(projectRoot);
	const buildCommand = config['rebuild-command'] || projectType?.buildCommand || 'npm run build';

	// In interactive mode with smart, just inform; with always, optionally confirm
	if (interactive && mode === 'always') {
		const proceed = await confirm({
			message: `Rebuild? ${dim(`(${buildCommand})`)}`,
		});
		if (isCancel(proceed) || !proceed) {
			console.log(`  ${dim('○')} Rebuild: skipped by user`);
			return false;
		}
	}

	const s = spinner();
	s.start(`Rebuilding (${buildCommand})...`);

	try {
		execSync(buildCommand, {
			cwd: projectRoot,
			stdio: 'pipe',
			encoding: 'utf8',
		});
		s.stop(`  ${green('✓')} Rebuilt successfully`);
		return true;
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		s.stop(`  ${yellow('⚠')} Rebuild failed`);
		console.log(`    ${dim(msg.split('\n')[0])}`);
		return false;
	}
}

async function runInstallStep(): Promise<void> {
	const s = spinner();
	s.start('Installing binary...');

	try {
		const binDir = getDefaultInstallDir('user');
		const entrypoint = getProjectEntrypoint();
		const nodePath = getNodePath();
		const wrapperContent = getShellWrapper(nodePath, entrypoint);
		const isWindows = platform() === 'win32';

		// Ensure directory exists
		if (!existsSync(binDir)) {
			mkdirSync(binDir, { recursive: true, mode: 0o755 });
		}

		if (!checkWriteable(binDir)) {
			s.stop(`  ${yellow('⚠')} Install: ${binDir} not writeable`);
			return;
		}

		for (const name of getBinaryNames()) {
			const binPath = join(binDir, isWindows ? `${name}.cmd` : name);
			writeFileSync(binPath, wrapperContent, { mode: 0o755 });
			if (!isWindows) {
				chmodSync(binPath, 0o755);
			}
		}

		const names = [...getBinaryNames()].join(' + ');
		const inPath = isInPath(binDir) ? '' : dim(` (⚠ ${binDir} not in PATH)`);
		s.stop(`  ${green('✓')} Installed ${names} → ${dim(binDir)}${inPath}`);
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		s.stop(`  ${yellow('⚠')} Install failed: ${dim(msg)}`);
	}
}

async function runCommandsStep(postCommit: string, interactive: boolean): Promise<void> {
	const commands = postCommit
		.split(';')
		.map((c) => c.trim())
		.filter(Boolean);

	if (commands.length === 0) return;

	// In interactive mode, confirm before running
	if (interactive) {
		const proceed = await confirm({
			message: `Run post-commit: ${dim(postCommit)}`,
		});
		if (isCancel(proceed) || !proceed) return;
	}

	for (const cmd of commands) {
		const s = spinner();
		s.start(`Running: ${cmd}`);
		try {
			await execa(cmd, { shell: true, stdio: 'pipe' });
			s.stop(`  ${green('✓')} ${cmd}`);
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			s.stop(`  ${yellow('⚠')} Failed: ${cmd}`);
			console.log(`    ${dim(msg)}`);
		}
	}
}
