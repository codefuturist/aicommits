import { command } from 'cleye';
import { outro } from '@clack/prompts';
import { getConfig, setConfigs } from '../utils/config.js';
import { getProvider } from '../feature/providers/index.js';
import { selectModel } from '../feature/models.js';

export default command(
	{
		name: 'model',
		description: 'Select or change your AI model',
	},
	() => {
		(async () => {
			const config = await getConfig();

			if (!config.provider) {
				outro('No provider configured. Run `aicommits setup` first.');
				return;
			}

			const provider = getProvider(config);
			if (!provider) {
				outro(
					'Invalid provider configured. Run `aicommits setup` to reconfigure.'
				);
				return;
			}

			console.log(`Current provider: ${provider.displayName}`);

			// Show current model based on provider
			let currentModel = '';
			if (config.provider === 'openai') {
				currentModel = config['openai-model'];
			} else if (config.provider === 'togetherai') {
				currentModel = config['together-model'];
			} else {
				currentModel = config.model;
			}
			console.log(`Current model: ${currentModel || 'not set'}`);

			// Validate provider config
			const validation = provider.validateConfig();
			if (!validation.valid) {
				outro(
					`Configuration issues: ${validation.errors.join(
						', '
					)}. Run \`aicommits setup\` to reconfigure.`
				);
				return;
			}

			// Select model using provider
			try {
				const selectedModel = await selectModel(
					provider.getBaseUrl(),
					provider.getApiKey() || '',
					currentModel,
					provider.name
				);

				// Save the selected model
				const configs: [string, string][] = [];
				if (config.provider === 'openai') {
					configs.push(['openai-model', selectedModel]);
				} else if (config.provider === 'togetherai') {
					configs.push(['together-model', selectedModel]);
				} else {
					configs.push(['model', selectedModel]);
				}

				await setConfigs(configs);
				outro(`✅ Model updated to: ${selectedModel}`);
			} catch (error) {
				outro('Model selection cancelled');
				return;
			}
		})().catch((error) => {
			console.error(`❌ Model selection failed: ${error.message}`);
			process.exit(1);
		});
	}
);
