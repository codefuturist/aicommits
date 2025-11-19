import { command } from 'cleye';
import { select, text, outro, isCancel } from '@clack/prompts';
import { getConfig, setConfigs } from '../utils/config.js';
import {
	getProvider,
	getAvailableProviders,
} from '../feature/providers/index.js';

export default command(
	{
		name: 'setup',
		description: 'Configure your AI provider and settings',
		help: {
			description: 'Configure your AI provider and settings',
		},
		flags: {
			provider: {
				type: String,
				description: 'AI provider (openai, togetherai, ollama, custom)',
			},
			'api-key': {
				type: String,
				description: 'API key for the provider',
			},
			'base-url': {
				type: String,
				description: 'Base URL for the provider',
			},
			model: {
				type: String,
				description: 'Model to use',
			},
		},
	},
	(argv) => {
		(async () => {
			const { provider: providerFlag, 'api-key': apiKeyFlag, 'base-url': baseUrlFlag, model: modelFlag } = argv.flags;

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
				const initialProvider = providerFlag || currentProvider;
				const choice = await select({
					message: 'Choose your AI provider:',
					options: providerOptions,
					initialValue: initialProvider,
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
				let defaultBaseUrl = customBaseUrl;
				if (providerChoice === 'openai') defaultBaseUrl = 'https://api.openai.com';
				else if (providerChoice === 'togetherai') defaultBaseUrl = 'https://api.together.xyz';
				else if (providerChoice === 'ollama') defaultBaseUrl = 'http://localhost:11434/v1';

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

				// Run provider-specific setup, but skip prompts if flags provided
				const isNonInteractive = providerFlag || apiKeyFlag || baseUrlFlag || modelFlag;
				if (isNonInteractive) {
					const updates: [string, string][] = [];
					if (apiKeyFlag) updates.push(['OPENAI_API_KEY', apiKeyFlag]);
					if (baseUrlFlag) updates.push(['OPENAI_BASE_URL', baseUrlFlag]);
					else if (providerFlag) updates.push(['OPENAI_BASE_URL', defaultBaseUrl]);
					if (modelFlag) updates.push(['OPENAI_MODEL', modelFlag]);
					await setConfigs(updates);
				} else {
					await provider.setup();

					// Select model interactively
					const { selectModel } = await import('../feature/models.js');
					const selectedModel = await selectModel(
						provider.getBaseUrl(),
						provider.getApiKey() || '',
						undefined,
						provider.name
					);

					if (selectedModel) {
						// Save the selected model
						await setConfigs([['OPENAI_MODEL', selectedModel]]);
						console.log(`Model selected: ${selectedModel}`);
					} else {
						console.log('Model selection cancelled.');
					}
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
