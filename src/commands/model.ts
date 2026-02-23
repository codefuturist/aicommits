import { command } from 'cleye';
import { outro } from '@clack/prompts';
import { getConfig, setConfigs } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import { selectModel } from '../feature/models.js';

export default command(
	{
		name: 'model',
		description: 'Select or change your AI model',
		help: {
			description: `Select or change the AI model for commit generation.
Fetches available models from the configured provider and lets you pick one.

Examples:
  aicommits model                  Browse and select from available models`,
		},
		alias: ['-m', 'models'],
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

			const currentModel = config.OPENAI_MODEL;

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
			const selectedModel = await selectModel(
				provider.getBaseUrl(),
				provider.getApiKey() || '',
				currentModel,
				provider.getDefinition(),
				provider.displayName
			);

			if (selectedModel) {
				// Save the selected model
				await setConfigs([['OPENAI_MODEL', selectedModel]]);
				outro(`✅ Model updated to: ${selectedModel}`);
			} else {
				outro('Model selection cancelled');
			}
		})().catch((error) => {
			console.error(`❌ Model selection failed: ${error.message}`);
			process.exit(1);
		});
	}
);
