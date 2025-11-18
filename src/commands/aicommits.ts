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
import { getConfig } from '../utils/config.js';
import { getProvider } from '../feature/providers/index.js';
import { generateCommitMessage } from '../utils/openai.js';
import { KnownError, handleCliError } from '../utils/error.js';
import { fileExists } from '../utils/fs.js';
import path from 'path';
import os from 'os';

const getCommitMessage = async (messages: string[], skipConfirm: boolean): Promise<string | null> => {
	// Single message case
	if (messages.length === 1) {
		const [message] = messages;

		if (skipConfirm) {
			return message;
		}

		const confirmed = await confirm({
			message: `Use this commit message?\n\n   ${message}\n`,
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
			OPENAI_API_KEY: env.OPENAI_API_KEY || env.OPENAI_KEY,
			'openai-base-url': env.OPENAI_BASE_URL,
			'openai-model': env.OPENAI_MODEL,
			proxy:
				env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY,
			generate: generate?.toString(),
			type: commitType?.toString(),
		});

		const providerInstance = getProvider(config);
		if (!providerInstance) {
			const isInteractive = process.stdout.isTTY && !process.env.CI;
			if (isInteractive) {
				console.log('Welcome to aicommits! Let\'s set up your AI provider.');
				console.log('Run `aicommits setup` to configure your provider.');
				outro('Setup required. Please run: aicommits setup');
				return;
			} else {
				throw new KnownError(
					'No configuration found. Run `aicommits setup` in an interactive terminal, or set environment variables (OPENAI_API_KEY, etc.)'
				);
			}
		}

		// Validate provider config
		const validation = providerInstance.validateConfig();
		if (!validation.valid) {
			throw new KnownError(`Provider configuration issues: ${validation.errors.join(', ')}. Run \`aicommits setup\` to reconfigure.`);
		}

		// Model selection priority: env var > provider-specific > default
		if (config['openai-model'] && providerInstance.name === 'openai') {
			config.model = config['openai-model'];
		} else if (providerInstance.name === 'openai') {
			config.model = config['openai-model'];
		} else if (providerInstance.name === 'togetherai') {
			config.model = config['together-model'];
		} else {
			// For custom/ollama, use the general model setting
			config.model = config.model;
		}

		const s = spinner();
		s.start('The AI is analyzing your changes');
		const startTime = Date.now();
		let messages: string[];
		try {
			const hostname = providerInstance.getBaseUrl().replace(/^https?:\/\//, '');
			const apiKey = providerInstance.getApiKey() || '';
			messages = await generateCommitMessage(
				hostname,
				apiKey,
				config.model,
				config.locale,
				staged.diff,
				config.generate,
				config['max-length'],
				config.type,
				config.timeout,
				config.proxy
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
	})().catch((error) => {
		outro(`${red('✖')} ${error.message}`);
		handleCliError(error);
		process.exit(1);
	});
