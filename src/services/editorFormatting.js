/**
 * Utilities for scheduling and running editor JSON formatting.
 *
 * Designed to be implementation-light so tests can mock the editor object.
 */

/**
 * Format a JSON string with 2-space indentation.
 * Throws on invalid JSON.
 * @param {string} content
 * @returns {string}
 */
import { approximateChangeRatio, ensureTrailingNewline, normalizeLineEndings } from '../utils/textUtils.js';
import { runWorkerTask } from './computeWorkerManager.js';

// When document sizes exceed this number of characters, heavy compute (diff/edits)
// will be offloaded to a WebWorker. Tunable constant; 100KB by default.
export const WORKER_OFFLOAD_CHARS = 100 * 1024;

export function formatJsonString(content) {
  const parsed = JSON.parse(content);
  return JSON.stringify(parsed, null, 2);
}

/**
 * Schedule an auto-format task, replacing any existing scheduled task.
 * Mutates scheduleState.timer and scheduleState.lastReason.
 *
 * @param {Object} scheduleState - plain object holding { timer, lastReason }
 * @param {'manual'|'idle'|'paste'|'external-sync'} reason
 * @param {number} delay - ms to wait before invoking callback
 * @param {(reason:string)=>void} callback
 * @returns {ReturnType<typeof setTimeout>}
 */
export function scheduleAutoFormat(scheduleState, reason, delay, callback) {
  if (!scheduleState || typeof callback !== 'function') {
    throw new Error('Invalid arguments to scheduleAutoFormat');
  }
  if (scheduleState.timer) {
    clearTimeout(scheduleState.timer);
  }
  scheduleState.lastReason = reason || null;
  scheduleState.timer = setTimeout(() => {
    scheduleState.timer = null;
    try {
      callback(reason);
    } catch (e) {
      // Swallow callback errors to avoid crashing scheduler
      // eslint-disable-next-line no-console
      console.error('scheduleAutoFormat callback error:', e);
    }
  }, Number(delay) || 0);
  return scheduleState.timer;
}

/**
 * Cancel any pending scheduled auto-format.
 * Ensures both timer and pending flag are cleared.
 * @param {Object} scheduleState
 */
export function cancelScheduledAutoFormat(scheduleState) {
  if (scheduleState && scheduleState.timer) {
    clearTimeout(scheduleState.timer);
    scheduleState.timer = null;
  }
  if (scheduleState) {
    scheduleState.pending = false;
  }
}

/**
 * Simplified auto-format scheduler.
 * - Single timer
 * - Sets scheduleState.pending while scheduled
 * - Safe to call repeatedly; returns timer id
 *
 * @param {Object} scheduleState - plain object holding { timer, lastReason, pending }
 * @param {'manual'|'idle'|'paste'|'external-sync'} reason
 * @param {number} delay - ms to wait before invoking callback
 * @param {(reason:string)=>void} callback
 * @returns {ReturnType<typeof setTimeout>}
 */
export function scheduleAutoFormatSimple(scheduleState, reason, delay, callback) {
  if (!scheduleState || typeof callback !== 'function') {
    throw new Error('Invalid arguments to scheduleAutoFormatSimple');
  }
  // Cancel existing timer
  if (scheduleState.timer) {
    clearTimeout(scheduleState.timer);
  }
  scheduleState.lastReason = reason || null;
  scheduleState.pending = true;
  scheduleState.timer = setTimeout(() => {
    scheduleState.timer = null;
    scheduleState.pending = false;
    try {
      callback(reason);
    } catch (e) {
      // Swallow callback errors to avoid crashing scheduler
      // eslint-disable-next-line no-console
      console.error('scheduleAutoFormatSimple callback error:', e);
    }
  }, Number(delay) || 0);
  return scheduleState.timer;
}

/**
 * Compute minimal text edits between oldText and newText using a line-level diff.
 *
 * Returns an array of { range, text } objects compatible with Monaco TextEdit.
 * The `range` uses 1-based line/column numbers as Monaco expects.
 *
 * @param {string} oldText
 * @param {string} newText
 * @param {object} monacoInstance - the monaco-editor module (needs monaco.Range)
 * @returns {Array<{range: object, text: string}>}
 */
export function computeMinimalEdits(oldText, newText, monacoInstance) {
  // Fast path
  if (oldText === newText) return [];

  // Normalize line endings to avoid CRLF/LF mismatches affecting diffs.
  const oldNorm = normalizeLineEndings(oldText, 'auto');
  const newNorm = normalizeLineEndings(newText, 'auto');

  // Ensure both have consistent trailing newline handling for accurate line counts
  const oldHasTrailing = /\r?\n$/.test(oldNorm);
  const newHasTrailing = /\r?\n$/.test(newNorm);
  const oldFinal = oldHasTrailing ? oldNorm : ensureTrailingNewline(oldNorm, false);
  const newFinal = newHasTrailing ? newNorm : ensureTrailingNewline(newNorm, false);

  const oldLines = oldFinal.split(/\r\n|\n/);
  const newLines = newFinal.split(/\r\n|\n/);

  // Heuristic: if the change ratio is large, prefer full-replace to avoid expensive/fragile edits
  const changeRatio = approximateChangeRatio(oldFinal, newFinal);
  const FULL_REPLACE_THRESHOLD = 0.6;

  if (changeRatio >= FULL_REPLACE_THRESHOLD) {
    // Full replace range for entire document
    const endLine = oldLines.length || 1;
    const endCol = (oldLines[oldLines.length - 1] ? oldLines[oldLines.length - 1].length + 1 : 1);
    const range = _createRange(monacoInstance, 1, 1, endLine, endCol);
    return [{ range, text: newFinal }];
  }

  // Find common prefix lines
  let prefixLen = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix lines (not overlapping with prefix)
  let suffixLen = 0;
  while (
    suffixLen < (minLen - prefixLen) &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldDiffStart = prefixLen;
  const oldDiffEnd = oldLines.length - suffixLen; // exclusive
  const newDiffStart = prefixLen;
  const newDiffEnd = newLines.length - suffixLen; // exclusive

  // No-op guard
  if (oldDiffStart >= oldDiffEnd && newDiffStart >= newDiffEnd) {
    return [];
  }

  const replacementLines = newLines.slice(newDiffStart, newDiffEnd);
  const replacementText = replacementLines.join('\n');

  const edits = [];

  // Monaco Range is 1-based: Range(startLineNumber, startColumn, endLineNumber, endColumn)
  const startLine = oldDiffStart + 1; // 1-based

  if (oldDiffStart >= oldDiffEnd) {
    // Pure insertion
    if (oldDiffStart > 0) {
      const prevLineLen = oldLines[oldDiffStart - 1].length;
      const range = _createRange(monacoInstance, oldDiffStart, prevLineLen + 1, oldDiffStart, prevLineLen + 1);
      edits.push({ range, text: '\n' + replacementText });
    } else {
      const range = _createRange(monacoInstance, 1, 1, 1, 1);
      edits.push({ range, text: replacementText + '\n' });
    }
  } else if (newDiffStart >= newDiffEnd) {
    // Pure deletion
    const endLine = oldDiffEnd;
    const endCol = oldLines[oldDiffEnd - 1] ? oldLines[oldDiffEnd - 1].length + 1 : 1;

    if (oldDiffStart > 0) {
      const prevLineLen = oldLines[oldDiffStart - 1].length;
      const range = _createRange(monacoInstance, oldDiffStart, prevLineLen + 1, endLine, endCol);
      edits.push({ range, text: '' });
    } else if (oldDiffEnd < oldLines.length) {
      const range = _createRange(monacoInstance, 1, 1, oldDiffEnd + 1, 1);
      edits.push({ range, text: '' });
    } else {
      const range = _createRange(monacoInstance, 1, 1, endLine, endCol);
      edits.push({ range, text: '' });
    }
  } else {
    // Replacement
    const endLine = oldDiffEnd;
    const endCol = oldLines[oldDiffEnd - 1] ? oldLines[oldDiffEnd - 1].length + 1 : 1;
    const range = _createRange(monacoInstance, startLine, 1, endLine, endCol);
    edits.push({ range, text: replacementText });
  }

  return edits;
}

/**
 * Async worker-backed version of computeMinimalEdits.
 * Falls back to synchronous computeMinimalEdits if worker task fails.
 * Returns an array of edits where `range` is either a Monaco Range (if monacoInstance provided)
 * or a plain numeric range object with { startLineNumber, startColumn, endLineNumber, endColumn }.
 */
export async function computeMinimalEditsAsync(oldText, newText, monacoInstance = null) {
  try {
    const result = await runWorkerTask('computeMinimalEdits', { oldText: oldText || '', newText: newText || '' }, { timeout: 30000 });
    // Convert numeric ranges to Monaco Range if requested
    if (Array.isArray(result)) {
      return result.map((e) => {
        const r = e.range || {};
        if (monacoInstance && monacoInstance.Range) {
          return { range: new monacoInstance.Range(r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn), text: e.text };
        }
        return { range: { startLineNumber: r.startLineNumber, startColumn: r.startColumn, endLineNumber: r.endLineNumber, endColumn: r.endColumn }, text: e.text };
      });
    }
  } catch (e) {
    // ignore and fallback to synchronous compute
  }
  // synchronous fallback
  return computeMinimalEdits(oldText, newText, monacoInstance);
}

/**
 * Helper: create a range using Monaco's Range constructor or a plain object fallback.
 */
function _createRange(monacoInstance, startLine, startCol, endLine, endCol) {
  if (monacoInstance && monacoInstance.Range) {
    return new monacoInstance.Range(startLine, startCol, endLine, endCol);
  }
  // Plain object fallback (for testing without real Monaco)
  return {
    startLineNumber: startLine,
    startColumn: startCol,
    endLineNumber: endLine,
    endColumn: endCol,
  };
}

/**
 * Module-level flag to prevent duplicate provider registration.
 */
let _providerRegistered = false;
let _providerDisposable = null;

/**
 * Register a DocumentFormattingEditProvider for JSON that uses incremental edits.
 * Safe to call multiple times; only registers once.
 *
 * @param {object} monacoInstance - the monaco-editor module
 * @returns {object|null} IDisposable or null if already registered
 */
export function registerJsonFormattingProvider(monacoInstance) {
  if (_providerRegistered) return null;
  if (!monacoInstance || !monacoInstance.languages || typeof monacoInstance.languages.registerDocumentFormattingEditProvider !== 'function') {
    return null;
  }

  _providerDisposable = monacoInstance.languages.registerDocumentFormattingEditProvider('json', {
    provideDocumentFormattingEdits(model, options, token) {
      const oldText = model.getValue();
      let newText;
      try {
        newText = formatJsonString(oldText);
      } catch (e) {
        // Invalid JSON — return empty edits (no-op)
        return [];
      }
      if (newText === oldText) return [];
      return computeMinimalEdits(oldText, newText, monacoInstance);
    }
  });

  _providerRegistered = true;
  return _providerDisposable;
}

/**
 * Reset provider registration state (for testing only).
 */
export function _resetProviderRegistration() {
  if (_providerDisposable && typeof _providerDisposable.dispose === 'function') {
    _providerDisposable.dispose();
  }
  _providerRegistered = false;
  _providerDisposable = null;
}

/**
 * Run the editor format pipeline.
 *
 * Priority:
 * 1. Try Monaco's native action: editor.getAction('editor.action.formatDocument').run()
 *    (When registerJsonFormattingProvider is registered, this will use incremental edits.)
 * 2. If not available and allowFallback, compute minimal edits and apply via pushEditOperations.
 *
 * The editor argument is an adapter (can be mocked in tests). Preferred editor surface:
 * - editor.getAction(name) -> { run: fn }
 * - editor.getValue() -> string
 * - editor.getModel() -> model (optional)
 *
 * Returns an object describing the outcome.
 *
 * @param {any} editor
 * @param {{ fallbackFormatter?: (content:string)=>string, reason?:string, allowFallback?:boolean, monacoInstance?: object }} options
 * @returns {Promise<{status:string,method?:string}>}
 */
export async function runEditorFormat(editor, { fallbackFormatter, reason = 'manual', allowFallback = true, monacoInstance = null, actionTimeoutMs = 3000 } = {}) {
  let timedOut = false;

  // Try Monaco action first with timeout.
  // NOTE: skip Monaco's built-in format action for JSON documents because it may trigger
  // worker loadForeignModule behavior in some bundling setups. Prefer the registered
  // provider or our fallback incremental edits for JSON.
  try {
    const model = editor && typeof editor.getModel === 'function' ? editor.getModel() : null;
    const lang = model && typeof model.getLanguageId === 'function'
      ? model.getLanguageId()
      : (model && model.language) || null;

    if (lang !== 'json') {
      if (editor && typeof editor.getAction === 'function') {
        const action = editor.getAction('editor.action.formatDocument');
        if (action && typeof action.run === 'function') {
          await Promise.race([
            action.run(),
            new Promise((_, reject) => setTimeout(() => {
              timedOut = true;
              reject(new Error('monaco-action-timeout'));
            }, Number(actionTimeoutMs))
          )]);
          return { status: 'applied', method: 'monaco' };
        }
      }
    } else {
      // For JSON, avoid calling the Monaco action to prevent worker attempting to load foreign modules.
      // Fall through to fallback logic below which uses our safe provider / incremental edits.
    }
  } catch (e) {
    // If Monaco action throws or times out, fall through to fallback
    // eslint-disable-next-line no-console
    console.warn('Monaco format action failed or timed out, falling back:', e);
  }

  // Fallback: compute minimal edits and apply via pushEditOperations
  if (!allowFallback || typeof fallbackFormatter !== 'function') {
    return { status: 'no-action', timedOut };
  }

  const getValue = editor && typeof editor.getValue === 'function' ? editor.getValue.bind(editor) : null;
  if (!getValue) {
    throw new Error('Editor does not expose getValue(); cannot perform fallback formatting');
  }
  const content = getValue();

  let formatted;
  try {
    formatted = fallbackFormatter(content);
  } catch (e) {
    return { status: 'no-action', timedOut };
  }

  if (formatted === content) {
    return { status: 'no-op', method: 'fallback', timedOut };
  }

  // Try to apply via incremental edits using pushEditOperations
  const model = editor && typeof editor.getModel === 'function' ? editor.getModel() : null;
  if (model && typeof model.pushEditOperations === 'function' && monacoInstance) {
    try {
      const edits = computeMinimalEdits(content, formatted, monacoInstance);
      if (edits.length > 0) {
        const selections = (typeof editor.getSelections === 'function' ? editor.getSelections() : null) || [];
        model.pushEditOperations(
          selections,
          edits,
          () => null // let Monaco compute cursor positions from the edits
        );
      }
      return { status: 'applied', method: 'fallback', timedOut };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Fallback incremental edit failed:', e);
    }
  }

  // Last resort: try executeEdits (still incremental, not setValue)
  if (model && typeof model.getFullModelRange === 'function' && typeof editor.executeEdits === 'function' && monacoInstance) {
    try {
      const edits = computeMinimalEdits(content, formatted, monacoInstance);
      if (edits.length > 0) {
        // Editor.executeEdits expects edits in a slightly different shape in some adapters,
        // but the original code used this path so keep compatibility.
        editor.executeEdits('formatter', edits);
      }
      return { status: 'applied', method: 'fallback', timedOut };
    } catch (e) {
      // fall through
    }
  }

  return { status: 'no-action', timedOut };
}
