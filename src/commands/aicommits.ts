import { execa } from 'execa';
import { black, dim, green, red, bgCyan } from 'kolorist';
import clipboard from 'clipboardy';
import {
	intro,
	outro,
	spinner,
	select,
	confirm,
	isCancel,
} from '@clack/prompts';
import {
	assertGitRepo,
	getStagedDiff,
	getDetectedMessage,
} from '../utils/git.js';
import { getConfig, setConfigs } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import { generateCommitMessage } from '../utils/openai.js';
import { KnownError, handleCommandError } from '../utils/error.js';
import { TOGETHER_PREFERRED_MODEL } from '../utils/constants.js';



const getCommitMessage = async (
	messages: string[],
	skipConfirm: boolean
): Promise<string | null> => {
	// Single message case
	if (messages.length === 1) {
		const [message] = messages;

		if (skipConfirm) {
			return message;
		}

		console.log(`\n\x1b[1m${message}\x1b[0m\n`);
		const confirmed = await confirm({
			message: 'Use this commit message?',
		});

		return confirmed && !isCancel(confirmed) ? message : null;
	}

	// Multiple messages case
	if (skipConfirm) {
		return messages[0];
	}

	const selected = await select({
		message: `Pick a commit message to use: ${dim('(Ctrl+c to exit)')}`,
		options: messages.map((value) => ({ label: value, value })),
	});

	return isCancel(selected) ? null : (selected as string);
};

export default async (
	generate: number | undefined,
	excludeFiles: string[],
	stageAll: boolean,
	commitType: string | undefined,
	skipConfirm: boolean,
	copyToClipboard: boolean,
	rawArgv: string[]
) =>
	(async () => {
		intro(bgCyan(black(' aicommits ')));

		await assertGitRepo();

		const detectingFiles = spinner();

		if (stageAll) {
			// This should be equivalent behavior to `git commit --all`
			await execa('git', ['add', '--update']);
		}

		detectingFiles.start('Detecting staged files');
		const staged = await getStagedDiff(excludeFiles);

		if (!staged) {
			detectingFiles.stop('Detecting staged files');
			throw new KnownError(
				'No staged changes found. Stage your changes manually, or automatically stage all changes with the `--all` flag.'
			);
		}

		detectingFiles.stop(
			`${getDetectedMessage(staged.files)}:\n${staged.files
				.map((file) => `     ${file}`)
				.join('\n')}`
		);

		const { env } = process;
		const config = await getConfig({
			generate: generate?.toString(),
			type: commitType?.toString(),
		});

		const providerInstance = getProvider(config);
		if (!providerInstance) {
			const isInteractive = process.stdout.isTTY && !process.env.CI;
			if (isInteractive) {
				console.log("Welcome to aicommits! Let's set up your AI provider.");
				console.log('Run `aicommits setup` to configure your provider.');
				outro('Setup required. Please run: aicommits setup');
				return;
			} else {
				throw new KnownError(
					'No configuration found. Run `aicommits setup` in an interactive terminal, or set environment variables (OPENAI_API_KEY, etc.)'
				);
			}
		}

		// Use config timeout, or default per provider
		const timeout = config.timeout || (providerInstance.name === 'ollama' ? 30_000 : 10_000);

		// Validate provider config
		const validation = providerInstance.validateConfig();
		if (!validation.valid) {
			throw new KnownError(
				`Provider configuration issues: ${validation.errors.join(
					', '
				)}. Run \`aicommits setup\` to reconfigure.`
			);
		}

		// Use the unified model setting or provider default
		config.model = config.OPENAI_MODEL || providerInstance.getDefaultModel();

		// For Together AI, fix undefined model
		if (config.provider === 'togetherai' && config.model === 'undefined') {
			config.model = TOGETHER_PREFERRED_MODEL;
			await setConfigs([['OPENAI_MODEL', TOGETHER_PREFERRED_MODEL]]);
		}

		const s = spinner();
		s.start(`Analyzing changes in ${staged.files.length} file${staged.files.length === 1 ? '' : 's'}`);
		const startTime = Date.now();
		let messages: string[];
		try {
			const baseUrl = providerInstance.getBaseUrl();
			const apiKey = providerInstance.getApiKey() || '';
			messages = await generateCommitMessage(
				baseUrl,
				apiKey,
				config.model,
				config.locale,
				staged.diff,
				config.generate,
				config['max-length'],
				config.type,
				timeout
			);
		} finally {
			const duration = Date.now() - startTime;
			s.stop(`Changes analyzed in ${duration}ms`);
		}

		if (messages.length === 0) {
			throw new KnownError('No commit messages were generated. Try again.');
		}

		// Get the commit message
		const message = await getCommitMessage(messages, skipConfirm);
		if (!message) {
			outro('Commit cancelled');
			return;
		}

		// Handle clipboard mode (early return)
		if (copyToClipboard) {
			try {
				await clipboard.write(message);
				outro(`${green('✔')} Message copied to clipboard`);
			} catch (error: unknown) {
				// Silently fail if clipboard is not available
			}
			return;
		}

		// Commit the message
		await execa('git', ['commit', '-m', message, ...rawArgv]);
		outro(`${green('✔')} Successfully committed!`);
	})().catch(handleCommandError);
