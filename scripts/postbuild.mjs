#!/usr/bin/env node
// Generates dist/.build-meta.json after each build.
// Used by the runtime freshness check to detect stale builds.

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const distDir = join(process.cwd(), 'dist');

function git(cmd) {
	try {
		return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
	} catch {
		return null;
	}
}

function getSourceFingerprint() {
	// Hash all source file contents (including uncommitted changes)
	try {
		const hash = execSync(
			'find src -name "*.ts" -type f -print0 | sort -z | xargs -0 shasum | shasum',
			{ encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
		).trim().split(/\s/)[0];
		return hash;
	} catch {
		return 'unknown';
	}
}

const srcTreeHash = git('rev-parse HEAD:src');
const gitCommit = git('rev-parse --short HEAD');
const gitCommitFull = git('rev-parse HEAD');
const srcFingerprint = getSourceFingerprint();

function getGitVersion() {
	// Try full git describe with tags first (works in full clones / local dev)
	const describe = git('describe --tags --always');
	if (describe) {
		// v2.0.0-develop.22-54-ge09020e → 2.0.0-develop.22+54.e09020e
		const match = describe.match(/^v?(.+?)(?:-(\d+)-g([0-9a-f]+))?$/);
		if (match) {
			const [, tag, ahead, hash] = match;
			if (!ahead || ahead === '0') return tag;
			return `${tag}+${ahead}.${hash}`;
		}
		return describe.replace(/^v/, '');
	}

	// No .git directory (pnpm tarball installs) — fetch latest tag via GitHub API
	try {
		const pkgJson = JSON.parse(
			readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
		);
		const repoUrl = typeof pkgJson.repository === 'string'
			? pkgJson.repository
			: pkgJson.repository?.url || '';
		const repoMatch = repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+)/);
		if (repoMatch) {
			const apiUrl = `https://api.github.com/repos/${repoMatch[1]}/tags?per_page=1`;
			const response = execSync(
				`curl -sf -H "Accept: application/vnd.github.v3+json" "${apiUrl}"`,
				{ encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
			);
			const tags = JSON.parse(response);
			if (tags.length > 0) {
				return tags[0].name.replace(/^v/, '');
			}
		}
	} catch {}

	return null;
}

const gitVersion = getGitVersion();

const meta = {
	version: gitVersion || 'unknown',
	srcTreeHash: srcTreeHash || 'unknown',
	srcFingerprint,
	gitCommit: gitCommit || 'unknown',
	gitCommitFull: gitCommitFull || 'unknown',
	builtAt: new Date().toISOString(),
};

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, '.build-meta.json'), JSON.stringify(meta, null, 2) + '\n');

console.log(`postbuild: wrote .build-meta.json (commit: ${meta.gitCommit}, src: ${meta.srcFingerprint.slice(0, 8)}...)`);
