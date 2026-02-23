import * as vscode from 'vscode';
import type { AicommitsConfig, Change } from './types';

type SidebarItemKind = 'section' | 'action' | 'info' | 'file';

/** Map git Change.status number to a human label and icon. */
const STATUS_MAP: Record<number, { label: string; icon: string }> = {
	0: { label: 'Modified', icon: 'diff-modified' },
	1: { label: 'Added', icon: 'diff-added' },
	2: { label: 'Deleted', icon: 'diff-removed' },
	3: { label: 'Renamed', icon: 'diff-renamed' },
	4: { label: 'Copied', icon: 'diff-added' },
	5: { label: 'Untracked', icon: 'question' },
	6: { label: 'Ignored', icon: 'circle-slash' },
	7: { label: 'Intent to Add', icon: 'diff-added' },
};

interface SidebarEntry {
	id: string;
	label: string;
	description?: string;
	tooltip?: string;
	icon?: string;
	kind: SidebarItemKind;
	command?: string;
	commandArgs?: unknown[];
	resourceUri?: vscode.Uri;
	children?: SidebarEntry[];
}

export class AicommitsSidebarProvider implements vscode.TreeDataProvider<SidebarEntry> {
	private _onDidChangeTreeData = new vscode.EventEmitter<SidebarEntry | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private config: AicommitsConfig | undefined;
	private hasKey = false;
	private stagedChanges: Change[] = [];
	private lastMessage: string | undefined;

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	updateConfig(config: AicommitsConfig): void {
		this.config = config;
		this.hasKey = config.apiKey.length > 0;
		this.refresh();
	}

	updateStagedChanges(changes: Change[]): void {
		this.stagedChanges = changes;
		this.refresh();
	}

	updateLastMessage(message: string | undefined): void {
		this.lastMessage = message;
		this.refresh();
	}

	getTreeItem(element: SidebarEntry): vscode.TreeItem {
		const isSection = element.kind === 'section';
		const item = new vscode.TreeItem(
			element.label,
			isSection
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.None,
		);

		item.description = element.description;
		item.tooltip = element.tooltip;
		item.contextValue = element.kind;
		item.id = element.id;

		if (element.command) {
			item.command = {
				command: element.command,
				title: element.label,
				arguments: element.commandArgs,
			};
		}

		if (element.kind === 'file' && element.resourceUri) {
			item.resourceUri = element.resourceUri;
			item.iconPath = element.icon
				? new vscode.ThemeIcon(element.icon)
				: vscode.ThemeIcon.File;
		} else if (element.icon) {
			item.iconPath = new vscode.ThemeIcon(element.icon);
		}

		return item;
	}

	getChildren(element?: SidebarEntry): SidebarEntry[] {
		if (element) {
			return element.children || [];
		}
		return this.buildRootItems();
	}

	private buildRootItems(): SidebarEntry[] {
		const items: SidebarEntry[] = [];

		// ── Staged Changes ──
		items.push(this.buildStagedSection());

		// ── Quick Actions ──
		items.push(this.buildActionsSection());

		// ── Last Message ──
		if (this.lastMessage) {
			items.push({
				id: 'last-message',
				label: this.lastMessage,
				icon: 'quote',
				kind: 'info',
				description: 'Last generated',
			});
		}

		// ── Configuration ──
		items.push(this.buildConfigSection());

		return items;
	}

	private buildStagedSection(): SidebarEntry {
		const count = this.stagedChanges.length;
		const children: SidebarEntry[] = this.stagedChanges.map((change, i) => {
			const segments = change.uri.path.split('/');
			const filename = segments.pop() || '';
			const dir = segments.pop() || '';
			const status = STATUS_MAP[change.status] || { label: '?', icon: 'question' };

			return {
				id: `staged-${i}`,
				label: filename,
				description: dir ? `${dir}/` : '',
				tooltip: `${change.uri.fsPath} — ${status.label}`,
				icon: status.icon,
				kind: 'file' as const,
				resourceUri: change.uri,
				command: 'vscode.open',
				commandArgs: [change.uri],
			};
		});

		if (count === 0 && !this.hasKey) {
			children.push({
				id: 'staged-setup',
				label: 'Setup API key to get started',
				icon: 'key',
				kind: 'action',
				command: 'aicommits.setup',
			});
		} else if (count === 0) {
			children.push({
				id: 'staged-empty',
				label: 'No files staged',
				icon: 'info',
				kind: 'info',
				description: 'Use git add or the SCM panel',
			});
		}

		return {
			id: 'section-staged',
			label: `Staged Changes`,
			description: count > 0 ? `${count} file${count === 1 ? '' : 's'}` : undefined,
			icon: count > 0 ? 'check' : 'circle-slash',
			kind: 'section',
			children,
		};
	}

	private buildActionsSection(): SidebarEntry {
		return {
			id: 'section-actions',
			label: 'Actions',
			icon: 'zap',
			kind: 'section',
			children: [
				{
					id: 'action-generate',
					label: 'Generate Commit Message',
					icon: 'sparkle',
					kind: 'action',
					command: 'aicommits.generate',
				},
				{
					id: 'action-commit',
					label: 'Generate & Commit',
					icon: 'check',
					kind: 'action',
					command: 'aicommits.generateAndCommit',
				},
				{
					id: 'action-conventional',
					label: 'Conventional Commit',
					icon: 'checklist',
					kind: 'action',
					command: 'aicommits.generateConventional',
				},
				{
					id: 'action-gitmoji',
					label: 'Gitmoji Commit',
					icon: 'symbol-enum',
					kind: 'action',
					command: 'aicommits.generateGitmoji',
				},
			],
		};
	}

	private buildConfigSection(): SidebarEntry {
		const children: SidebarEntry[] = [];

		if (this.config) {
			const modelName = this.config.model.split('/').pop() || this.config.model;
			children.push({
				id: 'config-model',
				label: modelName,
				icon: 'server',
				kind: 'action',
				command: 'aicommits.selectModel',
				description: 'Model',
			});
			children.push({
				id: 'config-type',
				label: this.config.type,
				icon: 'symbol-keyword',
				kind: 'info',
				description: 'Commit type',
			});
			children.push({
				id: 'config-locale',
				label: this.config.locale.toUpperCase(),
				icon: 'globe',
				kind: 'info',
				description: 'Locale',
			});
		}

		children.push({
			id: 'config-setup',
			label: 'Setup Provider',
			icon: 'gear',
			kind: 'action',
			command: 'aicommits.setup',
		});

		return {
			id: 'section-config',
			label: 'Configuration',
			icon: 'settings-gear',
			kind: 'section',
			children,
		};
	}
}
