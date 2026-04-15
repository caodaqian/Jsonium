import { describe, expect, it } from 'vitest';
import { extractPathFromText, formatJqPath, formatJsonPath } from '../services/pathExtraction.js';

describe('pathExtraction', () => {
	it('formats simple token paths for jsonpath and jq', () => {
		const tokens = ['store', 'book', 0, 'title'];

		expect(formatJsonPath(tokens)).toBe('$.store.book[0].title');
		expect(formatJqPath(tokens)).toBe('.store.book[0].title');
	});

	it('formats bracket notation for complex keys', () => {
		const tokens = ['a-b', 0, 'x y'];

		expect(formatJsonPath(tokens)).toBe('$["a-b"][0]["x y"]');
		expect(formatJqPath(tokens)).toBe('.["a-b"][0]["x y"]');
	});

	it('extracts nested path from cursor position', () => {
		const text = '{"store":{"book":[{"title":"JS"}]}}';
		const offset = text.indexOf('JS');

		const result = extractPathFromText(text, { cursorOffset: offset });

		expect(result.success).toBe(true);
		expect(result.source).toBe('cursor');
		expect(result.jsonpath).toBe('$.store.book[0].title');
		expect(result.jq).toBe('.store.book[0].title');
		expect(result.nodeType).toBe('string');
	});

	it('prefers selection when it matches a node', () => {
		const text = '{"store":{"book":[{"title":"JS"}]}}';
		const selectionStart = text.indexOf('"JS"');
		const selectionEnd = selectionStart + '"JS"'.length;

		const result = extractPathFromText(text, {
			selectionStart,
			selectionEnd,
			cursorOffset: text.indexOf('store')
		});

		expect(result.success).toBe(true);
		expect(result.source).toBe('selection');
		expect(result.jsonpath).toBe('$.store.book[0].title');
	});

	it('falls back to cursor when selection covers the full document', () => {
		const text = '{"store":{"book":[{"title":"JS"}]}}';
		const selectionStart = 0;
		const selectionEnd = text.length;

		const result = extractPathFromText(text, {
			selectionStart,
			selectionEnd,
			cursorOffset: text.indexOf('JS')
		});

		expect(result.success).toBe(true);
		expect(result.source).toBe('cursor');
		expect(result.jsonpath).toBe('$.store.book[0].title');
		expect(result.jq).toBe('.store.book[0].title');
	});

	it('supports comments, single quotes, and trailing commas', () => {
		const text = `
    {
      // user record
      'user-name': {
        enabled: true,
      },
    }
    `;
		const offset = text.indexOf('true');

		const result = extractPathFromText(text, { cursorOffset: offset });

		expect(result.success).toBe(true);
		expect(result.jsonpath).toBe('$["user-name"].enabled');
		expect(result.jq).toBe('.["user-name"].enabled');
	});

	it('returns a readable error for empty input', () => {
		const result = extractPathFromText('', { cursorOffset: 0 });
		expect(result.success).toBe(false);
		expect(result.error).toBe('内容为空');
	});
});