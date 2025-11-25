import { TogetherProvider } from './together.js';
import { OpenAiProvider } from './opeai.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiCustom } from './openaiCustom.js';

export const providers = [
	TogetherProvider,
	OpenAiProvider,
	OllamaProvider,
	OpenAiCustom,
];