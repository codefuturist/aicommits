import { ProviderDef } from './base.js';

export const TogetherProvider: ProviderDef = {
	name: 'togetherai',
	displayName: 'Together AI (recommended)',
	baseUrl: 'https://api.together.xyz/v1',
	apiKeyFormat: 'tgp_',
	modelsFilter: (models) =>
		models
			.filter(
				(m: any) =>
					(!m.type || m.type === 'chat' || m.type === 'language') &&
					!m.id.toLowerCase().includes('vision'),
			)
			.map((m: any) => m.id),
	defaultModels: [
		'moonshotai/Kimi-K2-Instruct-0905',
		'Qwen/Qwen3-Next-80B-A3B-Instruct',
		'zai-org/GLM-4.5-Air-FP8',
		'meta-llama/Llama-3.2-3B-Instruct-Turbo',
	],
	requiresApiKey: true,
};
