import { BaseProvider } from './base.js';
import { text, outro } from '@clack/prompts';

export class OllamaProvider extends BaseProvider {
	get name(): string {
		return 'ollama';
	}

	get displayName(): string {
		return 'Ollama (local)';
	}

	async setup(): Promise<void> {
		const endpoint = await text({
			message: 'Enter Ollama endpoint (leave empty for default):',
			placeholder: 'http://localhost:11434',
		});

		const updates: [string, string][] = [['provider', this.name]];

		if (endpoint) {
			updates.push(['endpoint', endpoint as string]);
		}

		await this.updateConfig(updates);

		outro(
			'Make sure Ollama is running locally. Visit https://ollama.ai for installation instructions.'
		);
	}

	async getModels(): Promise<{ models: string[]; error?: string }> {
		try {
			const baseUrl = this.getBaseUrl();
			const modelsUrl = `${baseUrl.replace(/\/$/, '')}/api/tags`;

			const response = await fetch(modelsUrl, {
				headers: {
					'Content-Type': 'application/json',
				},
				signal: AbortSignal.timeout(5000),
			});

			if (!response.ok) {
				return { models: [], error: `HTTP ${response.status}` };
			}

			const data = await response.json();
			const modelsArray: [
				{
					name: string;
					model: string;
				}
			] = data.models || [];
			const models = modelsArray
				.filter((model) => model.model)
				.map((model) => model.model)
				.slice(0, 20);

			return { models };
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : 'Request failed';
			return { models: [], error: errorMessage };
		}
	}

	getApiKey(): string | undefined {
		return undefined; // Ollama doesn't require API key
	}

	getBaseUrl(): string {
		return this.config.endpoint || 'http://localhost:11434';
	}

	getDefaultModel(): string {
		return 'llama2';
	}

	validateConfig(): { valid: boolean; errors: string[] } {
		// Ollama doesn't require API key, just check if endpoint is reachable
		return { valid: true, errors: [] };
	}
}
