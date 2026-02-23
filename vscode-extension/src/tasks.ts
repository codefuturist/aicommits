import * as vscode from 'vscode';
import { getConfig } from './config';
import { getRepository, getStagedDiff, setCommitMessage, commit as gitCommit } from './git';
import { generateCommitMessage } from './ai';
import type { CommitType } from './types';

const TASK_TYPE = 'aicommits';
const TIMEOUT_MS = 30_000;

type TaskAction = 'generate' | 'generate-conventional' | 'generate-gitmoji' | 'generate-and-commit' | 'setup';

interface AicommitsTaskDefinition extends vscode.TaskDefinition {
	action: TaskAction;
}

interface TaskInfo {
	label: string;
	action: TaskAction;
	commitType?: CommitType;
	autoCommit?: boolean;
}

const TASK_CATALOG: TaskInfo[] = [
	{ label: 'Generate Commit Message', action: 'generate' },
	{ label: 'Generate Conventional Commit', action: 'generate-conventional', commitType: 'conventional' },
	{ label: 'Generate Gitmoji Commit', action: 'generate-gitmoji', commitType: 'gitmoji' },
	{ label: 'Generate & Commit', action: 'generate-and-commit', autoCommit: true },
	{ label: 'Setup Provider', action: 'setup' },
];

// ── ANSI helpers ────────────────────────────────────────────

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function line(write: (s: string) => void, text: string, color = ''): void {
	write(`${color}${text}${RESET}\r\n`);
}

// ── Task Provider ───────────────────────────────────────────

export class AicommitsTaskProvider implements vscode.TaskProvider {
	private tasks: vscode.Task[] | undefined;

	constructor(private readonly secrets: vscode.SecretStorage) {}

	provideTasks(): vscode.Task[] {
		if (!this.tasks) {
			this.tasks = TASK_CATALOG.map(info => this.createTask(info));
		}
		return this.tasks;
	}

	resolveTask(task: vscode.Task): vscode.Task | undefined {
		const def = task.definition as AicommitsTaskDefinition;
		const info = TASK_CATALOG.find(t => t.action === def.action);
		if (!info) { return undefined; }
		return this.createTask(info, def);
	}

	private createTask(info: TaskInfo, definition?: AicommitsTaskDefinition): vscode.Task {
		const def: AicommitsTaskDefinition = definition ?? { type: TASK_TYPE, action: info.action };
		const secrets = this.secrets;

		return new vscode.Task(
			def,
			vscode.TaskScope.Workspace,
			info.label,
			TASK_TYPE,
			new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
				return new AicommitsTaskTerminal(secrets, info);
			}),
		);
	}
}

// ── Pseudoterminal ──────────────────────────────────────────

class AicommitsTaskTerminal implements vscode.Pseudoterminal {
	private writeEmitter = new vscode.EventEmitter<string>();
	readonly onDidWrite = this.writeEmitter.event;

	private closeEmitter = new vscode.EventEmitter<number>();
	readonly onDidClose = this.closeEmitter.event;

	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly info: TaskInfo,
	) {}

	open(): void {
		if (this.info.action === 'setup') {
			this.runSetup();
		} else {
			this.runGenerate();
		}
	}

	close(): void {
		// nothing to clean up
	}

	private write(text: string, color = ''): void {
		line(s => this.writeEmitter.fire(s), text, color);
	}

	// ── Setup ─────────────────────────────────────────────

	private async runSetup(): Promise<void> {
		this.write('AI Commits — Setup Provider', CYAN);
		this.write('');
		this.write('Use the command palette instead:', DIM);
		this.write('  Ctrl+Shift+P → "AI Commits: Setup Provider"', DIM);
		this.write('');

		// Trigger the setup command so the user gets the interactive flow
		await vscode.commands.executeCommand('aicommits.setup');

		this.write('Setup complete.', GREEN);
		this.closeEmitter.fire(0);
	}

	// ── Generate ──────────────────────────────────────────

	private async runGenerate(): Promise<void> {
		try {
			this.write(`AI Commits — ${this.info.label}`, CYAN);
			this.write('');

			// Repository
			const repo = getRepository();
			if (!repo) {
				this.write('✗ No Git repository found.', RED);
				this.closeEmitter.fire(1);
				return;
			}

			// Config
			this.write('Loading configuration...', DIM);
			const config = await getConfig(this.secrets);
			if (!config.apiKey) {
				this.write('✗ No API key configured. Run "AI Commits: Setup Provider" first.', RED);
				this.closeEmitter.fire(1);
				return;
			}

			// Apply commit type override
			if (this.info.commitType) {
				config.type = this.info.commitType;
			}

			// Staged diff
			this.write('Reading staged diff...', DIM);
			const diff = await getStagedDiff(repo);
			if (!diff || diff.trim().length === 0) {
				this.write('✗ No staged changes. Stage some files first.', RED);
				this.closeEmitter.fire(1);
				return;
			}

			const diffLines = diff.split('\n').length;
			this.write(`  ${diffLines} lines of diff`, DIM);

			// Generate
			const modelName = config.model.split('/').pop() || config.model;
			this.write(`Generating with ${modelName} (${config.type})...`, CYAN);

			const abortController = new AbortController();
			const timeout = setTimeout(() => abortController.abort(), TIMEOUT_MS);

			const result = await generateCommitMessage(config, diff, abortController.signal);
			clearTimeout(timeout);

			if (!result.messages || result.messages.length === 0) {
				this.write('✗ No commit message generated.', RED);
				this.closeEmitter.fire(1);
				return;
			}

			// Token usage
			if (result.usage) {
				this.write(`  Tokens: ${result.usage.prompt_tokens} prompt + ${result.usage.completion_tokens} completion = ${result.usage.total_tokens} total`, DIM);
			}

			this.write('');
			const message = result.messages[0];
			this.write(`  ${message}`, GREEN);
			this.write('');

			// Commit or set input box
			if (this.info.autoCommit) {
				this.write('Committing...', CYAN);
				await gitCommit(repo, message);
				this.write('✓ Committed successfully!', GREEN);
			} else {
				setCommitMessage(repo, message);
				this.write('✓ Message set in SCM input box.', GREEN);
			}

			this.closeEmitter.fire(0);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (msg.includes('abort')) {
				this.write('Cancelled (timeout).', RED);
			} else {
				this.write(`✗ Error: ${msg}`, RED);
			}
			this.closeEmitter.fire(1);
		}
	}
}
