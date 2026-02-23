import { command } from 'cleye';
import { green, yellow, dim, bold } from 'kolorist';
import { spinner } from '@clack/prompts';
import { execSync } from 'child_process';
import {
	checkBuildFreshness,
	readBuildMeta,
	detectProjectType,
	getProjectRootPath,
} from '../utils/build-freshness.js';

export default command(
	{
		name: 'rebuild',
		description: 'Rebuild the project from source (detects project type automatically)',
		help: {
			description: 'Rebuild the project from source (detects project type automatically)',
		},
		parameters: [],
		flags: {
			info: {
				type: Boolean,
				description: 'Show build metadata and freshness status',
				default: false,
			},
			clean: {
				type: Boolean,
				description: 'Clean dist/ and rebuild fresh',
				default: false,
			},
		},
	},
	(argv) => {
		(async () => {
			const projectRoot = getProjectRootPath();
			const projectType = detectProjectType(projectRoot);

			if (argv.flags.info) {
				const meta = readBuildMeta();
				const freshness = checkBuildFreshness();

				console.log(bold('Build info:'));
				console.log(`  Status:      ${freshness.fresh ? green('✓ Fresh') : yellow('⚠ Stale')}`);

				if (projectType) {
					console.log(`  Project:     ${projectType.name}`);
				}

				if (meta) {
					console.log(`  Built at:    ${meta.builtAt}`);
					console.log(`  Git commit:  ${meta.gitCommit}`);
					console.log(`  Src hash:    ${meta.srcTreeHash}`);
				} else {
					console.log(`  ${dim('No .build-meta.json found (never built)')}`);
				}

				if (freshness.currentHash) {
					console.log(`  Current:     ${freshness.currentHash.slice(0, 12)}...`);
				}

				if (!freshness.fresh) {
					console.log(`  ${yellow(freshness.reason)}`);
				}

				const buildCmd = projectType?.buildCommand || 'npm run build';
				console.log(`  Build cmd:   ${dim(buildCmd)}`);
				console.log(`  Source dir:  ${dim(projectType?.sourceDir || 'src')}`);
				return;
			}

			// Rebuild
			const buildCommand = projectType?.buildCommand || 'npm run build';
			const s = spinner();
			s.start(`Rebuilding (${buildCommand})...`);

			try {
				execSync(buildCommand, {
					cwd: projectRoot,
					stdio: 'pipe',
					encoding: 'utf8',
				});
				s.stop(`${green('✓')} Rebuilt successfully`);

				const meta = readBuildMeta();
				if (meta) {
					console.log(dim(`  commit: ${meta.gitCommit} | src: ${meta.srcTreeHash.slice(0, 8)}...`));
				}
			} catch (error: unknown) {
				const msg = error instanceof Error ? error.message : String(error);
				s.stop(`${yellow('✗')} Rebuild failed`);
				console.error(dim(msg));
				process.exitCode = 1;
			}
		})();
	},
);
