/**
 * textUtils.js
 *
 * Utilities for normalizing line endings and ensuring trailing newline.
 * Small, well-tested helpers used by editor/formatting code.
 */

/**
 * Normalize line endings in a string.
 * mode: 'lf' | 'crlf' | 'auto'
 *  - 'lf'  -> \n
 *  - 'crlf' -> \r\n
 *  - 'auto' -> choose based on predominant line ending in content (defaults to '\n' if none)
 */
export function normalizeLineEndings(content, mode = 'lf') {
  if (typeof content !== 'string') return content;

  // Detect predominant endings if auto
  let target = '\n';
  if (mode === 'crlf') target = '\r\n';
  else if (mode === 'auto') {
    const crlfCount = (content.match(/\r\n/g) || []).length;
    // Count LF that are not part of CRLF
    const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
    target = crlfCount >= lfCount && crlfCount > 0 ? '\r\n' : '\n';
  }

  // Normalize all CRLF, CR, LF to target
  return content.replace(/\r\n|\r|\n/g, target);
}

/**
 * Ensure (or remove) trailing newline.
 * - If ensure === true: guarantees the content ends with a single '\n'
 *   (keeps CRLF if content predominantly CRLF via detect param).
 * - If ensure === false: removes trailing newline characters.
 */
export function ensureTrailingNewline(content, ensure = true, prefer = 'lf') {
  if (typeof content !== 'string') return content;

  // Normalize to chosen line ending first for consistent behaviour
  const normalized = normalizeLineEndings(content, prefer === 'crlf' ? 'crlf' : 'lf');

  if (ensure) {
    if (normalized.endsWith('\n') || normalized.endsWith('\r\n')) {
      // already has trailing newline (may be CRLF or LF)
      return normalized;
    }
    return normalized + (prefer === 'crlf' ? '\r\n' : '\n');
  } else {
    // remove any trailing CR/LF
    return normalized.replace(/(\r\n|\r|\n)+$/g, '');
  }
}

/**
 * Helper: compute simple size ratio of difference between two texts.
 * Returns fraction in [0,1] roughly representing how large newText differs from oldText.
 * Useful for heuristics (e.g., if > 0.6 then consider full-replace fallback).
 */
export function approximateChangeRatio(oldText = '', newText = '') {
  const oldLen = (oldText && oldText.length) || 0;
  const newLen = (newText && newText.length) || 0;
  if (oldLen === 0 && newLen === 0) return 0;
  const max = Math.max(oldLen, newLen, 1);
  // naive delta normalized
  return Math.abs(newLen - oldLen) / max;
}

/**
 * Small helper to trim and detect emptiness (useful in tests)
 */
export function isEmptyOrWhitespace(text) {
  return !text || /^\s*$/.test(text);
}