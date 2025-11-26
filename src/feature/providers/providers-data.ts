import { TogetherProvider } from './together.js';
import { OpenAiProvider } from './openai.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiCustom } from './openaiCustom.js';
import { OpenRouterProvider } from './openrouter.js';

export const providers = [
	TogetherProvider,
	OpenAiProvider,
	OllamaProvider,
	OpenRouterProvider,
	OpenAiCustom,
];