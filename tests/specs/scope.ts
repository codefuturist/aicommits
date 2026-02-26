import { testSuite, expect } from 'manten';
import { createFixture } from '../utils.js';

export default testSuite(({ describe }) => {
	describe('scope', async ({ describe }) => {
		describe('config', async ({ test }) => {
			test('set scope=auto', async () => {
				const { aicommits } = await createFixture();
				const { stderr } = await aicommits(
					['config', 'set', 'scope=auto'],
					{ reject: false }
				);
				expect(stderr).toBe('');
			});

			test('set scope=none', async () => {
				const { aicommits } = await createFixture();
				const { stderr } = await aicommits(
					['config', 'set', 'scope=none'],
					{ reject: false }
				);
				expect(stderr).toBe('');
			});

			test('set scope to explicit path', async () => {
				const { aicommits } = await createFixture();
				const { stderr } = await aicommits(
					['config', 'set', 'scope=apps/web'],
					{ reject: false }
				);
				expect(stderr).toBe('');
			});
		});

		describe('--scope flag on main command', async ({ test }) => {
			test('shows scope info in help', async () => {
				const { aicommits } = await createFixture();
				const { stdout } = await aicommits(['--help'], {
					reject: false,
				});
				expect(stdout).toMatch(/scope/i);
			});
		});

		describe('--scope flag on split command', async ({ test }) => {
			test('shows scope info in help', async () => {
				const { aicommits } = await createFixture();
				const { stdout } = await aicommits(['split', '--help'], {
					reject: false,
				});
				expect(stdout).toMatch(/auto.*detect.*cwd|detect.*cwd.*auto/i);
			});
		});
	});
});
