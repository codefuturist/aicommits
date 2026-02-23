import * as vscode from 'vscode';
import type { GitExtension, Repository } from './types';

/** Get the built-in Git extension API (v1). */
function getGitAPI() {
	const ext = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
	if (!ext) { return undefined; }
	return ext.getAPI(1);
}

/** Get the active Git repository (first one, or matching workspace folder). */
export function getRepository(): Repository | undefined {
	const api = getGitAPI();
	if (!api || api.repositories.length === 0) { return undefined; }

	// If multiple repos, try to match the active editor's workspace
	if (api.repositories.length > 1) {
		const activeUri = vscode.window.activeTextEditor?.document.uri;
		if (activeUri) {
			const repo = api.repositories.find(r =>
				activeUri.fsPath.startsWith(r.rootUri.fsPath),
			);
			if (repo) { return repo; }
		}
	}

	return api.repositories[0];
}

/** Get staged diff from the Git repository. */
export async function getStagedDiff(repo: Repository): Promise<string> {
	return repo.diff(true);
}

/** Set the commit message in the SCM input box. */
export function setCommitMessage(repo: Repository, message: string): void {
	repo.inputBox.value = message;
}

/** Commit with the given message. */
export async function commit(repo: Repository, message: string): Promise<void> {
	await repo.commit(message);
}

/** Check if there are staged changes. */
export function hasStagedChanges(repo: Repository): boolean {
	return repo.state.indexChanges.length > 0;
}
