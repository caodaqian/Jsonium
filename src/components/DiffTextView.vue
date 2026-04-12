<script setup>
import { diffWordsWithSpace } from 'diff';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { buildLineDiffs, buildLineDiffsAsync } from '../services/diffEngine.js';
import { WORKER_OFFLOAD_CHARS } from '../services/editorFormatting.js';
import { useJsonStore } from '../store/index.js';
let monaco = null;

const props = defineProps({
  left: { type: String, default: '' },
  right: { type: String, default: '' },
  language: { type: String, default: 'json' },
  options: { type: Object, default: () => ({}) }
});

const editorContainer = ref(null);
const store = useJsonStore();
let diffEditor = null;
let leftModel = null;
let rightModel = null;
const monacoAvailable = ref(false);
const monacoLoadError = ref('');
const monacoLoading = ref(true);
let themeAppliedHandler = null;
let themeRefreshRaf = null;

// When foldRanges is called before Monaco is ready, cache the ranges and
// apply them once Monaco becomes available.
const pendingFoldRanges = ref([]);

function getJsoniumThemeVars(mode = 'light') {
  try {
    const computedStyle = typeof window !== 'undefined' ? window.getComputedStyle(document.documentElement) : null;
    if (!computedStyle) {
      return {
        bg: mode === 'dark' ? '#24273a' : '#ffffff',
        fg: mode === 'dark' ? '#cad3f5' : '#1f2937'
      };
    }
    return {
      bg: computedStyle.getPropertyValue('--color-bg-primary')?.trim() || (mode === 'dark' ? '#24273a' : '#ffffff'),
      fg: computedStyle.getPropertyValue('--color-text-primary')?.trim() || (mode === 'dark' ? '#cad3f5' : '#1f2937')
    };
  } catch (e) {
    return {
      bg: mode === 'dark' ? '#24273a' : '#ffffff',
      fg: mode === 'dark' ? '#cad3f5' : '#1f2937'
    };
  }
}

function getCurrentThemeMode() {
  try {
    const effectiveTheme = store.getEffectiveTheme ? store.getEffectiveTheme() : null;
    return effectiveTheme?.mode === 'dark' ? 'dark' : 'light';
  } catch (e) {
    return 'light';
  }
}

function defineAndSetMonacoTheme() {
  if (!monaco || !monaco.editor) return;
  const mode = getCurrentThemeMode();
  const { bg, fg } = getJsoniumThemeVars(mode);
  try {
    if (mode === 'light') {
      monaco.editor.defineTheme('jsonium-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': bg,
          'editor.foreground': fg
        }
      });
      monaco.editor.setTheme('jsonium-light');
    } else {
      monaco.editor.defineTheme('jsonium-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': bg,
          'editor.foreground': fg
        }
      });
      monaco.editor.setTheme('jsonium-dark');
    }
  } catch (e) {
    try { monaco.editor.setTheme(mode === 'light' ? 'vs' : 'vs-dark'); } catch (_) {}
  }
}

function applyCurrentTheme() {
  defineAndSetMonacoTheme();
}

function installThemeRefreshListener() {
  if (themeAppliedHandler || typeof window === 'undefined') return;
  themeAppliedHandler = () => {
    try {
      if (themeRefreshRaf && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(themeRefreshRaf);
      }
    } catch (e) {}
    try {
      if (typeof window.requestAnimationFrame === 'function') {
        themeRefreshRaf = window.requestAnimationFrame(() => {
          themeRefreshRaf = null;
          applyCurrentTheme();
        });
      } else {
        themeRefreshRaf = setTimeout(() => {
          themeRefreshRaf = null;
          applyCurrentTheme();
        }, 0);
      }
    } catch (e) {
      applyCurrentTheme();
    }
  };
  try {
    window.addEventListener('jsonium-theme-applied', themeAppliedHandler);
  } catch (e) {}
}

onMounted(async () => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITEST) {
      monaco = null;
      initDiffEditor();
      return;
    }
    if (typeof window === 'undefined') {
      monaco = null;
      initDiffEditor();
      return;
    }

    // 尽早注入 MonacoEnvironment.getWorker，保证 Worker 使用 ESM 路径，避免 loadForeignModule/Unexpected usage
      try {
      // preserve any existing helpers before overriding to avoid recursion
      const existingEnv = window.MonacoEnvironment || {};
      const savedGetWorker = existingEnv.getWorker;
      const savedGetWorkerUrl = existingEnv.getWorkerUrl;
      window.MonacoEnvironment = existingEnv;
      window.MonacoEnvironment.getWorker = function (moduleId, label) {
        try { console.debug('[DiffTextView] MonacoEnvironment.getWorker called', { moduleId, label }); } catch (_) {}
        try {
          // prefer saved helpers if they existed prior to our override
          if (typeof savedGetWorkerUrl === 'function') {
            try {
              const url = savedGetWorkerUrl(moduleId, label);
              try { console.debug('[DiffTextView] getWorker using savedGetWorkerUrl', { url, moduleId, label }); } catch (_) {}
              return new Worker(url);
            } catch (e) {
              // fallthrough
              try { console.debug('[DiffTextView] savedGetWorkerUrl failed', e && e.message); } catch (_) {}
            }
          }
          if (typeof savedGetWorker === 'function') {
            try { return savedGetWorker(moduleId, label); } catch (e) { try { console.debug('[DiffTextView] savedGetWorker failed', e && e.message); } catch (_) {} }
          }
        } catch (_) { /* ignore */ }

        const makeUrl = (p) => {
          try {
            if (typeof location !== 'undefined' && typeof p === 'string' && p.charAt(0) === '/') return new URL(p, location.origin).toString();
            return p;
          } catch (_) { return p; }
        };
        // absolute node_modules paths to ensure Vite serves worker files in dev
        const jsonPath = '/node_modules/monaco-editor/esm/vs/language/json/json.worker.js';
        const editorPath = '/node_modules/monaco-editor/esm/vs/editor/editor.worker.js';

        try {
          if (label === 'json') {
            try { console.debug('[DiffTextView] creating module worker for json', { url: jsonPath }); } catch(_) {}
            try {
              const w = new Worker(jsonPath, { type: 'module' });
              try { if (w && typeof w.addEventListener === 'function') { w.addEventListener('error', (ev) => { try { console.error('[DiffTextView] worker error event', ev && ev.message ? ev.message : ev); } catch(_){} }); w.addEventListener('messageerror', (ev) => { try { console.error('[DiffTextView] worker messageerror', ev); } catch(_){} }); } } catch(_){}
              return w;
            } catch (e) { throw e; }
          }
          try { console.debug('[DiffTextView] creating module worker for editor', { url: editorPath }); } catch(_) {}
          try {
            const w = new Worker(editorPath, { type: 'module' });
            try { if (w && typeof w.addEventListener === 'function') { w.addEventListener('error', (ev) => { try { console.error('[DiffTextView] worker error event', ev && ev.message ? ev.message : ev); } catch(_){} }); w.addEventListener('messageerror', (ev) => { try { console.error('[DiffTextView] worker messageerror', ev); } catch(_){} }); } } catch(_){}
            return w;
          } catch (e) { throw e; }
        } catch (err) {
          try { console.error('[DiffTextView] module worker creation error', err && err.message ? err.message : err); } catch (_) {}
          try { console.debug('[DiffTextView] module worker creation stack', err && err.stack ? err.stack : 'no-stack'); } catch (_) {}
          // fallback: try creating a module worker from a blob that imports the real worker module
          try {
            const url = label === 'json' ? makeUrl(jsonPath) : makeUrl(editorPath);
            try { console.debug('[DiffTextView] module worker failed, falling back to blob import', { url, label }); } catch(_) {}
            const blob = new Blob([`import("${url}");`], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            try {
              try { console.debug('[DiffTextView] creating blob module worker', { blobUrl }); } catch(_) {}
              const w = new Worker(blobUrl, { type: 'module' });
              try { if (w && typeof w.addEventListener === 'function') { w.addEventListener('error', (ev) => { try { console.error('[DiffTextView] worker error event', ev && ev.message ? ev.message : ev); } catch(_){} }); w.addEventListener('messageerror', (ev) => { try { console.error('[DiffTextView] worker messageerror', ev); } catch(_){} }); } } catch(_){}
              try { URL.revokeObjectURL(blobUrl); } catch (e) { }
              return w;
            } catch (errWorker) {
              try { console.error('[DiffTextView] blob module worker creation error', errWorker && errWorker.message ? errWorker.message : errWorker); } catch (_) {}
              try { console.debug('[DiffTextView] blob module worker creation stack', errWorker && errWorker.stack ? errWorker.stack : 'no-stack'); } catch (_) {}
              try { URL.revokeObjectURL(blobUrl); } catch (e) { }
              throw errWorker;
            }
          } catch (e) {
            // last resort: classic worker using importScripts (may or may not work depending on packaging)
            try {
              try { console.debug('[DiffTextView] blob module failed, trying importScripts worker', { url: (label === 'json' ? jsonPath : editorPath), label }); } catch(_) {}
              const url = label === 'json' ? makeUrl(jsonPath) : makeUrl(editorPath);
              const blob = new Blob([`self.importScripts("${url}");`], { type: 'application/javascript' });
              const b = URL.createObjectURL(blob);
              try {
                try { console.debug('[DiffTextView] creating importScripts worker', { blobUrl: b }); } catch(_) {}
                const w2 = new Worker(b);
                try { if (w2 && typeof w2.addEventListener === 'function') { w2.addEventListener('error', (ev) => { try { console.error('[DiffTextView] worker error event', ev && ev.message ? ev.message : ev); } catch(_){} }); w2.addEventListener('messageerror', (ev) => { try { console.error('[DiffTextView] worker messageerror', ev); } catch(_){} }); } } catch(_){}
                try { URL.revokeObjectURL(b); } catch (e) { }
                return w2;
              } catch (errWorker2) {
                try { console.error('[DiffTextView] importScripts worker creation error', errWorker2 && errWorker2.message ? errWorker2.message : errWorker2); } catch (_) {}
                try { console.debug('[DiffTextView] importScripts worker creation stack', errWorker2 && errWorker2.stack ? errWorker2.stack : 'no-stack'); } catch (_) {}
                try { URL.revokeObjectURL(b); } catch (e) { }
                throw errWorker2;
              }
            } catch (e2) {
            try { console.error('[DiffTextView] importScripts fallback error', e2 && e2.message ? e2.message : e2); } catch (_) {}
            try { console.debug('[DiffTextView] importScripts fallback stack', e2 && e2.stack ? e2.stack : 'no-stack'); } catch (_) {}
              throw err;
            }
          }
        }
      };
    } catch (e) {
      // ignore injection failure
    }

    // 动态导入 Monaco ESM 入口（使用更直接的导入路径以提高 Vite 开发模式的稳定性）
    try {
      try { await import('monaco-editor/min/vs/editor/editor.main.css'); } catch (_) { /* ignore */ }
      try {
        const m = await import('monaco-editor/esm/vs/editor/editor.api');
        if (m && typeof m === 'object') {
          if (m.default && m.default.editor) monaco = m.default;
          else if (m.editor) monaco = m;
          else monaco = (typeof window !== 'undefined' ? window.monaco : null);
        } else {
          monaco = (typeof window !== 'undefined' ? window.monaco : null);
        }
        try { if (monaco && typeof window !== 'undefined' && !window.monaco) window.monaco = monaco; } catch (_) {}
      } catch (e) {
        try {
          const m2 = await import('monaco-editor');
          monaco = m2 && m2.editor ? m2 : (typeof window !== 'undefined' ? window.monaco : null);
          try { if (monaco && typeof window !== 'undefined' && !window.monaco) window.monaco = monaco; } catch (_) {}
        } catch (e2) {
          monaco = (typeof window !== 'undefined' ? window.monaco : null);
        }
      }

      try {
        if (monaco && monaco.languages && typeof monaco.languages.getLanguages === 'function') {
          const hasJson = monaco.languages.getLanguages().some((l) => l && l.id === 'json');
          if (!hasJson) {
            try { await import('monaco-editor/esm/vs/language/json/monaco.contribution'); } catch (_) { /* ignore */ }
          }
        } else {
          try { await import('monaco-editor/esm/vs/language/json/monaco.contribution'); } catch (_) { /* ignore */ }
        }
      } catch (_) { /* ignore */ }

      try {
        if (monaco && monaco.languages && monaco.languages.json && monaco.languages.json.jsonDefaults && typeof monaco.languages.json.jsonDefaults.setDiagnosticsOptions === 'function') {
          monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false, enableSchemaRequest: false, allowComments: true });
        }
      } catch (_) { /* ignore */ }
    } catch (e) {
      monaco = null;
    }

    try { console.info('[DiffTextView] monaco after import:', !!monaco); } catch (_) {}
  } catch (e) {
    monaco = null;
  }

  async function _waitForGlobalMonaco(timeoutMs = 2000, interval = 50) {
    const start = Date.now();
    if (monaco && monaco.editor) return monaco;
    if (typeof window !== 'undefined' && window.monaco && window.monaco.editor) {
      monaco = window.monaco;
      return monaco;
    }
    return new Promise((resolve) => {
      const t = setInterval(() => {
        if (typeof window !== 'undefined' && window.monaco && window.monaco.editor) {
          monaco = window.monaco;
          clearInterval(t);
          resolve(monaco);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(t);
          resolve(monaco);
        }
      }, interval);
    });
  }

  async function loadMonacoWithAttempts() {
    monacoLoading.value = true;
    monacoLoadError.value = '';
    try {
      if (monaco && monaco.editor) {
        // already have it
      } else if (typeof window !== 'undefined' && window.monaco && window.monaco.editor) {
        monaco = window.monaco;
      } else {
        let attempts = 0;
        const maxAttempts = 5;
        while (attempts < maxAttempts) {
          await _waitForGlobalMonaco(1000, 50);
          if (monaco && monaco.editor) break;
          attempts++;
        }
      }
    } catch (e) {
      // swallow
    }

    await nextTick();
    try {
      initDiffEditor();
      if (!monacoAvailable.value) {
        monacoLoadError.value = 'Monaco 编辑器加载失败，请确保 monaco-editor 已正确安装并可用。';
      }
    } catch (e) {
      monacoLoadError.value = '初始化 Monaco 编辑器出错: ' + (e && e.message ? e.message : String(e));
    }
    monacoLoading.value = false;
  }

  await loadMonacoWithAttempts();
});

async function retryLoadMonaco() {
  await loadMonacoWithAttempts();
}

onBeforeUnmount(() => {
  try { diffEditor?.dispose && diffEditor.dispose(); } catch (e) {}
  try { leftModel?.dispose && leftModel.dispose(); } catch (e) {}
  try { rightModel?.dispose && rightModel.dispose(); } catch (e) {}
  try {
    if (themeAppliedHandler && typeof window !== 'undefined') {
      window.removeEventListener('jsonium-theme-applied', themeAppliedHandler);
    }
  } catch (e) {}
  try {
    if (themeRefreshRaf) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(themeRefreshRaf);
      } else {
        clearTimeout(themeRefreshRaf);
      }
    }
  } catch (e) {}
  themeAppliedHandler = null;
  themeRefreshRaf = null;
});

function initDiffEditor() {
  if (!editorContainer.value) return;
  monacoAvailable.value = false;
  try {
    if (!monaco || !monaco.editor) {
      monacoAvailable.value = false;
      return;
    }

    diffEditor = monaco.editor.createDiffEditor(editorContainer.value, {
      enableSplitViewResizing: true,
      renderSideBySide: true,
      renderSideBySideInlineBreakpoint: 0,
      useInlineViewWhenSpaceIsLimited: false,
      automaticLayout: true,
      folding: true,
      foldingStrategy: 'auto',
      ...props.options,
      renderSideBySide: true,
      renderSideBySideInlineBreakpoint: 0,
      useInlineViewWhenSpaceIsLimited: false
    });

    leftModel = monaco.editor.createModel(props.left || '', props.language);
    rightModel = monaco.editor.createModel(props.right || '', props.language);

    diffEditor.setModel({ original: leftModel, modified: rightModel });

    monacoAvailable.value = true;
    try { console.info('[DiffTextView] monacoAvailable=true'); } catch (e) {}

    try {
      const replay = () => {
        try {
          if (pendingFoldRanges && pendingFoldRanges.value && pendingFoldRanges.value.length) {
            for (const r of pendingFoldRanges.value) {
              try { exportsApplyFold(r); } catch (e) {}
            }
            pendingFoldRanges.value = [];
          }
        } catch (e) {}
      };
      setTimeout(replay, 50);
    } catch (e) {}

    try {
      if (leftModel && rightModel && monaco && monaco.editor && typeof monaco.editor.setModelLanguage === 'function') {
        monaco.editor.setModelLanguage(leftModel, props.language);
        monaco.editor.setModelLanguage(rightModel, props.language);
        try {
          applyCurrentTheme();
          if (typeof monaco.editor.tokenize === 'function') {
            try { monaco.editor.tokenize(leftModel.getValue(), props.language); } catch (_) {}
            try { monaco.editor.tokenize(rightModel.getValue(), props.language); } catch (_) {}
          }
        } catch (_) { /* ignore */ }
      }
    } catch (_) {}

    installThemeRefreshListener();

    try {
      const orig = diffEditor.getOriginalEditor();
      const mod = diffEditor.getModifiedEditor();
      if (orig && typeof orig.updateOptions === 'function') orig.updateOptions({ folding: true, foldingStrategy: 'auto' });
      if (mod && typeof mod.updateOptions === 'function') mod.updateOptions({ folding: true, foldingStrategy: 'auto' });
      setTimeout(() => { try { applyDiffDecorations(); } catch (_) {} }, 50);
    } catch (e) { /* ignore */ }
  } catch (e) {
    monacoAvailable.value = false;
    console.warn('[DiffTextView] initDiffEditor failed', e);
  }
}

let currentOrigDecorations = [];
let currentModDecorations = [];

function applyDiffDecorations() {
  try {
    try { console.info('[DiffTextView] applyDiffDecorations'); } catch (e) {}
    if (!monacoAvailable.value || !diffEditor || !leftModel || !rightModel || !monaco) return;

    const origEditor = diffEditor.getOriginalEditor();
    const modEditor = diffEditor.getModifiedEditor();
    if (!origEditor || !modEditor) return;

    const leftText = leftModel.getValue().split(/\r?\n/);
    const rightText = rightModel.getValue().split(/\r?\n/);

    const leftStr = leftText.join('\n');
    const rightStr = rightText.join('\n');
    const useWorker = (leftStr.length > (WORKER_OFFLOAD_CHARS || 0)) || (rightStr.length > (WORKER_OFFLOAD_CHARS || 0));

    if (useWorker && typeof buildLineDiffsAsync === 'function') {
      buildLineDiffsAsync(leftStr, rightStr).then((diffs) => {
        try { _applyDiffsToEditors(diffs, origEditor, modEditor); } catch (e) { try { const fallback = buildLineDiffs(leftText, rightText); _applyDiffsToEditors(fallback, origEditor, modEditor); } catch (_) {} }
      }).catch(() => { try { const fallback = buildLineDiffs(leftText, rightText); _applyDiffsToEditors(fallback, origEditor, modEditor); } catch (_) {} });
      return;
    }

    const diffs = buildLineDiffs(leftText, rightText);

    const origDecs = [];
    const modDecs = [];
    const origInlineDecs = [];
    const modInlineDecs = [];

    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];

      if (d.type === 'removed') {
        const line = d.leftLine || 1;
        origDecs.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'line-removed' } });

        const next = diffs[i + 1];
        if (next && next.type === 'added' && typeof d.left === 'string' && typeof next.right === 'string') {
          const leftStr = d.left;
          const rightStr = next.right;
          const parts = diffWordsWithSpace(leftStr, rightStr);

          let leftPos = 0;
          let rightPos = 0;
          for (const p of parts) {
            const text = String(p.value);
            if (p.added) {
              const start = rightPos + 1;
              const end = rightPos + Math.max(1, text.length);
              modInlineDecs.push({ range: new monaco.Range(next.rightLine || 1, start, next.rightLine || 1, end), options: { inlineClassName: 'inline-added' } });
              rightPos += text.length;
            } else if (p.removed) {
              const start = leftPos + 1;
              const end = leftPos + Math.max(1, text.length);
              origInlineDecs.push({ range: new monaco.Range(d.leftLine || 1, start, d.leftLine || 1, end), options: { inlineClassName: 'inline-removed' } });
              leftPos += text.length;
            } else {
              leftPos += text.length;
              rightPos += text.length;
            }
          }
          i++;
        }
      } else if (d.type === 'added') {
        const prev = diffs[i - 1];
        if (!(prev && prev.type === 'removed')) {
          const line = d.rightLine || 1;
          modDecs.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'line-added' } });
        }
      }
    }

    try { currentOrigDecorations = origEditor.deltaDecorations(currentOrigDecorations, origDecs.concat(origInlineDecs)); } catch (e) { currentOrigDecorations = []; }
    try { currentModDecorations = modEditor.deltaDecorations(currentModDecorations, modDecs.concat(modInlineDecs)); } catch (e) { currentModDecorations = []; }
  } catch (e) {
    // ignore
  }
}

function _applyDiffsToEditors(diffs, origEditor, modEditor) {
  const origDecs = [];
  const modDecs = [];
  const origInlineDecs = [];
  const modInlineDecs = [];

  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i];
    if (d.type === 'removed') {
      const line = d.leftLine || 1;
      origDecs.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'line-removed' } });
      const next = diffs[i + 1];
      if (next && next.type === 'added' && typeof d.left === 'string' && typeof next.right === 'string') {
        const leftStr = d.left;
        const rightStr = next.right;
        const parts = diffWordsWithSpace(leftStr, rightStr);
        let leftPos = 0;
        let rightPos = 0;
        for (const p of parts) {
          const text = String(p.value);
          if (p.added) {
            const start = rightPos + 1;
            const end = rightPos + Math.max(1, text.length);
            modInlineDecs.push({ range: new monaco.Range(next.rightLine || 1, start, next.rightLine || 1, end), options: { inlineClassName: 'inline-added' } });
            rightPos += text.length;
          } else if (p.removed) {
            const start = leftPos + 1;
            const end = leftPos + Math.max(1, text.length);
            origInlineDecs.push({ range: new monaco.Range(d.leftLine || 1, start, d.leftLine || 1, end), options: { inlineClassName: 'inline-removed' } });
            leftPos += text.length;
          } else {
            leftPos += text.length;
            rightPos += text.length;
          }
        }
        i++;
      }
    } else if (d.type === 'added') {
      const prev = diffs[i - 1];
      if (!(prev && prev.type === 'removed')) {
        const line = d.rightLine || 1;
        modDecs.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'line-added' } });
      }
    }
  }

  try { currentOrigDecorations = origEditor.deltaDecorations(currentOrigDecorations, origDecs.concat(origInlineDecs)); } catch (e) { currentOrigDecorations = []; }
  try { currentModDecorations = modEditor.deltaDecorations(currentModDecorations, modDecs.concat(modInlineDecs)); } catch (e) { currentModDecorations = []; }
}

watch(() => props.left, (v) => { if (!leftModel) return; const cur = leftModel.getValue(); if (cur !== v) leftModel.setValue(v); applyDiffDecorations(); });
watch(() => props.right, (v) => { if (!rightModel) return; const cur = rightModel.getValue(); if (cur !== v) rightModel.setValue(v); applyDiffDecorations(); });

const fallbackLeft = computed(() => props.left || '');
const fallbackRight = computed(() => props.right || '');

function escapeHtml(s) { return String(s || '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>'); }

const highlightedLeftHtml = computed(() => {
  try {
    const leftText = (fallbackLeft.value || '').split(/\r?\n/);
    const rightText = (fallbackRight.value || '').split(/\r?\n/);
    const diffs = buildLineDiffs(leftText, rightText);
    const parts = [];
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];
      if (d.type === 'unchanged') continue;
      else if (d.type === 'removed') {
        const next = diffs[i + 1];
        if (next && next.type === 'added' && typeof d.left === 'string' && typeof next.right === 'string') {
          const words = diffWordsWithSpace(d.left, next.right);
          const segs = words.map(p => {
            if (p.added) return '<span class="inline-added">' + escapeHtml(p.value) + '</span>';
            if (p.removed) return '<span class="inline-removed">' + escapeHtml(p.value) + '</span>';
            return escapeHtml(p.value);
          }).join('');
          parts.push('<div class="line removed">' + segs + '</div>');
          i++;
        } else {
          parts.push('<div class="line removed">' + escapeHtml(d.left || '') + '</div>');
        }
      } else if (d.type === 'added') {
        parts.push('<div class="line added">' + escapeHtml(d.right || '') + '</div>');
      }
    }
    return parts.join('');
  } catch (e) {
    return escapeHtml(fallbackLeft.value);
  }
});

const highlightedRightHtml = computed(() => {
  try {
    const leftText = (fallbackLeft.value || '').split(/\r?\n/);
    const rightText = (fallbackRight.value || '').split(/\r?\n/);
    const diffs = buildLineDiffs(leftText, rightText);
    const parts = [];
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];
      if (d.type === 'unchanged') continue;
      else if (d.type === 'added') {
        const prev = diffs[i - 1];
        if (prev && prev.type === 'removed' && typeof prev.left === 'string' && typeof d.right === 'string') {
          const words = diffWordsWithSpace(prev.left, d.right);
          const segs = words.map(p => {
            if (p.added) return '<span class="inline-added">' + escapeHtml(p.value) + '</span>';
            if (p.removed) return '<span class="inline-removed">' + escapeHtml(p.value) + '</span>';
            return escapeHtml(p.value);
          }).join('');
          parts.push('<div class="line added">' + segs + '</div>');
        } else {
          parts.push('<div class="line added">' + escapeHtml(d.right || '') + '</div>');
        }
      } else if (d.type === 'removed') {
        parts.push('<div class="line removed">' + escapeHtml(d.left || '') + '</div>');
      }
    }
    return parts.join('');
  } catch (e) {
    return escapeHtml(fallbackRight.value);
  }
});

defineExpose({
  getDiffEditor: () => diffEditor,
  revealOriginalLine: (line) => { if (!diffEditor || !monaco) return; try { const ed = diffEditor.getOriginalEditor(); if (!ed) return; try { if (typeof ed.revealPositionInCenter === 'function') ed.revealPositionInCenter({ lineNumber: line, column: 1 }); else if (typeof ed.revealLineInCenter === 'function') ed.revealLineInCenter(line); if (typeof monaco.Selection === 'function' && typeof ed.setSelection === 'function') ed.setSelection(new monaco.Selection(line, 1, line, 1)); } catch (e) {} } catch (e) {} },
  revealModifiedLine: (line) => { if (!diffEditor || !monaco) return; try { const ed = diffEditor.getModifiedEditor(); if (!ed) return; try { if (typeof ed.revealPositionInCenter === 'function') ed.revealPositionInCenter({ lineNumber: line, column: 1 }); else if (typeof ed.revealLineInCenter === 'function') ed.revealLineInCenter(line); if (typeof monaco.Selection === 'function' && typeof ed.setSelection === 'function') ed.setSelection(new monaco.Selection(line, 1, line, 1)); } catch (e) {} } catch (e) {} },
  foldRanges: (ranges) => { if (!diffEditor || !monaco) { try { pendingFoldRanges.value = pendingFoldRanges.value || []; pendingFoldRanges.value.push(ranges); } catch (e) {} return; } try { exportsApplyFold(ranges); } catch (e) {} },
  clearFold: () => { if (!diffEditor) return; try { const orig = diffEditor.getOriginalEditor(); const mod = diffEditor.getModifiedEditor(); try { orig.setHiddenAreas([]); } catch (e) {} try { mod.setHiddenAreas([]); } catch (e) {} } catch (e) {} }
});

function exportsApplyFold(ranges) {
  if (!diffEditor || !monaco) return;
  try {
    const orig = diffEditor.getOriginalEditor();
    const mod = diffEditor.getModifiedEditor();
    if (Array.isArray(ranges)) {
      const r = ranges.map(([s, e]) => new monaco.Range(s, 1, e, 1));
      if (orig && typeof orig.setHiddenAreas === 'function') try { orig.setHiddenAreas(r); } catch (e) {}
      if (mod && typeof mod.setHiddenAreas === 'function') try { mod.setHiddenAreas(r); } catch (e) {}
    } else if (ranges && typeof ranges === 'object') {
      const leftRanges = Array.isArray(ranges.left) ? ranges.left.map(([s, e]) => new monaco.Range(s, 1, e, 1)) : [];
      const rightRanges = Array.isArray(ranges.right) ? ranges.right.map(([s, e]) => new monaco.Range(s, 1, e, 1)) : [];
      if (orig && typeof orig.setHiddenAreas === 'function') try { orig.setHiddenAreas(leftRanges); } catch (e) {}
      if (mod && typeof mod.setHiddenAreas === 'function') try { mod.setHiddenAreas(rightRanges); } catch (e) {}
    }
  } catch (e) {}
}
</script>

<template>
  <div class="diff-text-wrapper">
    <div ref="editorContainer" class="diff-editor-container"></div>

    <div v-if="monacoLoading" class="overlay monaco-loading">
      <div class="loading-panel">
        <div class="loading-indicator"></div>
        <div class="loading-text">正在加载 Monaco 编辑器，请稍候……</div>
      </div>
    </div>

    <div v-if="!monacoLoading && !monacoAvailable" class="overlay monaco-error-panel">
      <div class="error-header">无法加载 Monaco 编辑器</div>
      <div class="error-message">{{ monacoLoadError || 'Monaco 编辑器不可用。' }}</div>
      <div class="error-actions">
        <button class="retry-button" @click="retryLoadMonaco" :disabled="monacoLoading">重试加载 Monaco</button>
      </div>
      <div class="error-hint">Json 语法高亮与折叠功能需要 Monaco 编辑器。请确保 monaco-editor 已正确安装或刷新页面。</div>
    </div>
  </div>
</template>

<style scoped>
.diff-text-wrapper { width: 100%; height: 100%; background: var(--color-bg-primary); }
.diff-editor-container { width: 100%; height: 100%; background: var(--color-bg-secondary); border-radius: 4px; overflow: hidden; }
.diff-fallback { display: flex; gap: 12px; padding: 8px; height: 100%; box-sizing: border-box; }
.fallback-side { flex: 1; display: flex; flex-direction: column; background: var(--color-bg-secondary); border-radius: 4px; border: 1px solid var(--color-divider); overflow: auto; }
.fallback-title { padding: 6px 8px; border-bottom: 1px solid var(--color-divider); font-weight: 600; font-size: 13px; color: var(--color-text-primary); background: var(--color-bg-primary); }
.fallback-pre { padding: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Helvetica Neue", monospace; font-size: 13px; white-space: pre-wrap; word-break: break-word; color: var(--color-text-primary); }
.line-added { background: rgba(16,185,129,0.10) !important; border-left: 4px solid rgba(16,185,129,0.8); }
.line-removed { background: rgba(239,68,68,0.06) !important; border-left: 4px solid rgba(239,68,68,0.9); }
.inline-added { background: rgba(16,185,129,0.20); color: #064e3b; padding: 0 2px; border-radius: 2px; }
.inline-removed { background: rgba(239,68,68,0.12); color: #7f1d1d; text-decoration: line-through; padding: 0 2px; border-radius: 2px; }
</style>

<style scoped>
.monaco-loading { width:100%; height:100%; display:flex; align-items:center; justify-content:center; }
.loading-panel { display:flex; flex-direction:column; align-items:center; gap:8px; }
.loading-indicator { width:28px; height:28px; border-radius:50%; border:3px solid rgba(255,255,255,0.08); border-top-color:var(--color-accent, #6b7280); animation:spin 1s linear infinite; }
.loading-text { color:var(--color-text-tertiary); font-size:13px; }
@keyframes spin { to { transform: rotate(360deg); } }
.monaco-error-panel { padding:16px; display:flex; flex-direction:column; gap:8px; align-items:flex-start; }
.error-header { font-weight:700; color:var(--color-danger, #f87171); }
.error-message { color:var(--color-text-primary); }
.error-actions { margin-top:6px; }
.retry-button { background:var(--color-accent, #4f46e5); color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; }
.retry-button:disabled { opacity:0.6; cursor:not-allowed; }
.error-hint { color:var(--color-text-tertiary); font-size:12px; margin-top:8px; }
</style>

<style>
/* Global styles for HTML-rendered diff (v-html) — not scoped so they apply to injected markup */
.diff-text-wrapper .fallback-pre .line.added { background: rgba(16,185,129,0.04); padding:4px 6px; border-left:4px solid rgba(16,185,129,0.6); display:block; }
.diff-text-wrapper .fallback-pre .line.removed { background: rgba(239,68,68,0.03); padding:4px 6px; border-left:4px solid rgba(239,68,68,0.8); display:block; }
.diff-text-wrapper .fallback-pre .line.unchanged { color: var(--color-text-tertiary); padding:2px 6px; display:block; }
.diff-text-wrapper .fallback-pre .inline-added { background: rgba(16,185,129,0.20); color: #064e3b; padding: 0 2px; border-radius: 2px; }
.diff-text-wrapper .fallback-pre .inline-removed { background: rgba(239,68,68,0.12); color: #7f1d1d; text-decoration: line-through; padding: 0 2px; border-radius: 2px; }
.diff-text-wrapper .fold-toggle { display:inline-block; padding:2px 8px; margin:6px 0; background: rgba(0,0,0,0.08); border-radius:12px; cursor:pointer; font-size:12px; color:var(--color-text-tertiary); }
</style>
