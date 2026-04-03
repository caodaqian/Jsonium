<script setup>
import { ref, onMounted, watch, onBeforeUnmount, computed, nextTick } from 'vue';
let monaco = null;
import { diffWordsWithSpace } from 'diff';
import { buildLineDiffs } from '../services/diffEngine.js';

const props = defineProps({
  left: { type: String, default: '' },
  right: { type: String, default: '' },
  language: { type: String, default: 'json' },
  options: { type: Object, default: () => ({}) }
});

const editorContainer = ref(null);
let diffEditor = null;
let leftModel = null;
let rightModel = null;
const monacoAvailable = ref(false);
const monacoLoadError = ref('');
const monacoLoading = ref(true);

// When foldRanges is called before Monaco is ready, cache the ranges and
// apply them once Monaco becomes available.
const pendingFoldRanges = ref([]);

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
window.MonacoEnvironment = window.MonacoEnvironment || {};
// Robust getWorker that tries ESM worker first, then falls back to a module blob worker
// and finally to a classic importScripts-based worker. This helps environments
// (like some Electron/uTools hosts) that don't support new Worker(new URL(..., import.meta.url)).
window.MonacoEnvironment.getWorker = function (moduleId, label) {
  // If the environment already provides a getWorkerUrl/getWorker helper (e.g. injected by vite-plugin-monaco-editor),
  // prefer using it — it will return a proper worker URL or blob URL that is safe to instantiate.
  try {
    const env = window.MonacoEnvironment || {};
    if (typeof env.getWorkerUrl === 'function') {
      try {
        const url = env.getWorkerUrl(moduleId, label);
        return new Worker(url);
      } catch (e) {
        // fallthrough to other strategies
      }
    }
    if (typeof env.getWorker === 'function') {
      // some setups may provide getWorker directly
      try { return env.getWorker(moduleId, label); } catch (_) {}
    }
  } catch (_) {}

  const makeUrl = (p) => {
    try { return new URL(p, import.meta.url).toString(); } catch (_) { return p; }
  };
  const jsonPath = 'monaco-editor/esm/vs/language/json/json.worker.js';
  const editorPath = 'monaco-editor/esm/vs/editor/editor.worker.js';

  try {
    if (label === 'json') {
      return new Worker(new URL(jsonPath, import.meta.url), { type: 'module' });
    }
    return new Worker(new URL(editorPath, import.meta.url), { type: 'module' });
  } catch (err) {
    // fallback: try creating a module worker from a blob that imports the real worker module
    try {
      const url = label === 'json' ? makeUrl(jsonPath) : makeUrl(editorPath);
      const blob = new Blob([`import("${url}");`], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      return new Worker(blobUrl, { type: 'module' });
    } catch (e) {
      // last resort: classic worker using importScripts (may or may not work depending on packaging)
      try {
        const url = label === 'json' ? makeUrl(jsonPath) : makeUrl(editorPath);
        const blob = new Blob([`self.importScripts("${url}");`], { type: 'application/javascript' });
        const b = URL.createObjectURL(blob);
        return new Worker(b);
      } catch (e2) {
        // rethrow original error to surface failure
        throw err;
      }
    }
  }
};
    } catch (e) {
      // ignore injection failure
    }

    const name = 'monaco-editor/esm/vs/editor/editor.api';
    // 动态导入 Monaco ESM 入口
    try {
      // 加载 Monaco 样式以保证语法高亮与编辑器样式生效
      try { await import('monaco-editor/min/vs/editor/editor.main.css'); } catch (_) { /* ignore */ }

      // 尝试多种加载路径：优先 ESM，再尝试常规 package，最后回退到 window.monaco
      try {
        try {
      // 更健壮地处理不同打包/导出形态的 monaco 模块
      let m = null;
      try {
        m = await import(/* @vite-ignore */ name);
      } catch (e) {
        m = null;
      }
      if (m && typeof m === 'object') {
        if (m.default && m.default.editor) {
          monaco = m.default;
        } else if (m.editor) {
          monaco = m;
        } else {
          monaco = (typeof window !== 'undefined' ? window.monaco : null);
        }
      } else {
        monaco = (typeof window !== 'undefined' ? window.monaco : null);
      }
        } catch (e1) {
          try {
            const m2 = await import('monaco-editor');
            monaco = m2 && m2.editor ? m2 : (typeof window !== 'undefined' ? window.monaco : null);
          } catch (e2) {
            monaco = (typeof window !== 'undefined' ? window.monaco : null);
          }
        }

        // 动态加载 JSON 语言贡献以确保 JSON 语言与 tokenizer 可用（容错）
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
      } catch (_) {
        monaco = null;
      }

      // 立即禁用 JSON schema 请求与验证，防止 worker 去 fetch 外部 schema 导致 loadForeignModule
      try {
        if (monaco && monaco.languages && monaco.languages.json && monaco.languages.json.jsonDefaults && typeof monaco.languages.json.jsonDefaults.setDiagnosticsOptions === 'function') {
          monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: false,
            enableSchemaRequest: false,
            allowComments: true
          });
        }
      } catch (_) { /* ignore */ }
    } catch (e) {
      monaco = null;
    }
  } catch (e) {
    monaco = null;
  }

  // 如果 monaco 尚未在全局注入，等待短时轮询尝试拾取（一些插件/加载方式会异步注入 window.monaco）
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

  // 强制使用 Monaco：封装为可重试的加载流程。尽量拾取多种导入/注入方式，
  // 若最终失败则设置 monacoLoadError，并由 UI 提供重试按钮。
  async function loadMonacoWithAttempts() {
    monacoLoading.value = true;
    monacoLoadError.value = '';
    // try to reuse any already-imported monaco first
    try {
      if (monaco && monaco.editor) {
        // already have it
      } else if (typeof window !== 'undefined' && window.monaco && window.monaco.editor) {
        monaco = window.monaco;
      } else {
        // attempt a few times waiting for window.monaco injection
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

  // initial load
  await loadMonacoWithAttempts();
});

// expose a retry function that can be called from the template
async function retryLoadMonaco() {
  await loadMonacoWithAttempts();
}

onBeforeUnmount(() => {
  try { diffEditor?.dispose && diffEditor.dispose(); } catch (e) {}
  try { leftModel?.dispose && leftModel.dispose(); } catch (e) {}
  try { rightModel?.dispose && rightModel.dispose(); } catch (e) {}
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
      automaticLayout: true,
      folding: true,
      foldingStrategy: 'auto',
      ...props.options
    });

    leftModel = monaco.editor.createModel(props.left || '', props.language);
    rightModel = monaco.editor.createModel(props.right || '', props.language);

    diffEditor.setModel({ original: leftModel, modified: rightModel });

    monacoAvailable.value = true;
    try { console.info('[DiffTextView] monacoAvailable=true'); } catch (e) {}

    // 回放在 Monaco 未就绪时缓存的折叠区间（如果有）
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
      // 延迟执行以保证内部 editors 已经渲染
      setTimeout(replay, 50);
    } catch (e) {}

    // 立即设置模型语言（已确保 monaco 可用）
      try {
      if (leftModel && rightModel && monaco && monaco.editor && typeof monaco.editor.setModelLanguage === 'function') {
        monaco.editor.setModelLanguage(leftModel, props.language);
        monaco.editor.setModelLanguage(rightModel, props.language);
        try {
          // 确保使用项目主题并触发 tokenization，以使语法高亮生效
          if (typeof monaco.editor.setTheme === 'function') monaco.editor.setTheme('vs-dark');
          if (typeof monaco.editor.tokenize === 'function') {
            // 触发一次 tokenization 以帮助样式应用
            try { monaco.editor.tokenize(leftModel.getValue(), props.language); } catch (_) {}
            try { monaco.editor.tokenize(rightModel.getValue(), props.language); } catch (_) {}
          }
        } catch (_) { /* ignore */ }
      }
    } catch (_) {}

    // ensure folding options and apply decorations shortly after render
    try {
      const orig = diffEditor.getOriginalEditor();
      const mod = diffEditor.getModifiedEditor();
      if (orig && typeof orig.updateOptions === 'function') orig.updateOptions({ folding: true, foldingStrategy: 'auto' });
      if (mod && typeof mod.updateOptions === 'function') mod.updateOptions({ folding: true, foldingStrategy: 'auto' });
      setTimeout(() => { try { applyDiffDecorations(); } catch (_) {} }, 50);
    } catch (e) { /* ignore */ }
  } catch (e) {
    monacoAvailable.value = false;
    // eslint-disable-next-line no-console
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
    const diffs = buildLineDiffs(leftText, rightText);

    const origDecs = [];
    const modDecs = [];
    const origInlineDecs = [];
    const modInlineDecs = [];

    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];

      if (d.type === 'removed') {
        const line = d.leftLine || 1;
        origDecs.push({
          range: new monaco.Range(line, 1, line, 1),
          options: { isWholeLine: true, className: 'line-removed' }
        });

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
              modInlineDecs.push({
                range: new monaco.Range(next.rightLine || 1, start, next.rightLine || 1, end),
                options: { inlineClassName: 'inline-added' }
              });
              rightPos += text.length;
            } else if (p.removed) {
              const start = leftPos + 1;
              const end = leftPos + Math.max(1, text.length);
              origInlineDecs.push({
                range: new monaco.Range(d.leftLine || 1, start, d.leftLine || 1, end),
                options: { inlineClassName: 'inline-removed' }
              });
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
          modDecs.push({
            range: new monaco.Range(line, 1, line, 1),
            options: { isWholeLine: true, className: 'line-added' }
          });
        }
      }
    }

    try { currentOrigDecorations = origEditor.deltaDecorations(currentOrigDecorations, origDecs.concat(origInlineDecs)); } catch (e) { currentOrigDecorations = []; }
    try { currentModDecorations = modEditor.deltaDecorations(currentModDecorations, modDecs.concat(modInlineDecs)); } catch (e) { currentModDecorations = []; }
  } catch (e) {
    // ignore
  }
}

watch(() => props.left, (v) => {
  if (!leftModel) return;
  const cur = leftModel.getValue();
  if (cur !== v) leftModel.setValue(v);
  applyDiffDecorations();
});

watch(() => props.right, (v) => {
  if (!rightModel) return;
  const cur = rightModel.getValue();
  if (cur !== v) rightModel.setValue(v);
  applyDiffDecorations();
});

const fallbackLeft = computed(() => props.left || '');
const fallbackRight = computed(() => props.right || '');

// Fallback HTML highlighter when Monaco is not available.
// Produces inline and line-level highlights using buildLineDiffs and diffWordsWithSpace.
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}

const highlightedLeftHtml = computed(() => {
  try {
    const leftText = (fallbackLeft.value || '').split(/\r?\n/);
    const rightText = (fallbackRight.value || '').split(/\r?\n/);
    const diffs = buildLineDiffs(leftText, rightText);
    const parts = [];
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];
      // skip unchanged lines in fallback HTML to avoid redundant display
      if (d.type === 'unchanged') {
        continue;
      } else if (d.type === 'removed') {
        // try inline with next added
        const next = diffs[i + 1];
        if (next && next.type === 'added' && typeof d.left === 'string' && typeof next.right === 'string') {
          const words = diffWordsWithSpace(d.left, next.right);
          const segs = words.map(p => {
            if (p.added) return '<span class="inline-added">' + escapeHtml(p.value) + '</span>';
            if (p.removed) return '<span class="inline-removed">' + escapeHtml(p.value) + '</span>';
            return escapeHtml(p.value);
          }).join('');
          parts.push('<div class="line removed">' + segs + '</div>');
          i++; // skip paired added
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
      // skip unchanged lines in fallback HTML
      if (d.type === 'unchanged') {
        continue;
      } else if (d.type === 'added') {
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
  revealOriginalLine: (line) => {
    if (!diffEditor || !monaco) return;
    try {
      const ed = diffEditor.getOriginalEditor();
      if (!ed) return;
      try {
        if (typeof ed.revealPositionInCenter === 'function') ed.revealPositionInCenter({ lineNumber: line, column: 1 });
        else if (typeof ed.revealLineInCenter === 'function') ed.revealLineInCenter(line);
        if (typeof monaco.Selection === 'function' && typeof ed.setSelection === 'function') ed.setSelection(new monaco.Selection(line, 1, line, 1));
      } catch (e) { /* ignore */ }
    } catch (e) {}
  },
  revealModifiedLine: (line) => {
    if (!diffEditor || !monaco) return;
    try {
      const ed = diffEditor.getModifiedEditor();
      if (!ed) return;
      try {
        if (typeof ed.revealPositionInCenter === 'function') ed.revealPositionInCenter({ lineNumber: line, column: 1 });
        else if (typeof ed.revealLineInCenter === 'function') ed.revealLineInCenter(line);
        if (typeof monaco.Selection === 'function' && typeof ed.setSelection === 'function') ed.setSelection(new monaco.Selection(line, 1, line, 1));
      } catch (e) { /* ignore */ }
    } catch (e) {}
  },
  foldRanges: (ranges) => {
    // if Monaco not ready, cache ranges to apply once available
    if (!diffEditor || !monaco) {
      try { pendingFoldRanges.value = pendingFoldRanges.value || []; pendingFoldRanges.value.push(ranges); } catch (e) {}
      return;
    }
    try {
      exportsApplyFold(ranges);
    } catch (e) { /* ignore */ }
  },
  clearFold: () => {
    if (!diffEditor) return;
    try {
      const orig = diffEditor.getOriginalEditor();
      const mod = diffEditor.getModifiedEditor();
      try { orig.setHiddenAreas([]); } catch (e) {}
      try { mod.setHiddenAreas([]); } catch (e) {}
    } catch (e) { /* ignore */ }
  }
});

// helper used internally to actually apply folds (avoids code duplication)
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
    <!-- 编辑器容器始终渲染，避免因条件渲染导致 init 时拿不到 DOM 引用 -->
    <div ref="editorContainer" class="diff-editor-container"></div>

    <!-- 覆盖层：加载中提示 -->
    <div v-if="monacoLoading" class="overlay monaco-loading">
      <div class="loading-panel">
        <div class="loading-indicator"></div>
        <div class="loading-text">正在加载 Monaco 编辑器，请稍候……</div>
      </div>
    </div>

    <!-- 覆盖层：加载失败时显示明确错误和重试入口（强制使用 Monaco） -->
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

/* Fold control */
.diff-text-wrapper .fold-toggle { display:inline-block; padding:2px 8px; margin:6px 0; background: rgba(0,0,0,0.08); border-radius:12px; cursor:pointer; font-size:12px; color:var(--color-text-tertiary); }
</style>
