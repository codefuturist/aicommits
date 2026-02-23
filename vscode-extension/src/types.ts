/**
 * Git typings from vscode.git extension API (v1).
 * We only include what we use to keep it minimal.
 */

import type * as vscode from 'vscode';

export interface GitExtension {
	getAPI(version: 1): GitAPI;
}

export interface GitAPI {
	repositories: Repository[];
	onDidOpenRepository: vscode.Event<Repository>;
}

export interface Repository {
	inputBox: InputBox;
	rootUri: vscode.Uri;
	state: RepositoryState;
	diff(cached?: boolean): Promise<string>;
	commit(message: string, opts?: CommitOptions): Promise<void>;
	onDidRunGitStatus: vscode.Event<void>;
}

export interface InputBox {
	value: string;
}

export interface RepositoryState {
	HEAD: Branch | undefined;
	indexChanges: Change[];
	workingTreeChanges: Change[];
}

export interface Branch {
	name?: string;
	commit?: string;
}

export interface Change {
	uri: vscode.Uri;
	status: number;
}

export interface CommitOptions {
	all?: boolean;
	amend?: boolean;
	signoff?: boolean;
	empty?: boolean;
}

// Config types (mirrored from CLI)
export type CommitType = 'plain' | 'conventional' | 'gitmoji';

export interface AicommitsConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	type: CommitType;
	locale: string;
	maxLength: number;
	generateCount: number;
	customPrompt?: string;
}

export interface GenerationResult {
	messages: string[];
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}
