import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Fetch latest refs from origin.
 */
export const fetchOrigin = async () => {
	await execa('git', ['fetch', 'origin'], { reject: false });
};

/**
 * Detect the default branch name from remote HEAD.
 * Falls back to 'main' if detection fails.
 */
export const getDefaultBranch = async (): Promise<string> => {
	try {
		const { stdout } = await execa('git', [
			'symbolic-ref',
			'refs/remotes/origin/HEAD',
		]);
		return stdout.trim().replace('refs/remotes/origin/', '');
	} catch {
		return 'main';
	}
};

/**
 * Get the current branch name.
 */
export const getCurrentBranch = async (): Promise<string> => {
	const { stdout } = await execa('git', ['branch', '--show-current']);
	return stdout.trim();
};

/**
 * Get ahead/behind counts relative to a remote branch.
 */
export const getBranchStatus = async (
	defaultBranch: string,
): Promise<{ ahead: number; behind: number }> => {
	try {
		const { stdout } = await execa('git', [
			'rev-list',
			'--left-right',
			'--count',
			`origin/${defaultBranch}...HEAD`,
		]);
		const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
		return { ahead: ahead || 0, behind: behind || 0 };
	} catch {
		return { ahead: 0, behind: 0 };
	}
};

/**
 * Count how many incoming commits from default branch touch a scope path.
 */
export const getCommitsBehindForScope = async (
	defaultBranch: string,
	scopePath: string,
): Promise<number> => {
	try {
		const { stdout } = await execa('git', [
			'rev-list',
			'--count',
			`HEAD..origin/${defaultBranch}`,
			'--',
			scopePath,
		]);
		return parseInt(stdout.trim(), 10) || 0;
	} catch {
		return 0;
	}
};

/**
 * Check if working tree has uncommitted changes.
 */
export const hasUncommittedChanges = async (): Promise<boolean> => {
	const { stdout } = await execa('git', ['status', '--porcelain']);
	return stdout.trim().length > 0;
};

/**
 * Stash uncommitted changes with a descriptive message.
 */
export const stashChanges = async (message?: string): Promise<boolean> => {
	const args = ['stash', 'push', '--include-untracked'];
	if (message) {
		args.push('-m', message);
	}
	const { stdout } = await execa('git', args);
	// git stash returns "No local changes to save" if nothing to stash
	return !stdout.includes('No local changes');
};

/**
 * Pop the most recent stash entry.
 */
export const popStash = async (): Promise<boolean> => {
	try {
		await execa('git', ['stash', 'pop']);
		return true;
	} catch {
		return false;
	}
};

/**
 * Rebase current branch onto a remote branch.
 * Returns true on success, false on conflict.
 */
export const rebaseOnto = async (
	targetBranch: string,
): Promise<{ success: boolean; error?: string }> => {
	try {
		await execa('git', ['rebase', `origin/${targetBranch}`]);
		return { success: true };
	} catch (error: any) {
		return {
			success: false,
			error: error.stderr || error.message || String(error),
		};
	}
};

/**
 * Merge a remote branch into the current branch.
 * Returns true on success, false on conflict.
 */
export const mergeFrom = async (
	targetBranch: string,
): Promise<{ success: boolean; error?: string }> => {
	try {
		await execa('git', ['merge', `origin/${targetBranch}`]);
		return { success: true };
	} catch (error: any) {
		return {
			success: false,
			error: error.stderr || error.message || String(error),
		};
	}
};

/**
 * Check if an interactive rebase is in progress.
 */
export const isRebaseInProgress = async (): Promise<boolean> => {
	const { stdout: gitDir } = await execa('git', [
		'rev-parse',
		'--git-dir',
	]);
	const dir = gitDir.trim();
	return (
		existsSync(join(dir, 'rebase-merge')) ||
		existsSync(join(dir, 'rebase-apply'))
	);
};

/**
 * Check if a merge is in progress.
 */
export const isMergeInProgress = async (): Promise<boolean> => {
	const { stdout: gitDir } = await execa('git', [
		'rev-parse',
		'--git-dir',
	]);
	return existsSync(join(gitDir.trim(), 'MERGE_HEAD'));
};

/**
 * Abort an in-progress rebase.
 */
export const abortRebase = async (): Promise<void> => {
	await execa('git', ['rebase', '--abort']);
};

/**
 * Continue a rebase after conflicts are resolved.
 */
export const continueRebase = async (): Promise<{ success: boolean; error?: string }> => {
	try {
		await execa('git', ['rebase', '--continue'], {
			env: { ...process.env, GIT_EDITOR: 'true' },
		});
		return { success: true };
	} catch (error: any) {
		return {
			success: false,
			error: error.stderr || error.message || String(error),
		};
	}
};

/**
 * Abort an in-progress merge.
 */
export const abortMerge = async (): Promise<void> => {
	await execa('git', ['merge', '--abort']);
};

/**
 * Continue a merge (commit the merge result).
 */
export const continueMerge = async (): Promise<{ success: boolean; error?: string }> => {
	try {
		await execa('git', ['commit', '--no-edit']);
		return { success: true };
	} catch (error: any) {
		return {
			success: false,
			error: error.stderr || error.message || String(error),
		};
	}
};

/**
 * Get list of files with unresolved conflicts.
 */
export const getConflictedFiles = async (): Promise<string[]> => {
	const { stdout } = await execa('git', [
		'diff',
		'--name-only',
		'--diff-filter=U',
	]);
	return stdout
		.trim()
		.split('\n')
		.filter(Boolean);
};

/**
 * Split conflicted files into in-scope and outside-scope.
 */
export const getConflictsInScope = async (
	scopePath: string,
): Promise<{ inScope: string[]; outsideScope: string[] }> => {
	const all = await getConflictedFiles();
	const prefix = scopePath.endsWith('/') ? scopePath : scopePath + '/';
	const inScope = all.filter((f) => f.startsWith(prefix) || f === scopePath);
	const outsideScope = all.filter(
		(f) => !f.startsWith(prefix) && f !== scopePath,
	);
	return { inScope, outsideScope };
};

/**
 * Check if the current branch has been pushed to remote (has upstream tracking).
 */
export const isBranchPushed = async (branch: string): Promise<boolean> => {
	try {
		await execa('git', [
			'rev-parse',
			'--verify',
			`origin/${branch}`,
		]);
		return true;
	} catch {
		return false;
	}
};

/**
 * Get diff stat for a scope path within a ref range.
 * Useful for showing scope impact after sync.
 */
export const getScopeDiffStat = async (
	scopePath: string,
	beforeRef: string,
): Promise<string> => {
	try {
		const { stdout } = await execa('git', [
			'diff',
			'--stat',
			`${beforeRef}..HEAD`,
			'--',
			scopePath,
		]);
		return stdout.trim();
	} catch {
		return '';
	}
};

/**
 * Get the number of commits replayed/merged during the last operation.
 */
export const getCommitCount = async (
	fromRef: string,
	toRef: string = 'HEAD',
): Promise<number> => {
	try {
		const { stdout } = await execa('git', [
			'rev-list',
			'--count',
			`${fromRef}..${toRef}`,
		]);
		return parseInt(stdout.trim(), 10) || 0;
	} catch {
		return 0;
	}
};

/**
 * Get the current HEAD ref (short SHA).
 */
export const getHeadRef = async (): Promise<string> => {
	const { stdout } = await execa('git', ['rev-parse', '--short', 'HEAD']);
	return stdout.trim();
};
