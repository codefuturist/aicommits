import { command } from 'cleye';
import {
	select,
	confirm,
	password,
	text,
	outro,
	isCancel,
} from '@clack/prompts';
import { setConfigs } from '../utils/config.js';
import { selectModel } from '../feature/models/index.js';
import { openWebUrl } from '../utils/web.js';

export default command(
	{
		name: 'setup',
		description: 'Configure your AI provider and settings',
	},
	() => {
		(async () => {
			const provider = await select({
				message: 'Choose your AI provider:',
				options: [
					{ label: 'OpenAI', value: 'openai' },
					{ label: 'Together AI', value: 'togetherai' },
					{ label: 'Ollama (local)', value: 'ollama' },
					{ label: 'Custom OpenAI-compatible', value: 'custom' },
				],
			});

			if (isCancel(provider)) {
				outro('Setup cancelled');
				return;
			}

			const configs: [string, string][] = [];
			let selectedModel = '';

			// Always set the provider
			configs.push(['provider', provider]);

			if (provider === 'openai') {
				const hasKey = await confirm({
					message: 'Do you have an OpenAI API key?',
				});

				if (isCancel(hasKey)) {
					outro('Setup cancelled');
					return;
				}

				if (hasKey) {
					const key = await password({
						message: 'Enter your OpenAI API key:',
						validate: (value) => {
							if (!value) return 'API key is required';
							if (!value.startsWith('sk-'))
								return 'OpenAI key must start with "sk-"';
							return;
						},
					});

					if (isCancel(key)) {
						outro('Setup cancelled');
						return;
					}

					configs.push(['OPENAI_API_KEY', key as string]);

					// Select model using shared function
					try {
						selectedModel = await selectModel(
							'https://api.openai.com',
							key as string,
							undefined,
							'openai'
						);
					} catch (error) {
						outro('Setup cancelled');
						return;
					}
				} else {
					console.log(
						'Get your API key from: https://platform.openai.com/account/api-keys'
					);
					openWebUrl('https://platform.openai.com/account/api-keys');
					outro('Setup cancelled - please run setup again with your API key');
					return;
				}
			} else if (provider === 'togetherai') {
				const hasKey = await confirm({
					message: 'Do you have a Together AI API key?',
				});

				if (isCancel(hasKey)) {
					outro('Setup cancelled');
					return;
				}

				if (hasKey) {
					const key = await password({
						message: 'Enter your Together AI API key:',
						validate: (value) => {
							if (!value) return 'API key is required';
							if (!value.startsWith('tgp_'))
								return 'Together AI key must start with "tgp_"';
							return;
						},
					});

					if (isCancel(key)) {
						outro('Setup cancelled');
						return;
					}

					configs.push(['TOGETHER_API_KEY', key as string]);

					// Select model using shared function
					try {
						selectedModel = await selectModel(
							'https://api.together.xyz',
							key as string,
							undefined,
							'togetherai'
						);
					} catch (error) {
						outro('Setup cancelled');
						return;
					}
				} else {
					console.log('Get your API key from: https://api.together.ai/');
					openWebUrl('https://api.together.ai/');
					outro('Setup cancelled - please run setup again with your API key');
					return;
				}
			} else if (provider === 'ollama') {
				configs.push(['endpoint', 'http://localhost:11434']);
				console.log(
					'Make sure Ollama is running locally. Visit https://ollama.ai for installation instructions.'
				);

				// For Ollama, ask for model
				const model = await text({
					message: 'Enter your Ollama model name (e.g., llama2, codellama):',
					validate: (value) => {
						if (!value) return 'Model name is required';
						return;
					},
				});
				if (isCancel(model)) {
					outro('Setup cancelled');
					return;
				}
				selectedModel = model as string;
			} else if (provider === 'custom') {
				const endpoint = await text({
					message:
						'Enter your custom endpoint URL (e.g., https://api.example.com):',
					validate: (value) => {
						if (!value) return 'Endpoint URL is required';
						if (!/^https?:\/\//.test(value))
							return 'Must be a valid URL starting with http:// or https://';
						return;
					},
				});

				if (isCancel(endpoint)) {
					outro('Setup cancelled');
					return;
				}

				const key = await password({
					message: 'Enter your API key (leave empty if not required):',
				});

				if (isCancel(key)) {
					outro('Setup cancelled');
					return;
				}

				configs.push(['endpoint', endpoint as string]);
				if (key) {
					configs.push(['api-key', key as string]);
				}

				// Select model using shared function
				try {
					selectedModel = await selectModel(
						endpoint as string,
						(key as string) || '',
						undefined,
						'custom'
					);
				} catch (error) {
					outro('Setup cancelled');
					return;
				}
			}

			// Save the selected model
			if (selectedModel) {
				if (provider === 'openai') {
					configs.push(['openai-model', selectedModel]);
				} else if (provider === 'togetherai') {
					configs.push(['together-model', selectedModel]);
				} else {
					// For custom/ollama, use the general model config
					configs.push(['model', selectedModel]);
				}
			}

			await setConfigs(configs);
			outro(`✅ Setup complete! You're now using ${provider}.`);
		})().catch((error) => {
			console.error(`❌ Setup failed: ${error.message}`);
			process.exit(1);
		});
	}
);
