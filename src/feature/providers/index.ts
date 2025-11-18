import { BaseProvider, ProviderConfig } from './base.js';
import { OpenAIProvider } from './openai.js';
import { TogetherAIProvider } from './togetherai.js';
import { OllamaProvider } from './ollama.js';
import { CustomProvider } from './custom.js';
import type { ValidConfig } from '../../utils/config.js';

export { BaseProvider } from './base.js';
export type { ProviderConfig } from './base.js';

const providers = {
	openai: OpenAIProvider,
	togetherai: TogetherAIProvider,
	ollama: OllamaProvider,
	custom: CustomProvider,
};

export function getProvider(config: ProviderConfig): BaseProvider | null {
	let providerName = config.provider;

	// If no explicit provider, try to auto-detect
	if (!providerName) {
		if (config['openai-base-url']) {
			providerName = 'openai';
		} else if (config.endpoint) {
			providerName = 'custom';
		} else if (config.OPENAI_API_KEY) {
			providerName = 'openai';
		} else if (config.TOGETHER_API_KEY) {
			providerName = 'togetherai';
		}
	}

	if (!providerName || !providers[providerName as keyof typeof providers]) {
		return null;
	}
	const ProviderClass = providers[providerName as keyof typeof providers];
	return new ProviderClass(config);
}

export function getAvailableProviders(): { value: string; label: string }[] {
	return Object.values(providers).map(ProviderClass => {
		// Create a minimal config object with required properties
		const minimalConfig = {} as ValidConfig;
		const instance = new ProviderClass(minimalConfig);
		return {
			value: instance.name,
			label: instance.displayName,
		};
	});
}