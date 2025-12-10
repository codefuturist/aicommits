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
	defaultModels: [
		'essentialai/rnj-1-instruct',
		'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
		'meta-llama/Llama-3.2-3B-Instruct-Turbo',
		'Qwen/Qwen3-Next-80B-A3B-Instruct',
	],
	requiresApiKey: true,
};
