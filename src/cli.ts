// Suppress AI SDK warnings (e.g., "temperature is not supported for reasoning models")
globalThis.AI_SDK_LOG_WARNINGS = false;

import { cli } from 'cleye';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pkg from '../package.json';
const { description, version: pkgVersion } = pkg;

// Derive display version from build metadata (git describe), falling back to package.json
function getDisplayVersion(): string {
	if (pkgVersion !== '0.0.0-semantic-release') return pkgVersion;
	try {
		const metaPath = join(dirname(fileURLToPath(import.meta.url)), '.build-meta.json');
		const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
		if (meta.version && meta.version !== 'unknown') return meta.version;
	} catch {}
	return pkgVersion;
}

const version = getDisplayVersion();
import aicommits from './commands/aicommits.js';
import prepareCommitMessageHook from './commands/prepare-commit-msg-hook.js';
import configCommand from './commands/config.js';
import setupCommand from './commands/setup.js';
import modelCommand from './commands/model.js';
import hookCommand, { isCalledFromGitHook } from './commands/hook.js';
import prCommand from './commands/pr.js';
import stageCommand from './commands/stage.js';
import syncCommand from './commands/sync.js';
import rebuildCommand from './commands/rebuild.js';
import installCommand from './commands/install.js';
import uninstallCommand from './commands/uninstall.js';
import doctorCommand from './commands/doctor.js';
import compileCommand from './commands/compile.js';
import { checkAndAutoUpdate } from './utils/auto-update.js';
import { checkAndRebuildIfStale } from './utils/dev-rebuild.js';

// Auto-update check - runs in production to update under the hood
// Skip during git hooks to avoid breaking commit flow
if (!isCalledFromGitHook && pkgVersion !== '0.0.0-semantic-release') {
	const distTag = pkgVersion.includes('-') ? 'develop' : 'latest';

	// Check for updates and auto-update if available
	checkAndAutoUpdate({
		pkg,
		distTag,
	});
}

// Dev-rebuild check - detects stale builds for development installs
// Skip during git hooks, for rebuild command itself, and for published versions
if (!isCalledFromGitHook && pkgVersion === '0.0.0-semantic-release') {
	const rawArgs = process.argv.slice(2);
	const isRebuildCommand = rawArgs[0] === 'rebuild';
	const isInstallCommand = rawArgs[0] === 'install' || rawArgs[0] === 'uninstall' || rawArgs[0] === 'compile';
	const hasRebuildFlag = rawArgs.includes('--rebuild');
	const hasNoRebuildFlag = rawArgs.includes('--no-rebuild');

	if (!hasNoRebuildFlag && !isRebuildCommand && !isInstallCommand) {
		// Skip stale check for informational flags that don't need a fresh build
		const isHelpOrVersion = rawArgs.includes('-h') || rawArgs.includes('--help') || rawArgs.includes('-v') || rawArgs.includes('--version');
		if (!isHelpOrVersion) {
			checkAndRebuildIfStale({ force: hasRebuildFlag });
		}
	}
}

const rawArgv = process.argv.slice(2);

cli(
	{
		name: 'aicommits',

		/**
		 * Since this is a wrapper around `git commit`,
		 * flags should not overlap with it
		 * https://git-scm.com/docs/git-commit
		 */
		flags: {
			generate: {
				type: Number,
				description:
					'Number of messages to generate (Warning: generating multiple costs more) (default: 1)',
				alias: 'g',
			},
			exclude: {
				type: [String],
				description: 'Files to exclude from AI analysis',
				alias: 'x',
			},
			all: {
				type: Boolean,
				description:
					'Automatically stage changes in tracked files for the commit',
				alias: 'a',
				default: false,
			},
			type: {
				type: String,
				description:
					'Git commit message format (default: plain). Supports plain, conventional, and gitmoji',
				alias: 't',
			},
			yes: {
				type: Boolean,
				description:
					'Skip confirmation when committing after message generation (default: false)',
				alias: 'y',
				default: false,
			},
			clipboard: {
				type: Boolean,
				description:
					'Copy the selected message to the clipboard instead of committing (default: false)',
				alias: 'c',
				default: false,
			},
			noVerify: {
				type: Boolean,
				description:
					'Bypass pre-commit hooks while committing (default: false)',
				alias: 'n',
				default: false,
			},
			noPostCommit: {
				type: Boolean,
				description:
					'Skip post-commit actions for this invocation (default: false)',
				default: false,
			},
			prompt: {
				type: String,
				description:
					'Custom prompt to guide the LLM behavior (e.g., specific language, style instructions)',
				alias: 'p',
			},
		scope: {
			type: String,
			description:
				'Scope commit to project boundary (auto=detect from cwd, none=disabled, or a path)',
			alias: 's',
		},
		version: {
			type: Boolean,
			description: 'Show version number',
			alias: 'v',
		},
		},

		commands: [configCommand, setupCommand, modelCommand, hookCommand, prCommand, stageCommand, syncCommand, rebuildCommand, installCommand, uninstallCommand, doctorCommand, compileCommand],

		help: {
			description: `${description}

Examples:
  # Core usage
  aicommits                          Generate a commit message for staged changes
  aicommits -y                       Generate and commit without confirmation
  aicommits -a -y                    Stage all tracked changes, generate, and commit
  aicommits -g 3                     Pick from 3 generated message options
  aicommits -s auto                  Scope commit to detected project boundary (monorepo)

  # Customize output
  aicommits -t conventional          Use conventional commit format (feat:, fix:, etc.)
  aicommits -t gitmoji               Use gitmoji commit format (🎉, 🐛, etc.)
  aicommits -p "write in German"     Guide the AI with a custom instruction
  aicommits -c                       Copy generated message to clipboard (don't commit)
  aicommits -x package-lock.json     Exclude a file from AI analysis

  # Atomic commits with AI
  aicommits split                    Split changes into logical atomic commits with AI
  aicommits split -d                 Preview commit groups without committing (dry run)
  aicommits split -S                 Re-group already-staged files into multiple commits

  # Configuration
  aicommits setup                    Interactive provider/API key setup
  aicommits model                    Switch AI model
  aicommits config info              Show all config sources and active settings
  aicommits config set type=conventional          Set default commit format
  aicommits config set post-commit="git push"     Auto-push after every commit
  aicommits config set post-commit-rebuild=smart  Auto-rebuild binary after commits

  # Sync with default branch
  aicommits sync                     Interactive sync (asks merge or rebase)
  aicommits sync --rebase            Rebase onto default branch
  aicommits sync --merge             Merge default branch into current
  aicommits sync -s auto             Scope-aware sync analysis (monorepo)
  aicommits sync --abort             Abort an in-progress sync
  aicommits sync --continue          Continue after resolving conflicts

  # Installation & maintenance
  aicommits hook install             Auto-generate messages on every git commit
  aicommits install                  Install binary to ~/.local/bin
  aicommits compile                  Compile standalone native binary (via Bun)
  aicommits doctor                   Check for PATH conflicts`,
		},

		ignoreArgv: (type) => type === 'unknown-flag' || type === 'argument',
	},
	(argv) => {
		if (argv.flags.version) {
			console.log(version);
			process.exit(0);
		}

		if (isCalledFromGitHook) {
			prepareCommitMessageHook();
		} else {
			aicommits(
				argv.flags.generate,
				argv.flags.exclude,
				argv.flags.all,
				argv.flags.type,
				argv.flags.yes,
				argv.flags.clipboard,
				argv.flags.noVerify,
				argv.flags.noPostCommit,
				argv.flags.prompt,
				argv.flags.scope,
				rawArgv
			);
		}
	},
	rawArgv
);
