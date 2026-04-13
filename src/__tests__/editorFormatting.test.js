import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetProviderRegistration,
  cancelScheduledAutoFormat,
  computeMinimalEdits,
  formatJsonString,
  registerJsonFormattingProvider,
  runEditorFormat,
  scheduleAutoFormat
} from '../services/editorFormatting.js';
import { getStringifyIndent } from '../utils/indent.js';

describe('editorFormatting utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('scheduleAutoFormat replaces previous timer and invokes callback once', () => {
    const state = { timer: null, lastReason: null };
    const cb = vi.fn();

    scheduleAutoFormat(state, 'idle', 100, cb);
    // schedule another which should clear previous
    scheduleAutoFormat(state, 'idle', 50, cb);

    // advance only 60ms => second should fire
    vi.advanceTimersByTime(60);
    expect(cb).toHaveBeenCalledTimes(1);
    // ensure lastReason updated
    expect(state.lastReason).toBe('idle');
  });

  it('cancelScheduledAutoFormat clears pending timer', () => {
    const state = { timer: null, lastReason: null };
    const cb = vi.fn();
    scheduleAutoFormat(state, 'idle', 100, cb);
    cancelScheduledAutoFormat(state);
    vi.advanceTimersByTime(200);
    expect(cb).not.toHaveBeenCalled();
    expect(state.timer).toBeNull();
  });

  it('runEditorFormat uses Monaco action when available', async () => {
    const runSpy = vi.fn(() => Promise.resolve());
    const mockEditor = {
      getAction: vi.fn(() => ({ run: runSpy }))
    };

    const res = await runEditorFormat(mockEditor, { fallbackFormatter: (s) => s });
    expect(mockEditor.getAction).toHaveBeenCalledWith('editor.action.formatDocument');
    expect(runSpy).toHaveBeenCalled();
    expect(res).toEqual({ status: 'applied', method: 'monaco' });
  });

  it('runEditorFormat falls back to incremental edits via pushEditOperations', async () => {
    const original = '{"a":1}';
    const formatted = '{\n  "a": 1\n}';
    const pushSpy = vi.fn();
    const mockModel = {
      pushEditOperations: pushSpy,
      getValue: vi.fn(() => original)
    };
    const mockEditor = {
      getAction: vi.fn(() => null),
      getValue: vi.fn(() => original),
      getModel: vi.fn(() => mockModel),
      getSelections: vi.fn(() => [])
    };
    // Provide a mock monacoInstance with no Range constructor (uses plain object fallback)
    const mockMonaco = {};

    const res = await runEditorFormat(mockEditor, {
      fallbackFormatter: (c) => formatted,
      reason: 'manual',
      allowFallback: true,
      monacoInstance: mockMonaco
    });
    expect(pushSpy).toHaveBeenCalled();
    expect(res.status).toBe('applied');
    expect(res.method).toBe('fallback');
  });

  it('runEditorFormat returns no-op when fallback produces identical content', async () => {
    const content = '{ "a": 1 }';
    const mockEditor = {
      getAction: vi.fn(() => null),
      getValue: vi.fn(() => content)
    };

    const res = await runEditorFormat(mockEditor, { fallbackFormatter: (c) => content, allowFallback: true });
    expect(res.status).toBe('no-op');
  });

  it('formatJsonString pretty-prints JSON and throws on invalid JSON', () => {
    const src = '{"b":2,"a":1}';
    expect(formatJsonString(src)).toBe(JSON.stringify(JSON.parse(src), null, getStringifyIndent()));
    expect(() => formatJsonString('not-json')).toThrow();
  });

  it('runEditorFormat uses executeEdits as last resort when pushEditOperations unavailable', async () => {
    const original = '{"x":1}';
    const formatted = '{\n  "x": 1\n}';
    const mockModel = {
      getFullModelRange: vi.fn(() => ({ start: 0, end: 1 }))
    };
    const execSpy = vi.fn();
    const mockEditor = {
      getAction: vi.fn(() => null),
      getValue: vi.fn(() => original),
      getModel: vi.fn(() => mockModel),
      executeEdits: execSpy
    };
    const mockMonaco = {};

    const res = await runEditorFormat(mockEditor, {
      fallbackFormatter: (c) => formatted,
      allowFallback: true,
      monacoInstance: mockMonaco
    });
    expect(execSpy).toHaveBeenCalled();
    expect(res.status).toBe('applied');
    expect(res.method).toBe('fallback');
  });

  it('runEditorFormat returns no-action when fallbackFormatter throws', async () => {
    const mockEditor = {
      getAction: vi.fn(() => null),
      getValue: vi.fn(() => 'invalid json')
    };

    const res = await runEditorFormat(mockEditor, {
      fallbackFormatter: (c) => { throw new Error('parse error'); },
      allowFallback: true
    });
    expect(res.status).toBe('no-action');
  });
});

describe('computeMinimalEdits', () => {
  // Helper: create a mock monaco instance with no Range constructor
  const mockMonaco = {};

  it('returns empty array for identical texts', () => {
    const text = '{\n  "a": 1\n}';
    expect(computeMinimalEdits(text, text, mockMonaco)).toEqual([]);
  });

  it('returns minimal edit for whitespace-only changes (formatting)', () => {
    const oldText = '{"a":1}';
    const newText = '{\n  "a": 1\n}';
    const edits = computeMinimalEdits(oldText, newText, mockMonaco);
    expect(edits.length).toBeGreaterThan(0);
    // The edit should replace the single old line with the new formatted lines
    expect(edits[0]).toHaveProperty('range');
    expect(edits[0]).toHaveProperty('text');
  });

  it('generates fewer edits than total lines for partial changes', () => {
    const oldText = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}';
    const newText = '{\n  "a": 1,\n  "b": 99,\n  "c": 3\n}';
    const edits = computeMinimalEdits(oldText, newText, mockMonaco);
    expect(edits.length).toBe(1);
    expect(edits[0].text).toBe('  "b": 99,');
  });

  it('handles pure insertion (new lines added)', () => {
    const oldText = '{\n  "a": 1\n}';
    const newText = '{\n  "a": 1,\n  "b": 2\n}';
    const edits = computeMinimalEdits(oldText, newText, mockMonaco);
    expect(edits.length).toBeGreaterThan(0);
  });

  it('handles pure deletion (lines removed)', () => {
    const oldText = '{\n  "a": 1,\n  "b": 2\n}';
    const newText = '{\n  "a": 1\n}';
    const edits = computeMinimalEdits(oldText, newText, mockMonaco);
    expect(edits.length).toBeGreaterThan(0);
  });

  it('handles empty old text', () => {
    const edits = computeMinimalEdits('', '{"a": 1}', mockMonaco);
    expect(edits.length).toBeGreaterThan(0);
  });

  it('handles empty new text', () => {
    const edits = computeMinimalEdits('{"a": 1}', '', mockMonaco);
    expect(edits.length).toBeGreaterThan(0);
  });

  it('uses monaco.Range constructor when available', () => {
    const mockRange = vi.fn(function(sl, sc, el, ec) {
      this.startLineNumber = sl;
      this.startColumn = sc;
      this.endLineNumber = el;
      this.endColumn = ec;
    });
    const monacoWithRange = { Range: mockRange };
    const edits = computeMinimalEdits('{"a":1}', '{\n  "a": 1\n}', monacoWithRange);
    expect(edits.length).toBeGreaterThan(0);
    expect(mockRange).toHaveBeenCalled();
  });
});

describe('registerJsonFormattingProvider', () => {
  afterEach(() => {
    _resetProviderRegistration();
  });

  it('calls registerDocumentFormattingEditProvider on first call', () => {
    const disposable = { dispose: vi.fn() };
    const registerSpy = vi.fn(() => disposable);
    const mockMonaco = {
      languages: {
        registerDocumentFormattingEditProvider: registerSpy
      }
    };

    const result = registerJsonFormattingProvider(mockMonaco);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy).toHaveBeenCalledWith('json', expect.objectContaining({
      provideDocumentFormattingEdits: expect.any(Function)
    }));
    expect(result).toBe(disposable);
  });

  it('returns null on second call (already registered)', () => {
    const disposable = { dispose: vi.fn() };
    const registerSpy = vi.fn(() => disposable);
    const mockMonaco = {
      languages: {
        registerDocumentFormattingEditProvider: registerSpy
      }
    };

    registerJsonFormattingProvider(mockMonaco);
    const result2 = registerJsonFormattingProvider(mockMonaco);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(result2).toBeNull();
  });

  it('provider returns correct TextEdits for valid JSON', () => {
    let capturedProvider;
    const registerSpy = vi.fn((lang, provider) => {
      capturedProvider = provider;
      return { dispose: vi.fn() };
    });
    const mockMonaco = {
      languages: { registerDocumentFormattingEditProvider: registerSpy }
    };

    registerJsonFormattingProvider(mockMonaco);

    // Simulate a model
    const mockModel = {
      getValue: () => '{"a":1,"b":2}'
    };

    const edits = capturedProvider.provideDocumentFormattingEdits(mockModel, {}, {});
    expect(edits.length).toBeGreaterThan(0);
    // The replacement text should be the formatted version
    const formatted = formatJsonString('{"a":1,"b":2}');
    // Verify the edit text contains formatted content
    const allEditText = edits.map(e => e.text).join('');
    expect(formatted).toContain(allEditText.trim() || allEditText);
  });

  it('provider returns empty array for invalid JSON', () => {
    let capturedProvider;
    const registerSpy = vi.fn((lang, provider) => {
      capturedProvider = provider;
      return { dispose: vi.fn() };
    });
    const mockMonaco = {
      languages: { registerDocumentFormattingEditProvider: registerSpy }
    };

    registerJsonFormattingProvider(mockMonaco);

    const mockModel = {
      getValue: () => 'not valid json'
    };

    const edits = capturedProvider.provideDocumentFormattingEdits(mockModel, {}, {});
    expect(edits).toEqual([]);
  });

  it('provider returns empty array when content is already formatted', () => {
    let capturedProvider;
    const registerSpy = vi.fn((lang, provider) => {
      capturedProvider = provider;
      return { dispose: vi.fn() };
    });
    const mockMonaco = {
      languages: { registerDocumentFormattingEditProvider: registerSpy }
    };

    registerJsonFormattingProvider(mockMonaco);

    const alreadyFormatted = '{\n  "a": 1\n}';
    const mockModel = {
      getValue: () => alreadyFormatted
    };

    const edits = capturedProvider.provideDocumentFormattingEdits(mockModel, {}, {});
    expect(edits).toEqual([]);
  });
});