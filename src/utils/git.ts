import { execa } from 'execa';
import { KnownError } from './error.js';

export const assertGitRepo = async () => {
	const { stdout, failed } = await execa(
		'git',
		['rev-parse', '--show-toplevel'],
		{ reject: false }
	);

	if (failed) {
		throw new KnownError('The current directory must be a Git repository!');
	}

	return stdout;
};

const excludeFromDiff = (path: string) => `:(exclude)${path}`;

const lockFilePatterns = [
	'package-lock.json',
	'pnpm-lock.yaml',
	// yarn.lock, Cargo.lock, Gemfile.lock, Pipfile.lock, etc.
	'*.lock',
];

const isLockFile = (file: string) => {
	return lockFilePatterns.some(pattern => {
		if (pattern.includes('*')) {
			// Simple glob match for *.lock
			return file.endsWith('.lock');
		}
		// Match lock files by basename to handle subdirectories
		return file.endsWith('/' + pattern) || file === pattern;
	});
};

const filesToExclude = lockFilePatterns.map(excludeFromDiff);

export const getStagedDiff = async (excludeFiles?: string[], scopePath?: string) => {
	const diffCached = ['diff', '--cached', '--diff-algorithm=minimal'];
	const pathspec = scopePath ? ['--', scopePath] : [];

	// First, get all staged files without any excludes
	const { stdout: allFilesOutput } = await execa('git', [
		...diffCached,
		'--name-only',
		...(excludeFiles ? excludeFiles.map(excludeFromDiff) : []),
		...pathspec,
	]);

	if (!allFilesOutput) {
		return;
	}

	const allFiles = allFilesOutput.split('\n').filter(Boolean);

	// Check if all staged files are lock files
	const hasNonLockFiles = allFiles.some(file => !isLockFile(file));

	let excludes: string[] = [];
	if (hasNonLockFiles) {
		// If there are non-lock files, exclude lock files
		excludes = [...filesToExclude];
	}
	// If only lock files are staged, don't exclude them

	excludes = [
		...excludes,
		...(excludeFiles ? excludeFiles.map(excludeFromDiff) : []),
	];

	// Get files after applying excludes
	const { stdout: files } = await execa('git', [
		...diffCached,
		'--name-only',
		...excludes,
		...pathspec,
	]);

	if (!files) {
		return;
	}

	const { stdout: diff } = await execa('git', [
		...diffCached,
		...excludes,
		...pathspec,
	]);

	return {
		files: files.split('\n'),
		diff,
	};
};

/**
 * Get the count of staged files outside a given scope path.
 * Used to inform the user about excluded files when scoping.
 */
export const getStagedFilesOutsideScope = async (scopePath: string, excludeFiles?: string[]): Promise<string[]> => {
	const diffCached = ['diff', '--cached', '--diff-algorithm=minimal'];
	const excludes = excludeFiles ? excludeFiles.map(excludeFromDiff) : [];

	const { stdout } = await execa('git', [
		...diffCached,
		'--name-only',
		...excludes,
	]);

	if (!stdout) return [];

	const allFiles = stdout.split('\n').filter(Boolean);
	const scopePrefix = scopePath.endsWith('/') ? scopePath : scopePath + '/';
	return allFiles.filter((f) => !f.startsWith(scopePrefix) && f !== scopePath);
};

export const getStagedDiffForFiles = async (files: string[], excludeFiles?: string[]) => {
	const diffCached = ['diff', '--cached', '--diff-algorithm=minimal'];
	const excludes = [
		...filesToExclude,
		...(excludeFiles ? excludeFiles.map(excludeFromDiff) : []),
	];

	const { stdout: diff } = await execa('git', [
		...diffCached,
		'--',
		...files,
		...excludes,
	]);

	return {
		files,
		diff,
	};
};

export const getDetectedMessage = (files: string[]) =>
	`Detected ${files.length.toLocaleString()} staged file${
		files.length > 1 ? 's' : ''
	}`;

export const getUnstagedChanges = async (includeUntracked?: boolean) => {
	// Get modified tracked files
	const { stdout: modifiedOutput } = await execa('git', [
		'diff',
		'--name-only',
		'--diff-algorithm=minimal',
	]);

	const modifiedFiles = modifiedOutput.split('\n').filter(Boolean);

	let untrackedFiles: string[] = [];
	if (includeUntracked) {
		const { stdout: untrackedOutput } = await execa('git', [
			'ls-files',
			'--others',
			'--exclude-standard',
		]);
		untrackedFiles = untrackedOutput.split('\n').filter(Boolean);
	}

	const allFiles = [...modifiedFiles, ...untrackedFiles];
	if (allFiles.length === 0) return;

	// Get diff for modified files (untracked files have no diff yet)
	let diff = '';
	if (modifiedFiles.length > 0) {
		const hasNonLockFiles = modifiedFiles.some((f) => !isLockFile(f));
		const excludes = hasNonLockFiles ? filesToExclude : [];

		const { stdout } = await execa('git', [
			'diff',
			'--diff-algorithm=minimal',
			...excludes,
		]);
		diff = stdout;
	}

	return {
		files: allFiles,
		modifiedFiles,
		untrackedFiles,
		diff,
	};
};

export const stageFiles = async (files: string[]) => {
	await execa('git', ['add', '--', ...files]);
};

export const getUnstagedDiffForFiles = async (files: string[]) => {
	if (files.length === 0) return '';
	const { stdout } = await execa('git', [
		'diff',
		'--diff-algorithm=minimal',
		'--',
		...files,
	]);
	return stdout;
};

export const getUnstagedDiffStat = async (files: string[]) => {
	if (files.length === 0) return '';
	const { stdout } = await execa('git', [
		'diff',
		'--stat',
		'--diff-algorithm=minimal',
		'--',
		...files,
	]);
	return stdout;
};

export const getPartiallyStaged = async (): Promise<string[]> => {
	const [{ stdout: staged }, { stdout: unstaged }] = await Promise.all([
		execa('git', ['diff', '--cached', '--name-only']),
		execa('git', ['diff', '--name-only']),
	]);
	const stagedSet = new Set(staged.split('\n').filter(Boolean));
	return unstaged.split('\n').filter(Boolean).filter((f) => stagedSet.has(f));
};

export const unstageFiles = async (files: string[]) => {
	if (files.length === 0) return;
	await execa('git', ['reset', 'HEAD', '--', ...files]);
};

export const getStagedDiffForBoundary = async (files: string[]) => {
	if (files.length === 0) return '';
	const { stdout } = await execa('git', [
		'diff', '--cached', '--diff-algorithm=minimal', '--', ...files,
	]);
	return stdout;
};

export const getStagedDiffStat = async (files: string[]) => {
	if (files.length === 0) return '';
	const { stdout } = await execa('git', [
		'diff', '--cached', '--stat', '--diff-algorithm=minimal', '--', ...files,
	]);
	return stdout;
};
