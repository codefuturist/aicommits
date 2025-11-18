import { getConfig, setConfigs, type ValidConfig } from '../../utils/config.js';

export type ProviderConfig = ValidConfig;

export abstract class BaseProvider {
	protected config: ProviderConfig;

	constructor(config: ProviderConfig) {
		this.config = config;
	}

	abstract get name(): string;
	abstract get displayName(): string;

	abstract setup(): Promise<void>;
	abstract getModels(): Promise<{ models: string[]; error?: string }>;
	abstract getApiKey(): string | undefined;
	abstract getBaseUrl(): string;
	abstract getDefaultModel(): string;
	abstract validateConfig(): { valid: boolean; errors: string[] };

	protected async updateConfig(updates: [string, string][]): Promise<void> {
		await setConfigs(updates);
		this.config = await getConfig();
	}
}