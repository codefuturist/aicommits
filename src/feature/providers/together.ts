import { ProviderDef } from './base.js';

export const TogetherProvider: ProviderDef = {
	name: 'togetherai',
	displayName: 'Together AI (recommended)',
	baseUrl: 'https://api.together.xyz/v1',
	apiKeyFormat: 'tgp_',
	modelsFilter: (models) =>
		models
			.filter((m: any) => !m.type || m.type === 'chat' || m.type === 'language')
			.map((m: any) => m.id),
	defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
	requiresApiKey: true,
};
