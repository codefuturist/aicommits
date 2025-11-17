// Model filtering, fetching, and selection utilities

// Filter models based on vendor-specific logic
export const filterModels = (modelsArray: any[], baseUrl: string): string[] => {
	let filtered = modelsArray.filter((model: any) => model.id);

	// Vendor-specific filtering
	if (baseUrl.includes('api.openai.com')) {
		// OpenAI: Prioritize GPT, O-series models
		const prioritized = filtered.filter((model: any) =>
			model.id.includes('gpt') ||
			model.id.includes('o1') ||
			model.id.includes('o3') ||
			model.id.includes('o4') ||
			model.id.includes('o5') ||
			(!model.type || model.type === 'chat')
		);
		// If prioritized list is empty, fall back to all models
		filtered = prioritized.length > 0 ? prioritized : filtered;
	} else if (baseUrl.includes('api.together.xyz')) {
		// Together AI: Filter by type if available, otherwise include all
		const typeFiltered = filtered.filter((model: any) =>
			!model.type || model.type === 'chat' || model.type === 'language'
		);
		// If type filtering removes all models, fall back to all models
		filtered = typeFiltered.length > 0 ? typeFiltered : filtered;
	} else {
		// Custom endpoints: Basic filtering
		const typeFiltered = filtered.filter((model: any) =>
			!model.type || model.type === 'chat' || model.type === 'language'
		);
		// If type filtering removes all models, fall back to all models
		filtered = typeFiltered.length > 0 ? typeFiltered : filtered;
	}

	// Final fallback: if filtering results in empty array, return original models
	if (filtered.length === 0) {
		filtered = modelsArray.filter((model: any) => model.id);
	}

	return filtered.map((model: any) => model.id).slice(0, 20);
};

// Fetch models from API
export const fetchModels = async (
	baseUrl: string,
	apiKey: string
): Promise<{ models: string[]; error?: string }> => {
	try {
		const modelsUrl = `${baseUrl.replace(/\/$/, '')}/v1/models`;

		const response = await fetch(modelsUrl, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			signal: AbortSignal.timeout(5000),
		});

		if (!response.ok) {
			return { models: [], error: `HTTP ${response.status}` };
		}

		const data = await response.json();
		const modelsArray = Array.isArray(data) ? data : data.data || [];
		const models = filterModels(modelsArray, baseUrl);

		return { models };
	} catch (error: any) {
		return { models: [], error: error.message || 'Request failed' };
	}
};

// Shared model selection function
export const selectModel = async (
	baseUrl: string,
	apiKey: string,
	currentModel?: string,
	provider?: string
): Promise<string> => {
	// Fetch models
	console.log('Fetching available models...');
	const result = await fetchModels(baseUrl, apiKey);

	if (result.error) {
		console.error(`Failed to fetch models: ${result.error}`);
	}

	let selectedModel = '';

	if (result.models.length > 0) {
		// Prepare model options
		let modelOptions = result.models.slice(0, 10).map((model: string) => ({
			label: model,
			value: model
		}));

		// Move current model to the top if it exists
		if (currentModel) {
			const currentIndex = modelOptions.findIndex((opt: any) => opt.value === currentModel);
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
					value: currentModel
				});
			}
		}

		// For Together AI, also prefer the recommended model
		if (provider === 'togetherai') {
			const preferredModel = 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo';
			const preferredIndex = modelOptions.findIndex((opt: any) => opt.value === preferredModel);
			if (preferredIndex > 0) {
				const [preferred] = modelOptions.splice(preferredIndex, 1);
				modelOptions.unshift(preferred);
			}
		}

		const { select, text } = await import('@clack/prompts');

		const modelChoice = await select({
			message: 'Choose your model:',
			options: [
				...modelOptions,
				{ label: 'Custom model name...', value: 'custom' }
			],
		});

		if (modelChoice === 'custom') {
			const customModel = await text({
				message: 'Enter your custom model name:',
				validate: (value) => {
					if (!value) return 'Model name is required';
					return;
				},
			});
			selectedModel = customModel as string;
		} else {
			selectedModel = modelChoice as string;
		}
	} else {
		// Fallback to manual input
		console.log('Could not fetch available models. Please specify a model name manually.');
		const { text } = await import('@clack/prompts');
		const model = await text({
			message: 'Enter your model name:',
			validate: (value) => {
				if (!value) return 'Model name is required';
				return;
			},
		});
		selectedModel = model as string;
	}

	return selectedModel;
};