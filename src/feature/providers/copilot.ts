import { ProviderDef } from './base.js';

export const CopilotProvider: ProviderDef = {
	name: 'copilot',
	displayName: 'GitHub Copilot',
	baseUrl: 'https://models.github.ai/inference',
	modelsUrl: 'https://models.github.ai/catalog/models',
	apiKeyHint: 'GitHub Personal Access Token (needs models:read scope)',
	requiresApiKey: true,
	defaultModels: [
		'openai/gpt-4.1',
		'openai/gpt-4o',
		'openai/gpt-4o-mini',
		'anthropic/claude-sonnet-4',
	],
	modelsFilter: (models) =>
		models
			.filter((m: any) => {
				const inputModalities = m.supported_input_modalities || [];
				return inputModalities.includes('text');
			})
			.map((m: any) => m.id)
			.filter(Boolean),
	setupHook: async () => {
		try {
			const { execSync } = await import('child_process');
			const token = execSync('gh auth token', {
				encoding: 'utf8',
				stdio: ['pipe', 'pipe', 'pipe'],
			}).trim();
			if (token) return token;
		} catch {}
		return null;
	},
};
