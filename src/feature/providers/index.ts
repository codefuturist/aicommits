import { Provider, type ProviderDef } from './base.js';
import type { ValidConfig } from '../../utils/config.js';

export { Provider } from './base.js';
export type { ProviderDef } from './base.js';

const providers: ProviderDef[] = [
	{
		name: 'togetherai',
		displayName: 'Together AI (recommended)',
		baseUrl: 'https://api.together.xyz/v1',
		apiKeyFormat: 'tgp_',
		modelsFilter: (models) =>
			models
				.filter(
					(m: any) => !m.type || m.type === 'chat' || m.type === 'language'
				)
				.map((m: any) => m.id)
				.slice(0, 20),
		defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
		requiresApiKey: true,
	},
	{
		name: 'openai',
		displayName: 'OpenAI',
		baseUrl: 'https://api.openai.com/v1',
		apiKeyFormat: 'sk-',
		modelsFilter: (models) =>
			models
				.filter(
					(m: any) =>
						m.id &&
						(m.id.includes('gpt') ||
							m.id.includes('o1') ||
							m.id.includes('o3') ||
							m.id.includes('o4') ||
							m.id.includes('o5') ||
							!m.type ||
							m.type === 'chat')
				)
				.map((m: any) => m.id)
				.slice(0, 20),
		defaultModel: 'gpt-5-mini',
		requiresApiKey: true,
	},
	{
		name: 'ollama',
		displayName: 'Ollama (local)',
		baseUrl: 'http://localhost:11434/v1',
		modelsFilter: (models) =>
			models
				.filter((m: any) => m.name)
				.map((m: any) => m.name)
				.slice(0, 20),
		defaultModel: 'llama2',
		requiresApiKey: false,
	},
	{
		name: 'custom',
		displayName: 'Custom (OpenAI-compatible)',
		baseUrl: '',
		modelsFilter: (models) =>
			models
				.filter(
					(m: any) => !m.type || m.type === 'chat' || m.type === 'language'
				)
				.map((m: any) => m.id)
				.slice(0, 20),
		defaultModel: 'gpt-3.5-turbo',
		requiresApiKey: true,
	},
];

export function getProvider(config: ValidConfig): Provider | null {
	const providerName = config.provider;
	const pDef = providers.find((p) => p.name === providerName);
	return pDef ? new Provider(pDef, config) : null;
}

export function getAvailableProviders(): { value: string; label: string }[] {
	return providers.map((p) => ({
		value: p.name,
		label: p.displayName,
	}));
}
