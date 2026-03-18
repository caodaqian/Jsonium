import { describe, it, expect } from 'vitest';
import { normalizeLineEndings, ensureTrailingNewline, approximateChangeRatio, isEmptyOrWhitespace } from '../utils/textUtils.js';

describe('textUtils', () => {
  it('normalizeLineEndings respects auto detection', () => {
    const crlf = 'a\r\nb\r\nc';
    const lf = 'a\nb\nc';
    expect(normalizeLineEndings(crlf, 'auto')).toBe(crlf);
    expect(normalizeLineEndings(lf, 'auto')).toBe(lf);
    expect(normalizeLineEndings(crlf, 'lf')).toBe('a\nb\nc');
    expect(normalizeLineEndings(lf, 'crlf')).toBe('a\r\nb\r\nc');
  });

  it('ensureTrailingNewline adds or removes newline correctly', () => {
    expect(ensureTrailingNewline('a\n', true)).toBe('a\n');
    expect(ensureTrailingNewline('a', true)).toBe('a\n');
    expect(ensureTrailingNewline('a\n\n', false)).toBe('a');
  });

  it('approximateChangeRatio returns 0..1', () => {
    expect(approximateChangeRatio('', '')).toBe(0);
    expect(approximateChangeRatio('a', 'aa')).toBeGreaterThan(0);
    expect(approximateChangeRatio('a'.repeat(100), 'a'.repeat(10))).toBeLessThanOrEqual(1);
  });

  it('isEmptyOrWhitespace detects emptiness', () => {
    expect(isEmptyOrWhitespace('  ')).toBe(true);
    expect(isEmptyOrWhitespace('x')).toBe(false);
  });
});