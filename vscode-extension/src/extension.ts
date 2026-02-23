import * as vscode from 'vscode';
import { getConfig, setApiKey } from './config';
import { getRepository, getStagedDiff, setCommitMessage, commit as gitCommit } from './git';
import { generateCommitMessage } from './ai';
import { AicommitsSidebarProvider } from './sidebar';
import type { CommitType, Repository } from './types';

const TIMEOUT_MS = 30_000;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let sidebarProvider: AicommitsSidebarProvider;

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('AI Commits');

	// Status bar: shows current model
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
	statusBarItem.command = 'aicommits.selectModel';
	statusBarItem.tooltip = 'AI Commits — click to change model';
	updateStatusBar(context);

	// Sidebar tree view
	sidebarProvider = new AicommitsSidebarProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('aicommits.sidebar', sidebarProvider),
	);
	refreshSidebar(context);

	// Watch git state changes to update staged files in sidebar
	watchGitState(context);

	// Register all commands
	context.subscriptions.push(
		vscode.commands.registerCommand('aicommits.generate', () =>
			handleGenerate(context),
		),
		vscode.commands.registerCommand('aicommits.generateConventional', () =>
			handleGenerate(context, 'conventional'),
		),
		vscode.commands.registerCommand('aicommits.generateGitmoji', () =>
			handleGenerate(context, 'gitmoji'),
		),
		vscode.commands.registerCommand('aicommits.generateAndCommit', () =>
			handleGenerate(context, undefined, true),
		),
		vscode.commands.registerCommand('aicommits.regenerate', () =>
			handleGenerate(context),
		),
		vscode.commands.registerCommand('aicommits.setup', () =>
			handleSetup(context),
		),
		vscode.commands.registerCommand('aicommits.selectModel', () =>
			handleSelectModel(context),
		),
		outputChannel,
		statusBarItem,
	);

	// Update status bar and sidebar when config changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('aicommits')) {
				updateStatusBar(context);
				refreshSidebar(context);
			}
		}),
	);
}

// ── Status Bar ──────────────────────────────────────────────

async function updateStatusBar(context: vscode.ExtensionContext) {
	try {
		const config = await getConfig(context.secrets);
		const modelName = config.model.split('/').pop() || config.model;
		statusBarItem.text = `$(sparkle) ${modelName}`;
		statusBarItem.show();
	} catch {
		statusBarItem.hide();
	}
}

// ── Sidebar ─────────────────────────────────────────────────

async function refreshSidebar(context: vscode.ExtensionContext) {
	try {
		const config = await getConfig(context.secrets);
		sidebarProvider.updateConfig(config);

		const hasKey = config.apiKey.length > 0;
		await vscode.commands.executeCommand('setContext', 'aicommits.hasApiKey', hasKey);

		const repo = getRepository();
		sidebarProvider.updateStagedChanges(repo ? repo.state.indexChanges : []);
	} catch {
		// Silently ignore — sidebar will show defaults
	}
}

/** Watch git repository state and refresh sidebar when staged files change. */
function watchGitState(context: vscode.ExtensionContext) {
	const repo = getRepository();
	if (!repo) { return; }

	context.subscriptions.push(
		repo.onDidRunGitStatus(() => {
			sidebarProvider.updateStagedChanges(repo.state.indexChanges);
		}),
	);
}

// ── Generate Command ────────────────────────────────────────

async function handleGenerate(
	context: vscode.ExtensionContext,
	typeOverride?: CommitType,
	autoCommit = false,
) {
	// Validate prerequisites
	const repo = getRepository();
	if (!repo) {
		vscode.window.showErrorMessage('No Git repository found');
		return;
	}

	const config = await getConfig(context.secrets);
	if (!config.apiKey) {
		const action = await vscode.window.showWarningMessage(
			'No API key configured. Set one up now?',
			'Setup',
			'Cancel',
		);
		if (action === 'Setup') { await handleSetup(context); }
		return;
	}

	// Apply type override
	if (typeOverride) { config.type = typeOverride; }

	// Auto-commit also reads VS Code setting
	const vsConfig = vscode.workspace.getConfiguration('aicommits');
	const shouldAutoCommit = autoCommit || vsConfig.get<boolean>('autoCommit', false);

	// Save original input box value for rollback
	const originalMessage = repo.inputBox.value;

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'AI Commits',
			cancellable: true,
		},
		async (progress, token) => {
			try {
				// Get staged diff
				progress.report({ message: 'Getting staged diff...' });
				const diff = await getStagedDiff(repo);

				if (!diff || diff.trim().length === 0) {
					vscode.window.showWarningMessage(
						'No staged changes found. Stage some files first.',
					);
					return;
				}

				// Generate
				progress.report({ message: `Generating with ${config.model.split('/').pop()}...` });
				const abortController = new AbortController();
				const timeout = setTimeout(() => abortController.abort(), TIMEOUT_MS);

				// Abort on user cancel
				token.onCancellationRequested(() => abortController.abort());

				const result = await generateCommitMessage(config, diff, abortController.signal);
				clearTimeout(timeout);

				if (!result.messages || result.messages.length === 0) {
					vscode.window.showWarningMessage('No commit message generated. Try again.');
					return;
				}

				// Log usage
				if (result.usage) {
					outputChannel.appendLine(
						`[Generate] Tokens: ${result.usage.prompt_tokens} prompt + ${result.usage.completion_tokens} completion = ${result.usage.total_tokens} total`,
					);
				}

				// Single suggestion → set directly
				let selectedMessage: string;
				if (result.messages.length === 1) {
					selectedMessage = result.messages[0];
				} else {
					// Multiple suggestions → QuickPick
					const picked = await vscode.window.showQuickPick(
						result.messages.map((m, i) => ({
							label: m,
							description: `Option ${i + 1}`,
						})),
						{
							placeHolder: 'Select a commit message',
							title: 'AI Commits — Choose a message',
						},
					);
					if (!picked) { return; }
					selectedMessage = picked.label;
				}

				if (shouldAutoCommit) {
					await commitWithMessage(repo, selectedMessage);
				} else {
					setCommitMessage(repo, selectedMessage);
					vscode.window.showInformationMessage('✨ Commit message generated!');
				}

				sidebarProvider.updateLastMessage(selectedMessage);
				sidebarProvider.updateStagedChanges(repo.state.indexChanges);
			} catch (error) {
				repo.inputBox.value = originalMessage;
				const msg = error instanceof Error ? error.message : String(error);

				if (msg.includes('abort')) {
					outputChannel.appendLine('[Generate] Cancelled by user');
					return;
				}

				outputChannel.appendLine(`[Generate] Error: ${msg}`);
				vscode.window.showErrorMessage(`AI Commits: ${msg}`);
			}
		},
	);
}

// ── Commit Helper ───────────────────────────────────────────

async function commitWithMessage(repo: Repository, message: string) {
	try {
		await gitCommit(repo, message);
		vscode.window.showInformationMessage('✅ Committed successfully!');
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`Failed to commit: ${msg}`);
	}
}

// ── Setup Command ───────────────────────────────────────────

async function handleSetup(context: vscode.ExtensionContext) {
	const apiKey = await vscode.window.showInputBox({
		title: 'AI Commits Setup',
		prompt: 'Enter your API key (OpenAI, GitHub Copilot token, or compatible)',
		password: true,
		placeHolder: 'sk-... or gho_...',
		ignoreFocusOut: true,
	});

	if (!apiKey) { return; }

	await setApiKey(context.secrets, apiKey);

	const baseUrl = await vscode.window.showInputBox({
		title: 'API Base URL',
		prompt: 'Base URL for the API (leave default for OpenAI)',
		value: 'https://api.openai.com/v1',
		placeHolder: 'https://api.openai.com/v1',
		ignoreFocusOut: true,
	});

	if (baseUrl) {
		await vscode.workspace.getConfiguration('aicommits').update(
			'baseUrl', baseUrl, vscode.ConfigurationTarget.Global,
		);
	}

	const model = await vscode.window.showInputBox({
		title: 'Model Name',
		prompt: 'Which model to use for generation',
		value: 'gpt-4o-mini',
		placeHolder: 'gpt-4o-mini',
		ignoreFocusOut: true,
	});

	if (model) {
		await vscode.workspace.getConfiguration('aicommits').update(
			'model', model, vscode.ConfigurationTarget.Global,
		);
	}

	updateStatusBar(context);
	refreshSidebar(context);
	vscode.window.showInformationMessage('✅ AI Commits configured! Stage some changes and click ✨ to generate.');
}

// ── Select Model ────────────────────────────────────────────

async function handleSelectModel(context: vscode.ExtensionContext) {
	const model = await vscode.window.showInputBox({
		title: 'AI Commits — Select Model',
		prompt: 'Enter model name (e.g., gpt-4o, openai/gpt-4.1, claude-sonnet-4-20250514)',
		value: (await getConfig(context.secrets)).model,
		ignoreFocusOut: true,
	});

	if (model) {
		await vscode.workspace.getConfiguration('aicommits').update(
			'model', model, vscode.ConfigurationTarget.Global,
		);
		updateStatusBar(context);
		refreshSidebar(context);
		vscode.window.showInformationMessage(`Model set to: ${model}`);
	}
}

export function deactivate() {}
