import { expect, testSuite } from 'manten';
import { generateCommitMessage } from '../../../src/utils/openai.js';
import type { ValidConfig } from '../../../src/utils/config.js';
import { getDiff } from '../../utils.js';

const { TOGETHER_API_KEY } = process.env;

export default testSuite(({ describe }) => {
	if (!TOGETHER_API_KEY) {
		console.warn(
			'⚠️  process.env.TOGETHER_API_KEY is necessary to run these tests. Skipping...'
		);
		return;
	}

	describe('Conventional Commits', async ({ test }) => {
		await test('Should not translate conventional commit type to Japanese when locale config is set to japanese', async () => {
			const japaneseConventionalCommitPattern =
				/(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\(.*\))?: [\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFF9F\u4E00-\u9FAF\u3400-\u4DBF]/;

			const gitDiff = await getDiff('new-feature.diff');

			const commitMessage = await runGenerateCommitMessage(gitDiff, {
				locale: 'ja',
			});

			expect(commitMessage).toMatch(japaneseConventionalCommitPattern);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "feat:" conventional commit when change relate to adding a new feature', async () => {
			const gitDiff = await getDiff('new-feature.diff');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "feat:" or "feat(<scope>):"
			expect(commitMessage).toMatch(/(feat(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		await test('Should use "refactor:" conventional commit when change relate to code refactoring', async () => {
			const gitDiff = await getDiff('code-refactoring.diff');

			const commitMessage = await runGenerateCommitMessage(gitDiff);

			// should match "refactor:" or "refactor(<scope>):"
			expect(commitMessage).toMatch(/(refactor(\(.*\))?):/);
			console.log('Generated message:', commitMessage);
		});

		async function runGenerateCommitMessage(
			gitDiff: string,
			configOverrides: Partial<ValidConfig> = {}
		): Promise<string> {
			const config = {
				locale: 'en',
				type: 'conventional',
				generate: 1,
				'max-length': 72,
				...configOverrides,
			} as ValidConfig;
			const commitMessages = await generateCommitMessage(
				'api.together.xyz',
				TOGETHER_API_KEY!,
				'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
				config.locale,
				gitDiff,
				config.generate,
				config['max-length'],
				config.type,
				7000
			);

			return commitMessages[0];
		}
	});
});
