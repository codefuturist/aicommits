import type { CommitType } from './types';

/** Format templates for each commit type. */
const commitTypeFormats: Record<CommitType, string> = {
	plain: '<commit message>',
	conventional: '<type>[optional (<scope>)]: <commit message>\nThe commit message subject must start with a lowercase letter',
	gitmoji: ':emoji: <commit message>',
};

/** Type-specific instructions. */
const commitTypeInstructions: Record<CommitType, string> = {
	plain: '',

	conventional: `Choose a type from the type-to-description JSON below that best describes the git diff. IMPORTANT: The type MUST be lowercase (e.g., "feat", not "Feat" or "FEAT"):\n${JSON.stringify(
		{
			docs: 'Documentation only changes',
			style: 'Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)',
			refactor: 'A code change that improves code structure without changing functionality',
			perf: 'A code change that improves performance',
			test: 'Adding missing tests or correcting existing tests',
			build: 'Changes that affect the build system or external dependencies',
			ci: 'Changes to our CI configuration files and scripts',
			chore: "Other changes that don't modify src or test files",
			revert: 'Reverts a previous commit',
			feat: 'A new feature',
			fix: 'A bug fix',
		},
		null,
		2,
	)}`,

	gitmoji: `Choose an emoji from the emoji-to-description JSON below that best describes the git diff:\n${JSON.stringify(
		{
			'🎨': 'Improve structure / format of the code',
			'⚡': 'Improve performance',
			'🔥': 'Remove code or files',
			'🐛': 'Fix a bug',
			'✨': 'Introduce new features',
			'📝': 'Add or update documentation',
			'💄': 'Add or update the UI and style files',
			'✅': 'Add, update, or pass tests',
			'🔒': 'Fix security or privacy issues',
			'⬆️': 'Upgrade dependencies',
			'♻️': 'Refactor code',
			'➕': 'Add a dependency',
			'➖': 'Remove a dependency',
			'🔧': 'Add or update configuration files',
		},
		null,
		2,
	)}`,
};

/**
 * Build the system prompt for AI commit message generation.
 * Ported from the CLI's prompt.ts — produces identical output.
 */
export function generatePrompt(
	locale: string,
	maxLength: number,
	type: CommitType,
	customPrompt?: string,
): string {
	return [
		'Generate a concise git commit message title in present tense that precisely describes the key changes in the following code diff. Focus on what was changed, not just file names. Provide only the title, no description or body.',
		`Message language: ${locale}`,
		`Commit message must be a maximum of ${maxLength} characters.`,
		'Exclude anything unnecessary such as translation. Your entire response will be passed directly into git commit.',
		`IMPORTANT: Do not include any explanations, introductions, or additional text. Do not wrap the commit message in quotes or any other formatting. The commit message must not exceed ${maxLength} characters. Respond with ONLY the commit message text.`,
		'Be specific: include concrete details (package names, versions, functionality) rather than generic statements.',
		customPrompt,
		commitTypeInstructions[type],
		`The output response must be in format:\n${commitTypeFormats[type]}`,
	]
		.filter(Boolean)
		.join('\n');
}
