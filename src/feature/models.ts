// Model filtering, fetching, and selection utilities
import OpenAI from 'openai';

interface ModelObject {
	id?: string;
	name?: string;
	type?: string;
}

// Filter models based on vendor-specific logic
export const filterModels = (
	modelsArray: ModelObject[],
	baseUrl: string
): string[] => {
	let filtered: ModelObject[] = modelsArray.filter(
		(model) => model.id || model.name
	);

	// Vendor-specific filtering
	if (baseUrl.includes('api.openai.com')) {
		// OpenAI: Prioritize GPT, O-series models
		const prioritized = filtered.filter(
			(model) =>
				model.id &&
				(model.id.includes('gpt') ||
					model.id.includes('o1') ||
					model.id.includes('o3') ||
					model.id.includes('o4') ||
					model.id.includes('o5') ||
					!model.type ||
					model.type === 'chat')
		);
		// If prioritized list is empty, fall back to all models
		filtered = prioritized.length > 0 ? prioritized : filtered;
	} else if (baseUrl.includes('api.together.xyz')) {
		// Together AI: Filter by type if available, otherwise include all
		const typeFiltered = filtered.filter(
			(model) =>
				!model.type || model.type === 'chat' || model.type === 'language'
		);
		// If type filtering removes all models, fall back to all models
		filtered = typeFiltered.length > 0 ? typeFiltered : filtered;
	} else {
		// Custom endpoints: Basic filtering
		const typeFiltered = filtered.filter(
			(model) =>
				!model.type || model.type === 'chat' || model.type === 'language'
		);
		// If type filtering removes all models, fall back to all models
		filtered = typeFiltered.length > 0 ? typeFiltered : filtered;
	}

	// Final fallback: if filtering results in empty array, return original models
	if (filtered.length === 0) {
		filtered = modelsArray.filter((model) => model.id || model.name);
	}

	return filtered.map((model) => (model.id || model.name)!);
};

// Fetch models from API
export const fetchModels = async (
	baseUrl: string,
	apiKey: string
): Promise<{ models: string[]; error?: string }> => {
	try {
		const openai = new OpenAI({
			baseURL: baseUrl,
			apiKey,
		});

		const response = await openai.models.list();
		const modelsArray: ModelObject[] = response.data;
		const models = filterModels(modelsArray, baseUrl);

		return { models };
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
	provider?: string
): Promise<string | null> => {
	// Fetch models
	console.log('Fetching available models...');
	const result = await fetchModels(baseUrl, apiKey);

	if (result.error) {
		console.error(`Failed to fetch models: ${result.error}`);
	}

	let selectedModel = '';

	if (result.models.length > 0) {
		const { select, text, isCancel } = await import('@clack/prompts');

		// Prepare model options
		let modelOptions = result.models.map((model: string) => ({
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
		if (provider === 'togetherai') {
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

			let filteredModels = result.models;
			if (searchTerm) {
				filteredModels = result.models.filter((model: string) =>
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
