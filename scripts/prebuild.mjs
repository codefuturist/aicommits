#!/usr/bin/env node
// Cleans stale build chunks from dist/ before a fresh build.
// Keeps dist/ from growing unboundedly with orphaned hash-named files.

import { readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const distDir = join(process.cwd(), 'dist');

try {
	const files = readdirSync(distDir);
	let removed = 0;

	for (const file of files) {
		// Remove old code-split chunks (cli-HASH.mjs, token-HASH.mjs, token-util-HASH.mjs)
		// Keep cli.mjs (the entry point) and .build-meta.json
		if (file === 'cli.mjs' || file === '.build-meta.json') continue;
		if (file.endsWith('.mjs')) {
			unlinkSync(join(distDir, file));
			removed++;
		}
	}

	if (removed > 0) {
		console.log(`prebuild: cleaned ${removed} stale chunk(s) from dist/`);
	}
} catch {
	// dist/ may not exist on first build — that's fine
}
