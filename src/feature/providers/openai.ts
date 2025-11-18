import { BaseProvider } from './base.js';
import { text } from '@clack/prompts';
import { fetchModels } from '../models.js';

export class OpenAIProvider extends BaseProvider {
	get name(): string {
		return 'openai';
	}

	get displayName(): string {
		return 'OpenAI';
	}

	async setup(): Promise<void> {
		const apiKey = await text({
			message: 'Enter your OpenAI API key:',
			validate: (value) => {
				if (!value) return 'API key is required';
				if (!value.startsWith('sk-')) return 'Invalid OpenAI API key format';
				return;
			},
		});

		const baseUrl = await text({
			message: 'Enter OpenAI base URL (leave empty for default):',
			placeholder: 'https://api.openai.com',
		});

		const updates: [string, string][] = [
			['provider', this.name],
			['OPENAI_API_KEY', apiKey as string],
		];

		if (baseUrl) {
			updates.push(['openai-base-url', baseUrl as string]);
		}

		await this.updateConfig(updates);
	}

	async getModels(): Promise<{ models: string[]; error?: string }> {
		const baseUrl = this.getBaseUrl();
		const apiKey = this.getApiKey();
		if (!apiKey) {
			return { models: [], error: 'API key not configured' };
		}
		return fetchModels(baseUrl, apiKey, this.name);
	}

	getApiKey(): string | undefined {
		return this.config.OPENAI_API_KEY;
	}

	getBaseUrl(): string {
		return this.config['openai-base-url'] || 'https://api.openai.com';
	}

	getDefaultModel(): string {
		return 'gpt-4';
	}

	validateConfig(): { valid: boolean; errors: string[] } {
		const errors: string[] = [];
		if (!this.getApiKey()) {
			errors.push('OpenAI API key is required');
		}
		return { valid: errors.length === 0, errors };
	}
}
