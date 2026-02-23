/**
 * Unit tests for the VS Code extension's pure functions.
 * Uses Node's built-in test runner (node:test) — no VS Code runtime needed.
 *
 * Run: pnpm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── prompt.ts ──────────────────────────────────────────────────────────────

// Import compiled JS (tests run against the compiled output)
import { generatePrompt } from '../dist/prompt.js';

describe('generatePrompt', () => {
	it('includes locale in the prompt', () => {
		const prompt = generatePrompt('de', 72, 'plain');
		assert.ok(prompt.includes('Message language: de'), 'should include locale');
	});

	it('includes maxLength in the prompt', () => {
		const prompt = generatePrompt('en', 50, 'plain');
		assert.ok(prompt.includes('50 characters'), 'should mention maxLength');
	});

	it('includes conventional type instructions for conventional format', () => {
		const prompt = generatePrompt('en', 72, 'conventional');
		assert.ok(prompt.includes('"feat"'), 'should include feat type');
		assert.ok(prompt.includes('"fix"'), 'should include fix type');
		assert.ok(prompt.includes('"chore"'), 'should include chore type');
		assert.ok(prompt.includes('IMPORTANT: The type MUST be lowercase'), 'should warn about lowercase');
	});

	it('includes gitmoji emoji instructions for gitmoji format', () => {
		const prompt = generatePrompt('en', 72, 'gitmoji');
		assert.ok(prompt.includes('🐛'), 'should include bug emoji');
		assert.ok(prompt.includes('✨'), 'should include sparkle emoji');
	});

	it('does not include type instructions for plain format', () => {
		const prompt = generatePrompt('en', 72, 'plain');
		assert.ok(!prompt.includes('"feat"'), 'should not include conventional types');
		assert.ok(!prompt.includes('🐛'), 'should not include gitmoji');
	});

	it('includes custom prompt when provided', () => {
		const prompt = generatePrompt('en', 72, 'plain', 'Use British English.');
		assert.ok(prompt.includes('Use British English.'), 'should include custom prompt');
	});

	it('does not include undefined when no custom prompt', () => {
		const prompt = generatePrompt('en', 72, 'plain');
		assert.ok(!prompt.includes('undefined'), 'should not include undefined');
	});

	it('specifies the correct output format for conventional', () => {
		const prompt = generatePrompt('en', 72, 'conventional');
		assert.ok(prompt.includes('<type>'), 'should include conventional format template');
	});

	it('specifies the correct output format for gitmoji', () => {
		const prompt = generatePrompt('en', 72, 'gitmoji');
		assert.ok(prompt.includes(':emoji:'), 'should include gitmoji format template');
	});
});

// ── config.ts — parseIni ───────────────────────────────────────────────────

import { parseIni } from '../dist/ini.js';

describe('parseIni', () => {
	it('parses basic key=value pairs', () => {
		const result = parseIni('OPENAI_API_KEY=sk-test\nOPENAI_MODEL=gpt-4o');
		assert.equal(result['OPENAI_API_KEY'], 'sk-test');
		assert.equal(result['OPENAI_MODEL'], 'gpt-4o');
	});

	it('ignores comment lines starting with #', () => {
		const result = parseIni('# this is a comment\ntype=conventional');
		assert.equal(result['type'], 'conventional');
		assert.equal(Object.keys(result).length, 1);
	});

	it('ignores comment lines starting with ;', () => {
		const result = parseIni('; semicolon comment\nlocale=en');
		assert.equal(result['locale'], 'en');
		assert.equal(Object.keys(result).length, 1);
	});

	it('ignores section headers', () => {
		const result = parseIni('[section]\nkey=value');
		assert.equal(result['key'], 'value');
		assert.ok(!result['[section]'], 'should not include section header');
	});

	it('ignores empty lines', () => {
		const result = parseIni('\n\nkey=value\n\n');
		assert.equal(result['key'], 'value');
		assert.equal(Object.keys(result).length, 1);
	});

	it('handles values containing = signs', () => {
		const result = parseIni('OPENAI_BASE_URL=https://api.example.com/v1?foo=bar');
		assert.equal(result['OPENAI_BASE_URL'], 'https://api.example.com/v1?foo=bar');
	});

	it('trims whitespace around keys and values', () => {
		const result = parseIni('  key  =  value  ');
		assert.equal(result['key'], 'value');
	});

	it('returns empty object for empty input', () => {
		const result = parseIni('');
		assert.deepEqual(result, {});
	});

	it('parses a realistic aicommits config', () => {
		const config = `
# aicommits config
type=conventional
OPENAI_API_KEY=gho_abc123
OPENAI_BASE_URL=https://models.github.ai/inference
OPENAI_MODEL=openai/gpt-4.1
locale=en
max-length=72
post-commit=git push
auto-rebuild=prompt
`.trim();
		const result = parseIni(config);
		assert.equal(result['type'], 'conventional');
		assert.equal(result['OPENAI_API_KEY'], 'gho_abc123');
		assert.equal(result['OPENAI_BASE_URL'], 'https://models.github.ai/inference');
		assert.equal(result['OPENAI_MODEL'], 'openai/gpt-4.1');
		assert.equal(result['locale'], 'en');
		assert.equal(result['max-length'], '72');
		assert.equal(result['post-commit'], 'git push');
	});
});

// ── ai.ts — sanitizeMessage ────────────────────────────────────────────────

import { sanitizeMessage } from '../dist/ai.js';

describe('sanitizeMessage', () => {
	it('returns a clean commit message unchanged', () => {
		const result = sanitizeMessage('feat: add new feature');
		assert.equal(result, 'feat: add new feature');
	});

	it('strips surrounding double quotes', () => {
		assert.equal(sanitizeMessage('"feat: add feature"'), 'feat: add feature');
	});

	it('strips surrounding single quotes', () => {
		assert.equal(sanitizeMessage("'fix: resolve bug'"), 'fix: resolve bug');
	});

	it('strips surrounding backticks', () => {
		assert.equal(sanitizeMessage('`chore: update deps`'), 'chore: update deps');
	});

	it('takes only the first line', () => {
		const result = sanitizeMessage('feat: add feature\n\nSome body text here');
		assert.equal(result, 'feat: add feature');
	});

	it('removes trailing period from last word', () => {
		assert.equal(sanitizeMessage('feat: add feature.'), 'feat: add feature');
	});

	it('strips <think>...</think> reasoning blocks', () => {
		const msg = '<think>I need to think about this diff carefully.</think>\nfeat: add OAuth login';
		assert.equal(sanitizeMessage(msg), 'feat: add OAuth login');
	});

	it('strips multi-line <think> blocks', () => {
		const msg = '<think>\nReasoning...\nMore reasoning.\n</think>\nfix: handle null pointer';
		assert.equal(sanitizeMessage(msg), 'fix: handle null pointer');
	});

	it('strips leading XML-style tags', () => {
		assert.equal(sanitizeMessage('<response>feat: add feature</response>'), 'feat: add feature');
	});

	it('handles empty string', () => {
		assert.equal(sanitizeMessage(''), '');
	});

	it('trims surrounding whitespace', () => {
		assert.equal(sanitizeMessage('  feat: add feature  '), 'feat: add feature');
	});

	it('preserves colons inside the message', () => {
		assert.equal(sanitizeMessage('feat(auth): add JWT support'), 'feat(auth): add JWT support');
	});
});
