// Model filtering, fetching, and selection utilities
import OpenAI from 'openai';
import type { ProviderDef } from './providers/base.js';

interface ModelObject {
	id?: string;
	name?: string;
	type?: string;
}



// Fetch models from API
export const fetchModels = async (
	baseUrl: string,
	apiKey: string
): Promise<{ models: ModelObject[]; error?: string }> => {
	try {
		const openai = new OpenAI({
			baseURL: baseUrl,
			apiKey,
		});

		const response = await openai.models.list();

		// we do this since Together API for openai models has different response than standard
		const modelsArray: ModelObject[] =
			response.data.length > 0
				? response.data
				: ((response as any).body as OpenAI.Models.Model[]);

		return { models: modelsArray };
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : 'Request failed';
		return { models: [], error: errorMessage };
	}
};

// Shared model selection function
export const selectModel = async (
	baseUrl: string,
	apiKey: string,
	currentModel?: string,
	providerDef?: ProviderDef
): Promise<string | null> => {
	// Fetch models
	console.log('Fetching available models...');
	const result = await fetchModels(baseUrl, apiKey);

	if (result.error) {
		console.error(`Failed to fetch models: ${result.error}`);
	}

	// Apply provider-specific filtering
	let models: string[] = [];
	if (providerDef?.modelsFilter) {
		models = providerDef.modelsFilter(result.models);
	} else {
		// Fallback: just use model ids/names
		models = result.models.map((model) => model.id || model.name).filter(Boolean) as string[];
	}

	let selectedModel = '';

	if (models.length > 0) {
		const { select, text, isCancel } = await import('@clack/prompts');

		// Prepare model options
		let modelOptions = models.map((model: string) => ({
			label: model,
			value: model,
		}));

		// Move current model to the top if it exists
		if (currentModel && currentModel !== 'undefined') {
			const currentIndex = modelOptions.findIndex(
				(opt) => opt.value === currentModel
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
		if (providerDef?.name === 'togetherai') {
			const preferredModel = 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
			const preferredIndex = modelOptions.findIndex(
				(opt) => opt.value === preferredModel
			);
			if (preferredIndex > 0) {
				const [preferred] = modelOptions.splice(preferredIndex, 1);
				modelOptions.unshift(preferred);
			}
		}

		let modelChoice;
		try {
			modelChoice = await select({
				message: 'Choose your model:',
				options: [
					{ label: '🔍 Search models...', value: 'search' },
					...modelOptions,
					{ label: 'Custom model name...', value: 'custom' },
				],
			});
		} catch {
			return null;
		}

		if (modelChoice === 'search') {
			// Search for models
			const searchTerm = await text({
				message: 'Enter search term for models:',
				placeholder: 'e.g., gpt, llama',
			});
			if (isCancel(searchTerm)) {
				return null;
			}

			let filteredModels = models;
			if (searchTerm) {
				filteredModels = models.filter((model: string) =>
					model.toLowerCase().includes((searchTerm as string).toLowerCase())
				);
			}

			// Prepare filtered options
			let searchOptions = filteredModels.slice(0, 20).map((model: string) => ({
				label: model,
				value: model,
			}));

			try {
				const searchChoice = await select({
					message: `Choose your model (filtered by "${searchTerm}"):`,
					options: [
						...searchOptions,
						{ label: 'Custom model name...', value: 'custom' },
					],
				});
				modelChoice = searchChoice;
			} catch {
				return null;
			}
		}

		if (modelChoice === 'custom') {
			try {
				const customModel = await text({
					message: 'Enter your custom model name:',
					validate: (value) => {
						if (!value) return 'Model name is required';
						return;
					},
				});
				selectedModel = customModel as string;
			} catch {
				return null;
			}
		} else {
			selectedModel = modelChoice as string;
		}
	} else {
		// Fallback to manual input
		console.log(
			'Could not fetch available models. Please specify a model name manually.'
		);
		const { text } = await import('@clack/prompts');
		try {
			const model = await text({
				message: 'Enter your model name:',
				validate: (value) => {
					if (!value) return 'Model name is required';
					return;
				},
			});
			selectedModel = model as string;
		} catch {
			return null;
		}
	}

	return selectedModel;
};
