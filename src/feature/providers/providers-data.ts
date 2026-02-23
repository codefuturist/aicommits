import { TogetherProvider } from './together.js';
import { OpenAiProvider } from './openai.js';
import { CopilotProvider } from './copilot.js';
import { OllamaProvider } from './ollama.js';
import { OpenAiCustom } from './openaiCustom.js';
import { OpenRouterProvider } from './openrouter.js';
import { LMStudioProvider } from './lmstudio.js';

export const providers = [
	TogetherProvider,
	OpenAiProvider,
	CopilotProvider,
	OllamaProvider,
	LMStudioProvider,
	OpenRouterProvider,
	OpenAiCustom,
];
