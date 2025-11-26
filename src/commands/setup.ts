import { command } from 'cleye';
import { select, text, outro, isCancel } from '@clack/prompts';
import { getConfig, setConfigs } from '../utils/config-runtime.js';
import {
	getProvider,
	getAvailableProviders,
	getProviderBaseUrl,
} from '../feature/providers/index.js';

export default command(
	{
		name: 'setup',
		description: 'Configure your AI provider and settings',
		help: {
			description: 'Configure your AI provider and settings',
		},
	},
	(argv) => {
		(async () => {
			let config = await getConfig();
			const currentProvider = config.provider;

			// Backup current config
			const backupUpdates: [string, string][] = [
				['OPENAI_API_KEY', config.OPENAI_API_KEY || ''],
				['OPENAI_BASE_URL', config.OPENAI_BASE_URL || ''],
				['OPENAI_MODEL', config.OPENAI_MODEL || ''],
			];

			let setupSuccessful = false;

			try {
				const providerOptions = getAvailableProviders();
				const choice = await select({
					message: 'Choose your AI provider:',
					options: providerOptions,
					initialValue: currentProvider,
				});

				if (isCancel(choice)) {
					outro('Setup cancelled');
					return;
				}
				const providerChoice = choice as string;

				// Ask for custom base URL if custom provider
				let customBaseUrl = '';
				if (providerChoice === 'custom') {
					const baseUrlInput = await text({
						message: 'Enter your custom API endpoint:',
						validate: (value: string) => {
							if (!value) return 'Endpoint is required';
							try {
								new URL(value);
							} catch {
								return 'Invalid URL format';
							}
							return;
						},
					});
					if (isCancel(baseUrlInput)) {
						outro('Setup cancelled');
						return;
					}
					customBaseUrl = baseUrlInput as string;
				}

				// Set default base URL for the provider
				let defaultBaseUrl = customBaseUrl || getProviderBaseUrl(providerChoice);

				// Clear old keys and set defaults
				const clearUpdates: [string, string][] = [
					['OPENAI_API_KEY', ''],
					['OPENAI_BASE_URL', defaultBaseUrl],
					['OPENAI_MODEL', ''],
				];
				await setConfigs(clearUpdates);

				// Reload config
				config = await getConfig();
				const provider = getProvider(config);
				if (!provider) {
					outro('Invalid provider selected');
					return;
				}

				await provider.setup();

				setupSuccessful = true; // Provider and API key configured

				// Select model interactively
				const { selectModel } = await import('../feature/models.js');
				const selectedModel = await selectModel(
					provider.getBaseUrl(),
					provider.getApiKey() || '',
					undefined,
					provider.getDefinition()
				);

				if (selectedModel) {
					// Save the selected model
					await setConfigs([['OPENAI_MODEL', selectedModel]]);
					console.log(`Model selected: ${selectedModel}`);
				} else {
					console.log('Model selection cancelled.');
				}

				setupSuccessful = true;
				outro(`✅ Setup complete! You're now using ${provider.displayName}.`);
			} finally {
				if (!setupSuccessful) {
					// Restore backup config
					await setConfigs(backupUpdates);
				}
			}
		})().catch((error) => {
			console.error(`❌ Setup failed: ${error.message}`);
			process.exit(1);
		});
	}
);
