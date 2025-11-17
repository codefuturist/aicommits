import { command } from 'cleye';
import { select, confirm, password, text, outro, isCancel, spinner } from '@clack/prompts';
import { setConfigs } from '../utils/config.js';
import https from 'https';

const openUrl = (url: string) => {
	const platform = process.platform;
	const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
	try {
		require('execa')(cmd, [url]);
	} catch {}
};

export const fetchModels = async (baseUrl: string, apiKey: string): Promise<{ models: string[], error?: string }> => {
	return new Promise((resolve) => {
		try {
			const url = new URL(baseUrl);
			const isHttps = url.protocol === 'https:';

			// Build the full API URL - use /v1/models for all providers
			const basePath = url.pathname.replace(/\/$/, ''); // Remove trailing slash
			let apiPath;
			if (basePath.endsWith('/v1')) {
				apiPath = basePath + '/models';
			} else if (basePath === '/' || basePath === '') {
				apiPath = '/v1/models';
			} else {
				apiPath = basePath + '/v1/models';
			}

			const options = {
				hostname: url.hostname,
				port: url.port || (isHttps ? 443 : 80),
				path: apiPath,
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				timeout: 5000,
			};

			// Use the appropriate protocol
			const httpModule = isHttps ? https : require('http');

			const req = httpModule.request(options, (res: any) => {
				let data = '';
				res.on('data', (chunk: any) => data += chunk);
				res.on('end', () => {
					try {
						const response = JSON.parse(data);

						// Handle different response formats
						let modelsArray;
						if (Array.isArray(response)) {
							// Together AI format: direct array
							modelsArray = response;
						} else if (response.data && Array.isArray(response.data)) {
							// OpenAI format: {data: [...]}
							modelsArray = response.data;
						} else {
							resolve({ models: [] });
							return;
						}

						// Filter to only language/chat models and extract IDs
						const models = modelsArray
							.filter((model: any) => model.id && (model.type === 'language' || model.type === 'chat'))
							.map((model: any) => model.id)
							.slice(0, 20); // Limit to 20 models for UI

						resolve({ models });
					} catch (e) {
						resolve({ models: [], error: `JSON parse error: ${e}` });
					}
				});
			});

			req.on('error', (err: any) => resolve({ models: [], error: `Request error: ${err.message}` }));
			req.on('timeout', () => {
				req.destroy();
				resolve({ models: [], error: 'Request timeout' });
			});
			req.end();
		} catch (error) {
			// Invalid URL format
			resolve({ models: [], error: `Invalid URL: ${error}` });
		}
	});
};

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
							if (!value.startsWith('sk-')) return 'OpenAI key must start with "sk-"';
							return;
						},
					});

					if (isCancel(key)) {
						outro('Setup cancelled');
						return;
					}

					configs.push(['OPENAI_API_KEY', key as string]);

					// Try to fetch available models
					const s = spinner();
					s.start('Fetching available models...');
					const result = await fetchModels('https://api.openai.com', key as string);
					s.stop();

					if (result.error) {
						console.error(`Failed to fetch OpenAI models: ${result.error}`);
					}

					if (result.models.length > 0) {
						const modelChoice = await select({
							message: 'Choose your model:',
							options: [
								...result.models.slice(0, 10).map((model: string) => ({ label: model, value: model })),
								{ label: 'Custom model name...', value: 'custom' }
							],
						});

						if (isCancel(modelChoice)) {
							outro('Setup cancelled');
							return;
						}

						if (modelChoice === 'custom') {
							const customModel = await password({
								message: 'Enter your custom model name:',
								validate: (value) => {
									if (!value) return 'Model name is required';
									return;
								},
							});
							if (isCancel(customModel)) {
								outro('Setup cancelled');
								return;
							}
							selectedModel = customModel as string;
						} else {
							selectedModel = modelChoice as string;
						}
					} else {
						// Models fetch failed, ask user to specify manually
						console.log('Could not fetch available models. Please specify a model name manually.');
						const model = await text({
							message: 'Enter your model name (e.g., gpt-4, gpt-3.5-turbo):',
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
					}
				} else {
					console.log('Get your API key from: https://platform.openai.com/account/api-keys');
					openUrl('https://platform.openai.com/account/api-keys');
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
							if (!value.startsWith('tgp_')) return 'Together AI key must start with "tgp_"';
							return;
						},
					});

					if (isCancel(key)) {
						outro('Setup cancelled');
						return;
					}

					configs.push(['TOGETHER_API_KEY', key as string]);

					// Try to fetch available models
					const s = spinner();
					s.start('Fetching available models...');
					const result = await fetchModels('https://api.together.xyz', key as string);
					s.stop();

					if (result.error) {
						console.error(`Failed to fetch Together AI models: ${result.error}`);
					}

					if (result.models.length > 0) {
						const modelChoice = await select({
							message: 'Choose your model:',
							options: [
								...result.models.slice(0, 10).map((model: string) => ({ label: model, value: model })),
								{ label: 'Custom model name...', value: 'custom' }
							],
						});

						if (isCancel(modelChoice)) {
							outro('Setup cancelled');
							return;
						}

						if (modelChoice === 'custom') {
							const customModel = await password({
								message: 'Enter your custom model name:',
								validate: (value) => {
									if (!value) return 'Model name is required';
									return;
								},
							});
							if (isCancel(customModel)) {
								outro('Setup cancelled');
								return;
							}
							selectedModel = customModel as string;
						} else {
							selectedModel = modelChoice as string;
						}
					} else {
						// Models fetch failed, ask user to specify manually
						console.log('Could not fetch available models. Please specify a model name manually.');
						const model = await text({
							message: 'Enter your model name (e.g., meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo):',
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
					}
				} else {
					console.log('Get your API key from: https://api.together.ai/');
					openUrl('https://api.together.ai/');
					outro('Setup cancelled - please run setup again with your API key');
					return;
				}
			} else if (provider === 'ollama') {
				configs.push(['endpoint', 'http://localhost:11434']);
				console.log('Make sure Ollama is running locally. Visit https://ollama.ai for installation instructions.');

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
					message: 'Enter your custom endpoint URL (e.g., https://api.example.com):',
					validate: (value) => {
						if (!value) return 'Endpoint URL is required';
						if (!/^https?:\/\//.test(value)) return 'Must be a valid URL starting with http:// or https://';
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

				// For custom endpoints, try to fetch models
				const s = spinner();
				s.start('Fetching available models...');
				const result = await fetchModels(endpoint as string, key as string || '');
				s.stop();

				if (result.error) {
					console.error(`Failed to fetch models from ${endpoint}: ${result.error}`);
				}

					if (result.models.length > 0) {
						// Preselect meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo for Together AI
						const preferredModel = 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
						let modelOptions = result.models.slice(0, 10).map((model: string) => ({
							label: model,
							value: model
						}));

						// Move preferred model to the top if it exists
						const preferredIndex = modelOptions.findIndex(opt => opt.value === preferredModel);
						if (preferredIndex > 0) {
							const [preferred] = modelOptions.splice(preferredIndex, 1);
							modelOptions.unshift(preferred);
						}

						const modelChoice = await select({
							message: 'Choose your model:',
							options: [
								...modelOptions,
								{ label: 'Custom model name...', value: 'custom' }
							],
						});

					if (isCancel(modelChoice)) {
						outro('Setup cancelled');
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
							outro('Setup cancelled');
							return;
						}
						selectedModel = customModel as string;
					} else {
						selectedModel = modelChoice as string;
					}
				} else {
					// Models fetch failed, ask user to specify manually
					console.log('Could not fetch available models. Please specify a model name manually.');
					const model = await text({
						message: 'Enter your model name:',
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