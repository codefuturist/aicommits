// Model filtering, fetching, and selection utilities
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { ProviderDef } from './providers/base.js';
import { CURRENT_LABEL_FORMAT, PREFERRED_LABEL_FORMAT } from '../utils/constants.js';
import { isCancel } from '@clack/prompts';
import { fileExists } from '../utils/fs.js';

interface ModelObject {
	id?: string;
	name?: string;
	type?: string;
}

interface CacheEntry {
	data: { models: ModelObject[]; error?: string };
	timestamp: number;
}

const CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

const getCacheDir = (): string => {
	const platform = process.platform;
	const home = os.homedir();

	if (platform === 'darwin') {
		return path.join(home, 'Library', 'Caches', 'aicommits', 'models');
	} else if (platform === 'win32') {
		return path.join(home, 'AppData', 'Local', 'aicommits', 'models');
	} else {
		// Linux/Unix
		const xdgCache = process.env.XDG_CACHE_HOME;
		const baseCache = xdgCache ? xdgCache : path.join(home, '.cache');
		return path.join(baseCache, 'aicommits', 'models');
	}
};

const getCacheKey = (baseUrl: string): string => {
	const hash = crypto.createHash('sha256');
	hash.update(baseUrl);
	return hash.digest('hex');
};

const getCachePath = (key: string): string =>
	path.join(getCacheDir(), `${key}.json`);

const readCache = async (key: string): Promise<CacheEntry | null> => {
	const cachePath = getCachePath(key);
	try {
		if (!(await fileExists(cachePath))) return null;
		const data = await fs.readFile(cachePath, 'utf8');
		return JSON.parse(data);
	} catch {
		return null;
	}
};

const writeCache = async (key: string, entry: CacheEntry): Promise<void> => {
	try {
		const cacheDir = getCacheDir();
		await fs.mkdir(cacheDir, { recursive: true });
		const cachePath = getCachePath(key);
		await fs.writeFile(cachePath, JSON.stringify(entry), 'utf8');
	} catch {
		// Ignore write errors
	}
};

// Fetch models from API
export const fetchModels = async (
	baseUrl: string,
	apiKey: string
): Promise<{ models: ModelObject[]; error?: string }> => {
	const cacheKey = getCacheKey(baseUrl);
	const now = Date.now();
	const cached = await readCache(cacheKey);

	if (cached && now - cached.timestamp < CACHE_DURATION) {
		return cached.data;
	}

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

		const result = { models: modelsArray };
		await writeCache(cacheKey, { data: result, timestamp: now });
		return result;
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : 'Request failed';
		const result = { models: [], error: errorMessage };
		await writeCache(cacheKey, { data: result, timestamp: now });
		return result;
	}
};

// Shared model selection function
const fetchAndFilterModels = async (
	baseUrl: string,
	apiKey: string,
	providerDef?: ProviderDef
): Promise<string[]> => {
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
		models = result.models
			.map((model) => model.id || model.name)
			.filter(Boolean) as string[];
	}
	return models;
};

const prepareModelOptions = (
	models: string[],
	currentModel?: string,
	providerDef?: ProviderDef
) => {
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
			modelOptions[currentIndex].label = CURRENT_LABEL_FORMAT(
				modelOptions[currentIndex].value
			);
			if (currentIndex > 0) {
				const [current] = modelOptions.splice(currentIndex, 1);
				modelOptions.unshift(current);
			}
		} else {
			// Current model not in fetched list, add it at the top
			modelOptions.unshift({
				label: CURRENT_LABEL_FORMAT(currentModel),
				value: currentModel,
			});
		}
	}



	return modelOptions;
};

const handleSearch = async (
	models: string[],
	select: any,
	text: any,
	isCancel: any
): Promise<string | null> => {
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

	const searchChoice = await select({
		message: `Choose your model (filtered by "${searchTerm}"):`,
		options: [
			...searchOptions,
			{ label: 'Custom model name...', value: 'custom' },
		],
	});

	if (isCancel(searchChoice)) return null;

	return searchChoice as string;
};

const handleCustom = async (text: any): Promise<string | null> => {
	const customModel = await text({
		message: 'Enter your custom model name:',
		validate: (value: string) => {
			if (!value) return 'Model name is required';
			return;
		},
	});

	if (isCancel(customModel)) return null;

	return customModel as string;
};

export const selectModel = async (
	baseUrl: string,
	apiKey: string,
	currentModel?: string,
	providerDef?: ProviderDef
): Promise<string | null> => {
	// Default to provider's default model if none set
	if (!currentModel || currentModel === 'undefined') {
		currentModel = providerDef?.defaultModel;
	}

	const models = await fetchAndFilterModels(baseUrl, apiKey, providerDef);

	let selectedModel: string | null = null;

	if (models.length > 0) {
		const { select, text, isCancel } = await import('@clack/prompts');

		let modelOptions = prepareModelOptions(models, currentModel, providerDef);

		let modelChoice = await select({
			message: 'Choose your model:',
			options: [
				{ label: '🔍 Search models...', value: 'search' },
				...modelOptions,
				{ label: 'Custom model name...', value: 'custom' },
			],
		});

		if (isCancel(modelChoice)) return null;

		if (modelChoice === 'search') {
			const searchChoice = await handleSearch(models, select, text, isCancel);
			if (searchChoice === null) return null;
			modelChoice = searchChoice;
		}

		if (modelChoice === 'custom') {
			selectedModel = await handleCustom(text);
			if (selectedModel === null) return null;
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
