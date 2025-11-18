import { BaseProvider } from './base.js';
import { text } from '@clack/prompts';
import { fetchModels } from '../models.js';

export class TogetherAIProvider extends BaseProvider {
	get name(): string {
		return 'togetherai';
	}

	get displayName(): string {
		return 'Together AI';
	}

	async setup(): Promise<void> {
		const apiKey = await text({
			message: 'Enter your Together AI API key:',
			validate: (value) => {
				if (!value) return 'API key is required';
				return;
			},
		});

		const updates: [string, string][] = [
			['provider', this.name],
			['TOGETHER_API_KEY', apiKey as string],
		];

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
		return this.config.TOGETHER_API_KEY;
	}

	getBaseUrl(): string {
		return 'https://api.together.xyz';
	}

	getDefaultModel(): string {
		return 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
	}

	validateConfig(): { valid: boolean; errors: string[] } {
		const errors: string[] = [];
		if (!this.getApiKey()) {
			errors.push('Together AI API key is required');
		}
		return { valid: errors.length === 0, errors };
	}
}
