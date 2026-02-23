import * as vscode from 'vscode';
import type { AicommitsConfig } from './types';

type SidebarItemKind = 'action' | 'info' | 'header';

interface SidebarEntry {
	label: string;
	description?: string;
	icon?: string;
	kind: SidebarItemKind;
	command?: string;
}

export class AicommitsSidebarProvider implements vscode.TreeDataProvider<SidebarEntry> {
	private _onDidChangeTreeData = new vscode.EventEmitter<SidebarEntry | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private config: AicommitsConfig | undefined;
	private hasKey = false;
	private hasStagedChanges = false;
	private lastMessage: string | undefined;

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	updateConfig(config: AicommitsConfig): void {
		this.config = config;
		this.hasKey = config.apiKey.length > 0;
		this.refresh();
	}

	updateStagedStatus(staged: boolean): void {
		this.hasStagedChanges = staged;
		this.refresh();
	}

	updateLastMessage(message: string | undefined): void {
		this.lastMessage = message;
		this.refresh();
	}

	getTreeItem(element: SidebarEntry): vscode.TreeItem {
		const item = new vscode.TreeItem(element.label);
		item.description = element.description;

		if (element.command) {
			item.command = { command: element.command, title: element.label };
		}

		if (element.icon) {
			item.iconPath = new vscode.ThemeIcon(element.icon);
		}

		if (element.kind === 'header') {
			item.collapsibleState = vscode.TreeItemCollapsibleState.None;
			item.contextValue = 'header';
		}

		return item;
	}

	getChildren(element?: SidebarEntry): SidebarEntry[] {
		if (element) { return []; }

		const items: SidebarEntry[] = [];

		// ── Status ──
		if (!this.hasKey) {
			items.push({
				label: 'API key not configured',
				icon: 'warning',
				kind: 'info',
				command: 'aicommits.setup',
				description: 'Click to setup',
			});
		} else if (!this.hasStagedChanges) {
			items.push({
				label: 'No staged changes',
				icon: 'info',
				kind: 'info',
				description: 'Stage files to generate',
			});
		} else {
			items.push({
				label: 'Ready to generate',
				icon: 'check',
				kind: 'info',
				description: 'Staged changes detected',
			});
		}

		// ── Quick Actions ──
		items.push({
			label: 'Generate Commit Message',
			icon: 'sparkle',
			kind: 'action',
			command: 'aicommits.generate',
		});

		items.push({
			label: 'Generate & Commit',
			icon: 'check',
			kind: 'action',
			command: 'aicommits.generateAndCommit',
		});

		items.push({
			label: 'Conventional Commit',
			icon: 'checklist',
			kind: 'action',
			command: 'aicommits.generateConventional',
		});

		items.push({
			label: 'Gitmoji Commit',
			icon: 'symbol-enum',
			kind: 'action',
			command: 'aicommits.generateGitmoji',
		});

		// ── Last Message ──
		if (this.lastMessage) {
			items.push({
				label: this.lastMessage,
				icon: 'quote',
				kind: 'info',
				description: 'Last generated',
			});
		}

		// ── Configuration ──
		if (this.config) {
			const modelName = this.config.model.split('/').pop() || this.config.model;
			items.push({
				label: modelName,
				icon: 'server',
				kind: 'info',
				command: 'aicommits.selectModel',
				description: 'Model',
			});

			items.push({
				label: this.config.type,
				icon: 'symbol-keyword',
				kind: 'info',
				description: 'Commit type',
			});

			items.push({
				label: this.config.locale.toUpperCase(),
				icon: 'globe',
				kind: 'info',
				description: 'Locale',
			});
		}

		// ── Setup ──
		items.push({
			label: 'Setup Provider',
			icon: 'gear',
			kind: 'action',
			command: 'aicommits.setup',
		});

		return items;
	}
}
