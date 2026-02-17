import { cli } from 'cleye';
import pkg from '../package.json';
const { description, version } = pkg;
import aicommits from './commands/aicommits.js';
import prepareCommitMessageHook from './commands/prepare-commit-msg-hook.js';
import configCommand from './commands/config.js';
import setupCommand from './commands/setup.js';
import modelCommand from './commands/model.js';
import hookCommand, { isCalledFromGitHook } from './commands/hook.js';
import prCommand from './commands/pr.js';
import { checkAndAutoUpdate } from './utils/auto-update.js';

// Auto-update check - runs in production to update under the hood
// Skip during git hooks to avoid breaking commit flow
if (!isCalledFromGitHook && version !== '0.0.0-semantic-release') {
	const distTag = version.includes('-') ? 'develop' : 'latest';

	// Check for updates and auto-update if available
	checkAndAutoUpdate({
		pkg,
		distTag,
	});
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
					'Git commit message format (default: conventional). Supports conventional and gitmoji',
				alias: 't',
			},
			confirm: {
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
		version: {
			type: Boolean,
			description: 'Show version number',
			alias: 'v',
		},
		},

		commands: [configCommand, setupCommand, modelCommand, hookCommand, prCommand],

		help: {
			description,
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
				argv.flags.confirm,
				argv.flags.clipboard,
				argv.flags.noVerify,
				rawArgv
			);
		}
	},
	rawArgv
);
