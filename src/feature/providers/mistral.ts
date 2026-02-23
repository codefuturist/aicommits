import { ProviderDef } from './base.js';

export const MistralProvider: ProviderDef = {
	name: 'mistral',
	displayName: 'Mistral AI',
	baseUrl: 'https://api.mistral.ai/v1',
	requiresApiKey: true,
	apiKeyHint: 'Mistral API key from https://console.mistral.ai',
	defaultModels: [
		'mistral-small-latest',
		'mistral-medium-latest',
		'mistral-large-latest',
		'codestral-latest',
	],
};
