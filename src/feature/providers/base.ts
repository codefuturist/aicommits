import { getConfig, setConfigs, type ValidConfig } from '../../utils/config.js';
import { fetchModels } from '../models.js';

export type ProviderDef = {
	name: string;
	displayName: string;
	baseUrl: string;
	apiKeyFormat?: string;
	modelsFilter?: (models: any[]) => string[];
	defaultModel: string;
	requiresApiKey: boolean;
};

export class Provider {
	protected config: ValidConfig;
	protected def: ProviderDef;

	constructor(def: ProviderDef, config: ValidConfig) {
		this.def = def;
		this.config = config;
	}

	get name(): string {
		return this.def.name;
	}

	get displayName(): string {
		return this.def.displayName;
	}

	async setup(): Promise<void> {
		const { text, password } = await import('@clack/prompts');
		const updates: [string, string][] = [];

		if (this.def.requiresApiKey) {
			const currentKey = this.getApiKey();
			const apiKey = await password({
				message: currentKey
					? `Enter your API key (leave empty to keep current: ${currentKey.substring(0, 4)}****):`
					: 'Enter your API key:',
				validate: (value) => {
					if (!value && !currentKey) return 'API key is required';
					if (value && this.def.apiKeyFormat && !value.startsWith(this.def.apiKeyFormat)) return `Invalid API key format, must start with "${this.def.apiKeyFormat}"`;
					return;
				},
			});
			if (apiKey) {
				updates.push(['OPENAI_API_KEY', apiKey as string]);
			}
		}

		if (this.name === 'ollama') {
			const currentEndpoint = this.getBaseUrl();
			const endpoint = await text({
				message: 'Enter Ollama endpoint (leave empty for default):',
				placeholder: currentEndpoint,
			});
			if (endpoint && endpoint !== 'http://localhost:11434/v1') {
				updates.push(['OPENAI_BASE_URL', endpoint as string]);
			}
		} else if (this.name === 'custom') {
			const currentEndpoint = this.getBaseUrl();
			const endpoint = await text({
				message: currentEndpoint
					? `Enter your custom API endpoint (current: ${currentEndpoint}):`
					: 'Enter your custom API endpoint:',
				validate: (value) => {
					if (!value && !currentEndpoint) return 'Endpoint is required';
					if (value) {
						try {
							new URL(value);
						} catch {
							return 'Invalid URL format';
						}
					}
					return;
				},
			});
			if (endpoint) {
				updates.push(['OPENAI_BASE_URL', endpoint as string]);
			}
		}

		if (updates.length > 0) {
			await setConfigs(updates);
			this.config = await getConfig();
		}
	}

	async getModels(): Promise<{ models: string[]; error?: string }> {
		const baseUrl = this.getBaseUrl();
		const apiKey = this.getApiKey() || '';
		const result = await fetchModels(baseUrl, apiKey, this.name);
		if (result.error) return result;
		if (this.def.modelsFilter) {
			result.models = this.def.modelsFilter(result.models);
		}
		return result;
	}

	getApiKey(): string | undefined {
		return this.def.requiresApiKey ? this.config.OPENAI_API_KEY : undefined;
	}

	getBaseUrl(): string {
		if (this.name === 'custom') {
			return this.config.OPENAI_BASE_URL || '';
		}
		return this.def.baseUrl;
	}

	getDefaultModel(): string {
		return this.def.defaultModel;
	}

	validateConfig(): { valid: boolean; errors: string[] } {
		const errors: string[] = [];
		if (this.def.requiresApiKey && !this.getApiKey()) {
			errors.push(`${this.displayName} API key is required`);
		}
		if (this.name === 'custom' && !this.getBaseUrl()) {
			errors.push('Custom endpoint is required');
		}
		return { valid: errors.length === 0, errors };
	}
}
