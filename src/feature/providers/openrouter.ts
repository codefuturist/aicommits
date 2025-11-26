import { ProviderDef } from './base.js';

export const OpenRouterProvider: ProviderDef = {
	name: 'openrouter',
	displayName: 'OpenRouter',
	baseUrl: 'https://openrouter.ai/api/v1',
	apiKeyFormat: 'sk-or-v1-',
	modelsFilter: (models) =>
		models
			.filter((m: any) => m.id && (!m.type || m.type === 'chat'))
			.map((m: any) => m.id),
	defaultModel: 'x-ai/grok-4.1-fast:free',
	requiresApiKey: true,
};
