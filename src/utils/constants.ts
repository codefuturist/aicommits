// Constants used across the application
export const TOGETHER_PREFERRED_MODEL =
	'meta-llama/Llama-3.3-70B-Instruct-Turbo';

// Label formatters
export const CURRENT_LABEL_FORMAT = (model: string) => `[${model} - ✅]`;
export const PREFERRED_LABEL_FORMAT = (model: string) =>
	`[${model} - suggested]`;
