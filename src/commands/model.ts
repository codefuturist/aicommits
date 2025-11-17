import { command } from 'cleye';
import { select, text, outro, isCancel } from '@clack/prompts';
import { getConfig, setConfigs } from '../utils/config.js';
import { selectModel } from '../feature/models/index.js';

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

			// Select model using shared function
			try {
				const selectedModel = await selectModel(baseUrl, apiKey, currentModel, config.provider);
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
