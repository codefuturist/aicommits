import { command } from 'cleye';
import { select, text, outro, isCancel } from '@clack/prompts';
import { getConfig, setConfigs } from '../utils/config.js';
import { fetchModels } from './setup.js';

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

			console.log(`Current provider: ${config.provider}`);

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

			// Fetch available models for the current provider
			let baseUrl = '';
			if (config.provider === 'openai') {
				baseUrl = config['openai-base-url'] || 'https://api.openai.com';
			} else if (config.provider === 'togetherai') {
				baseUrl = 'https://api.together.xyz';
			} else if (config.provider === 'custom') {
				if (!config.endpoint) {
					outro(
						'Custom provider requires endpoint. Run `aicommits setup` to configure.'
					);
					return;
				}
				baseUrl = config.endpoint;
			} else if (config.provider === 'ollama') {
				baseUrl = config.endpoint || 'http://localhost:11434';
			}

			if (!baseUrl) {
				outro('Unable to determine API endpoint for current provider.');
				return;
			}

			// Get API key
			let apiKey = '';
			if (config.provider === 'openai') {
				apiKey = config.OPENAI_API_KEY || '';
			} else if (config.provider === 'togetherai') {
				apiKey = config.TOGETHER_API_KEY || '';
			} else {
				apiKey = config['api-key'] || '';
			}

			if (!apiKey && config.provider !== 'ollama') {
				outro(
					'API key required for this provider. Run `aicommits setup` to configure.'
				);
				return;
			}

			// Fetch models
			console.log('Fetching available models...');
			const result = await fetchModels(baseUrl, apiKey);

			if (result.error) {
				console.error(`Failed to fetch models: ${result.error}`);
			}

			let selectedModel = '';

			if (result.models.length > 0) {
				// Preselect current model if it exists in the list
				let modelOptions = result.models.slice(0, 10).map((model: string) => ({
					label: model,
					value: model,
				}));

				// Mark and move current model to the top if it exists
				if (currentModel) {
					const currentIndex = modelOptions.findIndex(
						(opt: any) => opt.value === currentModel
					);
					if (currentIndex >= 0) {
						// Mark as current and move to top
						modelOptions[currentIndex].label += ' (current)';
						if (currentIndex > 0) {
							const [current] = modelOptions.splice(currentIndex, 1);
							modelOptions.unshift(current);
						}
					} else {
						// Current model not in fetched list, add it at the top
						modelOptions.unshift({
							label: `${currentModel} (current)`,
							value: currentModel,
						});
					}
				}

				// For Together AI, also prefer the recommended model
				if (config.provider === 'togetherai') {
					const preferredModel = 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
					const preferredIndex = modelOptions.findIndex(
						(opt) => opt.value === preferredModel
					);
					if (preferredIndex > 0) {
						const [preferred] = modelOptions.splice(preferredIndex, 1);
						modelOptions.unshift(preferred);
					}
				}

				const modelChoice = await select({
					message: 'Choose your model:',
					options: [
						...modelOptions,
						{ label: 'Custom model name...', value: 'custom' },
					],
				});

				if (isCancel(modelChoice)) {
					outro('Model selection cancelled');
					return;
				}

				if (modelChoice === 'custom') {
					const customModel = await text({
						message: 'Enter your custom model name:',
						validate: (value) => {
							if (!value) return 'Model name is required';
							return;
						},
					});
					if (isCancel(customModel)) {
						outro('Model selection cancelled');
						return;
					}
					selectedModel = customModel as string;
				} else {
					selectedModel = modelChoice as string;
				}
			} else {
				// Fallback to manual input
				console.log(
					'Could not fetch available models. Please specify a model name manually.'
				);
				const model = await text({
					message: 'Enter your model name:',
					validate: (value) => {
						if (!value) return 'Model name is required';
						return;
					},
				});
				if (isCancel(model)) {
					outro('Model selection cancelled');
					return;
				}
				selectedModel = model as string;
			}

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
		})().catch((error) => {
			console.error(`❌ Model selection failed: ${error.message}`);
			process.exit(1);
		});
	}
);
