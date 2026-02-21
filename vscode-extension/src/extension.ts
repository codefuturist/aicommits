import * as vscode from 'vscode';
import { spawn } from 'child_process';

let outputChannel: vscode.OutputChannel;
const TIMEOUT_MS = 15000;
let cliInstalled = false;

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('AI Commits');

	const generateCommand = vscode.commands.registerCommand(
		'aicommits.generate',
		() => generateCommitMessage('plain'),
	);

	const generateConventionalCommand = vscode.commands.registerCommand(
		'aicommits.generateConventional',
		() => generateCommitMessage('conventional'),
	);

	const generateGitmojiCommand = vscode.commands.registerCommand(
		'aicommits.generateGitmoji',
		() => generateCommitMessage('gitmoji'),
	);

	const setupCommand = vscode.commands.registerCommand('aicommits.setup', () =>
		openSetupTerminal(),
	);

	const selectModelCommand = vscode.commands.registerCommand(
		'aicommits.selectModel',
		() => openTerminal('aicommits model'),
	);

	context.subscriptions.push(
		generateCommand,
		generateConventionalCommand,
		generateGitmojiCommand,
		setupCommand,
		selectModelCommand,
		outputChannel,
	);

	checkCliOnActivation();
}

async function checkCliOnActivation() {
	cliInstalled = await isCliInstalled();

	if (!cliInstalled) {
		const action = await vscode.window.showInformationMessage(
			'AI Commits requires aicommits CLI. Install it now?',
			'Install',
			'Later',
		);

		if (action === 'Install') {
			await installCli();
		}
	}
}

async function isCliInstalled(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('which', ['aicommits'], { shell: true });
		proc.on('close', (code) => resolve(code === 0));
		proc.on('error', () => resolve(false));
	});
}

async function installCli(): Promise<boolean> {
	return new Promise((resolve) => {
		const terminal = vscode.window.createTerminal({ name: 'AI Commits Setup' });
		terminal.show();
		terminal.sendText('npm install -g aicommits@develop && aicommits setup');

		vscode.window.showInformationMessage(
			'Installing aicommits... Complete the setup in the terminal, then try again.',
			'OK',
		);

		resolve(false);
	});
}

async function ensureCliInstalled(): Promise<boolean> {
	if (cliInstalled) {
		return true;
	}

	cliInstalled = await isCliInstalled();
	if (cliInstalled) {
		return true;
	}

	const action = await vscode.window.showErrorMessage(
		'aicommits CLI is not installed. Install it now?',
		'Install',
		'Cancel',
	);

	if (action === 'Install') {
		await installCli();
	}
	return false;
}

async function generateCommitMessage(
	type: 'plain' | 'conventional' | 'gitmoji',
) {
	if (!(await ensureCliInstalled())) {
		return;
	}

	const config = vscode.workspace.getConfiguration('aicommits');
	const cliPath = config.get<string>('path', 'aicommits');
	const autoCommit = config.get<boolean>('autoCommit', false);

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage('No workspace folder open');
		return;
	}

	const cwd = workspaceFolders[0].uri.fsPath;

	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	const git = gitExtension?.getAPI(1);
	const repo = git?.repositories[0];

	if (!repo) {
		vscode.window.showErrorMessage('No Git repository found');
		return;
	}

	const originalMessage = repo.inputBox.value;
	repo.inputBox.value = '⏳ Generating commit message...';

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.SourceControl,
			title: 'Generating commit message...',
			cancellable: false,
		},
		async () => {
			try {
				const args = ['--clipboard', '--confirm'];
				if (type !== 'plain') {
					args.push('--type', type);
				}

				await runCli(cliPath, args, cwd, TIMEOUT_MS);

				const message = await vscode.env.clipboard.readText();

				if (!message) {
					repo.inputBox.value = originalMessage;
					vscode.window.showWarningMessage('No message generated');
					return;
				}

				if (autoCommit) {
					await commitWithMessage(repo, message);
				} else {
					repo.inputBox.value = message;
					vscode.window.showInformationMessage('✨ Commit message generated!');
				}
			} catch (error) {
				repo.inputBox.value = originalMessage;
				const errorMessage =
					error instanceof Error ? error.message : String(error);

				if (errorMessage.includes('Timeout')) {
					vscode.window
						.showWarningMessage(
							'⏱️ AI is taking too long. Try again or check your API key.',
							'Setup',
							'Cancel',
						)
						.then((action) => {
							if (action === 'Setup') {
								openSetupTerminal();
							}
						});
				} else {
					outputChannel.appendLine(`Error: ${errorMessage}`);
					vscode.window.showErrorMessage(`AI Commits error: ${errorMessage}`);
				}
			}
		},
	);
}

function openSetupTerminal() {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const cwd = workspaceFolders?.[0]?.uri.fsPath;

	const terminal = vscode.window.createTerminal({
		name: 'AI Commits Setup',
		cwd,
	});

	terminal.show();
	terminal.sendText('aicommits setup');
}

function openTerminal(command: string) {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const cwd = workspaceFolders?.[0]?.uri.fsPath;

	const terminal = vscode.window.createTerminal({
		name: 'AI Commits',
		cwd,
	});

	terminal.show();
	terminal.sendText(command);
}

function runCli(
	cliPath: string,
	args: string[],
	cwd: string,
	timeout: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		outputChannel.appendLine(`Running: ${cliPath} ${args.join(' ')}`);

		const proc = spawn(cliPath, args, {
			cwd,
			shell: true,
		});

		let stderr = '';

		proc.stderr.on('data', (data) => {
			stderr += data.toString();
			outputChannel.append(data.toString());
		});

		const timer = setTimeout(() => {
			proc.kill();
			reject(new Error('Timeout'));
		}, timeout);

		proc.on('close', (code) => {
			clearTimeout(timer);

			if (code !== 0) {
				reject(new Error(stderr || `Process exited with code ${code}`));
				return;
			}

			resolve();
		});

		proc.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

async function commitWithMessage(repo: any, message: string) {
	try {
		await repo.commit(message);
		vscode.window.showInformationMessage('✅ Committed successfully!');
	} catch (error) {
		vscode.window.showErrorMessage(
			`Failed to commit: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function deactivate() {}
