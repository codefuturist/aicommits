import { existsSync } from 'fs';
import { join, dirname, relative } from 'path';
import { execa } from 'execa';
import type { CommitGroup } from './openai.js';

export interface ProjectBoundary {
	name: string;
	type: string;
	files: string[];
	autoGroup?: CommitGroup;
}

interface MarkerDef {
	file: string;
	type: string;
}

// Strong markers: these definitively identify a project root
const STRONG_MARKERS: MarkerDef[] = [
	{ file: 'package.json', type: 'node' },
	{ file: 'pyproject.toml', type: 'python' },
	{ file: 'setup.py', type: 'python' },
	{ file: 'Cargo.toml', type: 'rust' },
	{ file: 'go.mod', type: 'go' },
	{ file: 'pom.xml', type: 'java' },
	{ file: 'build.gradle', type: 'java' },
	{ file: 'Gemfile', type: 'ruby' },
	{ file: 'Chart.yaml', type: 'helm' },
	{ file: 'helmfile.yaml', type: 'helm' },
];

// Weak markers: common in many subdirectories, only used at top-level depths
const WEAK_MARKERS: MarkerDef[] = [
	{ file: 'docker-compose.yml', type: 'docker' },
	{ file: 'docker-compose.yaml', type: 'docker' },
	{ file: 'ansible.cfg', type: 'ansible' },
	{ file: 'Justfile', type: 'taskrunner' },
	{ file: 'justfile', type: 'taskrunner' },
	{ file: 'Makefile', type: 'taskrunner' },
];

// Max depth for weak markers (0 = root, 1 = one level deep, etc.)
const WEAK_MARKER_MAX_DEPTH = 1;
// Target max boundaries to avoid excessive AI calls
const MAX_BOUNDARIES = 8;
// Boundaries with fewer files than this get merged into "misc" group
const MIN_BOUNDARY_FILES = 3;

const CLEANUP_PATTERNS = ['.obsolete', 'deprecated', 'archive', 'old', 'backup'];

function isCleanupDir(dirName: string): boolean {
	const lower = dirName.toLowerCase();
	return CLEANUP_PATTERNS.some((p) => lower.includes(p));
}

async function getSubmodulePaths(): Promise<string[]> {
	try {
		const { stdout } = await execa('git', [
			'config',
			'--file', '.gitmodules',
			'--get-regexp', 'path',
		]);
		return stdout
			.split('\n')
			.filter(Boolean)
			.map((line) => line.split(/\s+/)[1])
			.filter(Boolean);
	} catch {
		return [];
	}
}

function findMarkerType(dir: string, repoRoot: string): string | null {
	const depth = dir === '.' ? 0 : dir.split('/').length;

	// Strong markers always count
	for (const marker of STRONG_MARKERS) {
		if (existsSync(join(repoRoot, dir, marker.file))) {
			return marker.type;
		}
	}

	// Weak markers only at shallow depths
	if (depth <= WEAK_MARKER_MAX_DEPTH) {
		for (const marker of WEAK_MARKERS) {
			if (existsSync(join(repoRoot, dir, marker.file))) {
				return marker.type;
			}
		}
	}

	return null;
}

/**
 * Detect project boundaries for a list of changed files.
 * Groups files by the nearest project marker in their path hierarchy.
 */
export async function detectProjectBoundaries(
	files: string[],
	repoRoot: string,
): Promise<ProjectBoundary[]> {
	const submodulePaths = await getSubmodulePaths();

	// Collect unique directories from file paths
	const dirs = new Set<string>();
	for (const file of files) {
		let dir = dirname(file);
		while (dir && dir !== '.') {
			dirs.add(dir);
			dir = dirname(dir);
		}
		dirs.add('.'); // root
	}

	// Find all directories that have project markers
	const markerDirs = new Map<string, string>(); // dir -> type
	for (const dir of dirs) {
		const type = findMarkerType(dir, repoRoot);
		if (type) {
			markerDirs.set(dir, type);
		}
	}

	// Add submodule paths as boundaries
	for (const subPath of submodulePaths) {
		if (!markerDirs.has(subPath)) {
			markerDirs.set(subPath, 'submodule');
		}
	}

	// Sort marker dirs by depth (deepest first) for nearest-match assignment
	const sortedMarkers = [...markerDirs.entries()].sort(
		(a, b) => b[0].split('/').length - a[0].split('/').length,
	);

	// Assign each file to its nearest (deepest) boundary
	const boundaryFiles = new Map<string, { type: string; files: string[] }>();
	const assigned = new Set<string>();

	for (const file of files) {
		let matchedDir: string | null = null;
		let matchedType: string | null = null;

		for (const [dir, type] of sortedMarkers) {
			if (dir === '.' || file.startsWith(dir + '/')) {
				// Don't assign to root marker if there's a directory-level match
				if (dir === '.' && !matchedDir) {
					matchedDir = dir;
					matchedType = type;
				} else if (dir !== '.') {
					matchedDir = dir;
					matchedType = type;
					break; // deepest match found
				}
			}
		}

		// Fallback: group by top-level directory
		if (!matchedDir || matchedDir === '.') {
			const topDir = file.includes('/') ? file.split('/')[0] : '.';
			matchedDir = topDir;
			matchedType = matchedType || 'misc';
		}

		if (!boundaryFiles.has(matchedDir)) {
			boundaryFiles.set(matchedDir, { type: matchedType!, files: [] });
		}
		boundaryFiles.get(matchedDir)!.files.push(file);
		assigned.add(file);
	}

	// Build ProjectBoundary array with auto-group heuristics
	const boundaries: ProjectBoundary[] = [];

	for (const [dir, { type, files: boundaryFileList }] of boundaryFiles) {
		const boundary: ProjectBoundary = {
			name: dir === '.' ? 'root' : dir,
			type,
			files: boundaryFileList,
		};

		// Auto-group: cleanup directories
		if (isCleanupDir(dir)) {
			boundary.autoGroup = {
				message: `chore: clean up ${dir}`,
				files: boundaryFileList,
			};
		}

		boundaries.push(boundary);
	}

	// Sort: auto-grouped last, then by file count descending
	boundaries.sort((a, b) => {
		if (a.autoGroup && !b.autoGroup) return 1;
		if (!a.autoGroup && b.autoGroup) return -1;
		return b.files.length - a.files.length;
	});

	// Consolidate: merge excessive boundaries into parent or top-level groups
	if (boundaries.length > MAX_BOUNDARIES) {
		return consolidateBoundaries(boundaries, MAX_BOUNDARIES);
	}

	return boundaries;
}

/**
 * Consolidate boundaries when there are too many.
 * Merges small boundaries into their nearest top-level parent,
 * and tiny boundaries (< MIN_BOUNDARY_FILES) into a "misc" group.
 */
function consolidateBoundaries(boundaries: ProjectBoundary[], maxCount: number): ProjectBoundary[] {
	// Separate auto-grouped (they stay as-is)
	const autoGrouped = boundaries.filter((b) => b.autoGroup);
	let regular = boundaries.filter((b) => !b.autoGroup);

	// First pass: merge tiny boundaries into a misc group
	const keep: ProjectBoundary[] = [];
	const miscFiles: string[] = [];
	for (const b of regular) {
		if (b.files.length < MIN_BOUNDARY_FILES) {
			miscFiles.push(...b.files);
		} else {
			keep.push(b);
		}
	}
	if (miscFiles.length > 0) {
		keep.push({ name: 'misc', type: 'misc', files: miscFiles });
	}
	regular = keep;

	// Second pass: if still too many, merge by top-level directory
	const targetCount = maxCount - autoGrouped.length;
	if (regular.length > targetCount) {
		const merged = new Map<string, ProjectBoundary>();

		for (const b of regular) {
			const topDir = b.name.includes('/') ? b.name.split('/')[0] : b.name;

			if (merged.has(topDir)) {
				const parent = merged.get(topDir)!;
				parent.files.push(...b.files);
			} else {
				merged.set(topDir, {
					name: topDir,
					type: b.type,
					files: [...b.files],
				});
			}
		}

		regular = [...merged.values()];
	}

	// Sort by file count descending
	regular.sort((a, b) => b.files.length - a.files.length);

	return [...regular, ...autoGrouped];
}

/**
 * Detected boundary from CWD — used for commit scoping.
 */
export interface CwdBoundary {
	/** Relative path from git root (e.g., "apps/cli/aicommits") */
	path: string;
	/** Human-readable name (same as path, or "root" if at git root) */
	name: string;
	/** Project type (e.g., "node", "python", "rust") */
	type: string;
}

/**
 * Detect the project boundary by walking up from a starting directory.
 * When `startPath` is omitted, uses the current working directory.
 * When `startPath` is a relative path (e.g., "apps/api/src"), resolves it
 * relative to the git root and walks up to find the nearest project marker.
 * Returns the nearest boundary or null if no marker is found before the git root.
 */
export function detectBoundaryFromCwd(gitRoot: string, startPath?: string): CwdBoundary | null {
	let startDir: string;

	if (startPath) {
		// Resolve explicit path: could be absolute or relative to git root
		const resolved = startPath.startsWith('/')
			? relative(gitRoot, startPath)
			: startPath.replace(/\/$/, '');
		if (!resolved || resolved.startsWith('..')) return null;
		startDir = resolved;
	} else {
		// Default: use CWD
		const cwd = process.cwd();
		startDir = relative(gitRoot, cwd);
		if (!startDir || startDir.startsWith('..')) return null;
	}

	// Walk up from startDir to git root, checking each directory for strong markers
	let current = startDir;
	while (current && current !== '.') {
		for (const marker of STRONG_MARKERS) {
			if (existsSync(join(gitRoot, current, marker.file))) {
				return {
					path: current,
					name: current,
					type: marker.type,
				};
			}
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return null;
}

/**
 * Format a boundary summary for display.
 */
export function formatBoundarySummary(boundaries: ProjectBoundary[]): string {
	const totalFiles = boundaries.reduce((sum, b) => sum + b.files.length, 0);
	const lines = [`📁 Detected ${totalFiles} changes across ${boundaries.length} project boundaries:`];
	for (const b of boundaries) {
		const autoLabel = b.autoGroup ? ' (auto-grouped)' : '';
		const padded = b.name.padEnd(25);
		lines.push(`     ${padded} (${b.files.length} files, ${b.type})${autoLabel}`);
	}
	return lines.join('\n');
}

const TYPE_ICONS: Record<string, string> = {
	node: '📦',
	python: '🐍',
	rust: '🦀',
	go: '🐹',
	java: '☕',
	ruby: '💎',
	helm: '⎈',
	docker: '🐳',
	ansible: '🔧',
	taskrunner: '⚙️',
	submodule: '📎',
	misc: '📂',
};

/**
 * Format a detailed boundary overview for --scan display.
 * Shows a visual bar chart, type icons, and sample files per boundary.
 */
export function formatBoundaryDetails(boundaries: ProjectBoundary[]): string {
	const totalFiles = boundaries.reduce((sum, b) => sum + b.files.length, 0);
	const maxBar = 30;
	const maxFiles = Math.max(...boundaries.map((b) => b.files.length));
	const lines: string[] = [];

	for (const b of boundaries) {
		const icon = TYPE_ICONS[b.type] || '📁';
		const pct = totalFiles > 0 ? Math.round((b.files.length / totalFiles) * 100) : 0;
		const barLen = maxFiles > 0 ? Math.max(1, Math.round((b.files.length / maxFiles) * maxBar)) : 1;
		const bar = '█'.repeat(barLen);
		const autoTag = b.autoGroup ? ' [auto]' : '';
		const countStr = `${b.files.length}`.padStart(4);

		lines.push(`  ${icon} ${b.name}`);
		lines.push(`     ${bar} ${countStr} files (${pct}%) · ${b.type}${autoTag}`);

		// Show sample files (up to 3)
		const samples = b.files.slice(0, 3);
		for (const f of samples) {
			lines.push(`     · ${f}`);
		}
		if (b.files.length > 3) {
			lines.push(`     · … ${b.files.length - 3} more`);
		}
		lines.push('');
	}

	lines.push(`  Total: ${totalFiles} files across ${boundaries.length} boundaries`);
	return lines.join('\n');
}
