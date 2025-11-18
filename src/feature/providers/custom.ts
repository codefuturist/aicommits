import { BaseProvider } from './base.js';
import { text } from '@clack/prompts';
import { fetchModels } from '../models.js';

export class CustomProvider extends BaseProvider {
	get name(): string {
		return 'custom';
	}

	get displayName(): string {
		return 'Custom (OpenAI-compatible)';
	}

	async setup(): Promise<void> {
		const endpoint = await text({
			message: 'Enter your custom API endpoint:',
			validate: (value) => {
				if (!value) return 'Endpoint is required';
				try {
					new URL(value);
				} catch {
					return 'Invalid URL format';
				}
				return;
			},
		});

		const apiKey = await text({
			message: 'Enter your API key (leave empty if not required):',
		});

		const updates: [string, string][] = [
			['provider', this.name],
			['endpoint', endpoint as string],
		];

		if (apiKey) {
			updates.push(['api-key', apiKey as string]);
		}

		await this.updateConfig(updates);
	}

	async getModels(): Promise<{ models: string[]; error?: string }> {
		const baseUrl = this.getBaseUrl();
		const apiKey = this.getApiKey() || '';
		return fetchModels(baseUrl, apiKey, this.name);
	}

	getApiKey(): string | undefined {
		return this.config['api-key'];
	}

	getBaseUrl(): string {
		return this.config.endpoint || '';
	}

	getDefaultModel(): string {
		return 'gpt-3.5-turbo';
	}

	validateConfig(): { valid: boolean; errors: string[] } {
		const errors: string[] = [];
		if (!this.getBaseUrl()) {
			errors.push('Custom endpoint is required');
		}
		return { valid: errors.length === 0, errors };
	}
}
