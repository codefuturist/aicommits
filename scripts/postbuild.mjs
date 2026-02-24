#!/usr/bin/env node
// Generates dist/.build-meta.json after each build.
// Used by the runtime freshness check to detect stale builds.

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
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
	const describe = git('describe --tags --always');
	if (!describe) return null;

	// v2.0.0-develop.22-54-ge09020e → 2.0.0-develop.22+54.e09020e
	const match = describe.match(/^v?(.+?)(?:-(\d+)-g([0-9a-f]+))?$/);
	if (!match) return describe.replace(/^v/, '');

	const [, tag, ahead, hash] = match;
	if (!ahead || ahead === '0') return tag;
	return `${tag}+${ahead}.${hash}`;
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
