import { command } from 'cleye';
import { outro, log } from '@clack/prompts';
import { getConfig, setConfigs } from '../utils/config-runtime.js';
import { getProvider } from '../feature/providers/index.js';
import { selectModel } from '../feature/models.js';
import { TOGETHER_PREFERRED_MODEL } from '../utils/constants.js';

export default command(
	{
		name: 'model',
		description: 'Select or change your AI model',
		help: {
			description: 'Select or change your AI model',
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

			console.log(`Current provider: ${provider.displayName}`);

			// Show current model
			const currentModel = config.OPENAI_MODEL;
			console.log(
				`Current model: ${
					currentModel && currentModel !== 'undefined'
						? currentModel
						: 'not set'
				}`
			);

			const originalCurrent = currentModel;

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
				provider.getDefinition()
			);

			if (selectedModel) {
				// Save the selected model
				await setConfigs([['OPENAI_MODEL', selectedModel]]);
				outro(`✅ Model updated to: ${selectedModel}`);
			} else {
				// If cancelled and no original model, set to preferred for Together AI
				if (provider.name === 'togetherai' && (!originalCurrent || originalCurrent === 'undefined')) {
					await setConfigs([['OPENAI_MODEL', TOGETHER_PREFERRED_MODEL]]);
					outro(`✅ Model set to default: ${TOGETHER_PREFERRED_MODEL}`);
				} else {
					outro('Model selection cancelled');
				}
			}
		})().catch((error) => {
			console.error(`❌ Model selection failed: ${error.message}`);
			process.exit(1);
		});
	}
);
