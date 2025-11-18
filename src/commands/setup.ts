import { command } from 'cleye';
import { select, outro, isCancel } from '@clack/prompts';
import { getConfig, setConfigs } from '../utils/config.js';
import {
	getProvider,
	getAvailableProviders,
} from '../feature/providers/index.js';

export default command(
	{
		name: 'setup',
		description: 'Configure your AI provider and settings',
	},
	() => {
		(async () => {
			const providerOptions = getAvailableProviders();
			const providerChoice = await select({
				message: 'Choose your AI provider:',
				options: providerOptions,
			});

			if (isCancel(providerChoice)) {
				outro('Setup cancelled');
				return;
			}

			const config = await getConfig();
			config.provider = providerChoice as string;

			const provider = getProvider(config);
			if (!provider) {
				outro('Invalid provider selected');
				return;
			}

			// Run provider-specific setup
			await provider.setup();

			// Refresh config after setup
			const updatedConfig = await getConfig();

			// Select model using provider's getModels method
			const { selectModel } = await import('../feature/models.js');
			try {
				const selectedModel = await selectModel(
					provider.getBaseUrl(),
					provider.getApiKey() || '',
					undefined,
					provider.name
				);

				// Save the selected model
				const configs: [string, string][] = [];
				if (provider.name === 'openai') {
					configs.push(['openai-model', selectedModel]);
				} else if (provider.name === 'togetherai') {
					configs.push(['together-model', selectedModel]);
				} else {
					configs.push(['model', selectedModel]);
				}

				await setConfigs(configs);
			} catch (error) {
				// Model selection was cancelled, but setup is still complete
			}

			outro(`✅ Setup complete! You're now using ${provider.displayName}.`);
		})().catch((error) => {
			console.error(`❌ Setup failed: ${error.message}`);
			process.exit(1);
		});
	}
);
