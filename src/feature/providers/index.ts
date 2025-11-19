import { Provider, type ProviderDef } from './base.js';
import type { ValidConfig } from '../../utils/config.js';
import { TogetherProvider } from './together.js';
import { OpenAiProvider } from './opeai.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiCustom } from './openaiCustom.js';

export { Provider } from './base.js';
export type { ProviderDef } from './base.js';

const providers: ProviderDef[] = [
	TogetherProvider,
	OpenAiProvider,
	OllamaProvider,
	OpenAiCustom,
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

export function getProviderBaseUrl(providerName: string): string {
	const provider = providers.find((p) => p.name === providerName);
	return provider?.baseUrl || '';
}

export function getProviderDef(providerName: string): ProviderDef | undefined {
	return providers.find((p) => p.name === providerName);
}
