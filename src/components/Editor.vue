<script setup>
  let monaco = null;
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
    cancelScheduledAutoFormat,
    computeMinimalEdits,
    computeMinimalEditsAsync,
    formatJsonString,
    registerJsonFormattingProvider,
    runEditorFormat,
    scheduleAutoFormat,
    WORKER_OFFLOAD_CHARS
} from '../services/editorFormatting.js';
import { extractPathFromText } from '../services/pathExtraction.js';
import { useJsonStore } from '../store/index.js';

  const props = defineProps({
    content: {
      type: String,
      default: '{}'
    },
    autoFormat: {
      type: Boolean,
      default: false
    },
    debounceMs: {
      type: Number,
      default: 300
    },
    autoFormatOnIdle: {
      type: Boolean,
      default: true
    },
    autoFormatOnPaste: {
      type: Boolean,
      default: true
    }
  });

  const emit = defineEmits(['change']);

  const store = useJsonStore();
  const editorContainer = ref(null);
  const editorContextMenuRef = ref(null);
  const editorContextMenuPosition = ref({ top: 0, left: 0, adjustedTop: undefined, adjustedLeft: undefined });
  const showEditorContextMenu = ref(false);
  let editor = null;
  let __applyingEdit = false;
  let domKeydownHandler = null;
  let modifierState = { shift: false, alt: false, ctrl: false, meta: false };
  let lastCopyTs = 0; // short guard to avoid duplicate rapid copy invocations
  let copyingLock = false; // prevent overlapping copy ops
  let resizeObserver = null;
  let domPasteHandler = null;
  let fallbackResizeListenerAdded = false;
  let adjustWrap = null;
  let themeAppliedHandler = null;
  let themeRefreshRaf = null;

  // modifierHandler keeps track of modifier keys across separate key events (helps when Alt/Shift are pressed in sequence)
  const modifierHandler = (e) => {
    try {
      const isDown = e.type === 'keydown';
      const k = e.key;
      if (k === 'Shift') modifierState.shift = isDown;
      else if (k === 'Alt') modifierState.alt = isDown;
      else if (k === 'AltGraph') modifierState.alt = isDown;
      else if (k === 'Control' || k === 'Ctrl') modifierState.ctrl = isDown;
      else if (k === 'Meta') modifierState.meta = isDown;
    } catch (err) {
      // ignore
    }
  };

  const scheduleState = { timer: null, lastReason: null };
  let lastEnterTs = 0;

  const editorContextMenuStyles = computed(() => {
    const top = editorContextMenuPosition.value.adjustedTop !== undefined && editorContextMenuPosition.value.adjustedTop !== null
      ? editorContextMenuPosition.value.adjustedTop
      : editorContextMenuPosition.value.top;
    const left = editorContextMenuPosition.value.adjustedLeft !== undefined && editorContextMenuPosition.value.adjustedLeft !== null
      ? editorContextMenuPosition.value.adjustedLeft
      : editorContextMenuPosition.value.left;
    return {
      top: `${top}px`,
      left: `${left}px`
    };
  });

  const hideEditorContextMenu = () => {
    showEditorContextMenu.value = false;
  };

  const positionEditorContextMenu = () => {
    const menuEl = editorContextMenuRef.value;
    if (!menuEl) return;

    const margin = 8;
    const menuW = menuEl.offsetWidth;
    const menuH = menuEl.offsetHeight;
    let left = editorContextMenuPosition.value.left;
    let top = editorContextMenuPosition.value.top;

    if (left + menuW > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - menuW - margin);
    }
    if (top + menuH > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - menuH - margin);
    }

    editorContextMenuPosition.value.adjustedLeft = left;
    editorContextMenuPosition.value.adjustedTop = top;
  };

  const handleEditorContextMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    editorContextMenuPosition.value = {
      top: event.clientY,
      left: event.clientX,
      adjustedTop: undefined,
      adjustedLeft: undefined
    };
    showEditorContextMenu.value = true;
    nextTick(() => {
      positionEditorContextMenu();
    });
  };

  const handleEditorContextMenuClick = (event) => {
    if (!showEditorContextMenu.value) return;
    const target = event.target;
    if (editorContextMenuRef.value?.contains(target)) return;
    hideEditorContextMenu();
  };

  const handleEditorContextMenuAction = async (actionId) => {
    hideEditorContextMenu();
    switch (actionId) {
      case 'format':
        await formatJson('manual');
        break;
      case 'escape':
        await escapeCurrentDocument();
        break;
      case 'unescape':
        await unescapeCurrentDocument();
        break;
      case 'copy-json':
        await copyCurrentJson();
        break;
      case 'jsonpath':
        await copyCurrentPath('jsonpath');
        break;
      case 'jq':
        await copyCurrentPath('jq');
        break;
      default:
        break;
    }
  };

  onMounted(async () => {
    // 尝试使用 ESM 入口并加载样式，避免 Vite externalized 导致的 runtime 问题
    try {
      // 尽早注入 MonacoEnvironment.getWorker，确保 worker 创建使用 ESM worker 路径，避免 loadForeignModule / Unexpected usage
      try {
        if (typeof window !== 'undefined') {
          // Inject a robust MonacoEnvironment.getWorker that prefers any helper
          // provided by the bundler/plugin (getWorkerUrl/getWorker). If not
          // available, attempt the following fallbacks in order:
          // 1. ESM module worker via new Worker(new URL(..., import.meta.url), { type: 'module' })
          // 2. Blob-based module import that imports the real worker module
          // 3. Classic importScripts-based worker via Blob (last resort)
          // preserve any existing helpers before overriding to avoid recursion
          const existingEnv = window.MonacoEnvironment || {};
          const savedGetWorker = existingEnv.getWorker;
          const savedGetWorkerUrl = existingEnv.getWorkerUrl;
          window.MonacoEnvironment = existingEnv;
          window.MonacoEnvironment.getWorker = function (moduleId, label) {
            try {
              try { console.debug('[Editor] MonacoEnvironment.getWorker called', { moduleId, label }); } catch(_) {}
              // prefer bundler/provided helper if it existed before we overrode it
              if (typeof savedGetWorkerUrl === 'function') {
                try {
                  const url = savedGetWorkerUrl(moduleId, label);
                  try { console.debug('[Editor] getWorker using savedGetWorkerUrl', { url, moduleId, label }); } catch(_) {}
                  return new Worker(url);
                } catch (e) {
                  // fall through to other strategies
                }
              }
              if (typeof savedGetWorker === 'function') {
                try { return savedGetWorker(moduleId, label); } catch (_) { /* fallthrough */ }
              }
            } catch (_) {}

            const makeUrl = (p) => {
              try {
                if (typeof location !== 'undefined' && typeof p === 'string' && p.charAt(0) === '/') return new URL(p, location.origin).toString();
                return p;
              } catch (_) { return p; }
            };

            // Use absolute paths to node_modules so Vite serves the worker files correctly in dev
            const jsonPath = '/node_modules/monaco-editor/esm/vs/language/json/json.worker.js';
            const editorPath = '/node_modules/monaco-editor/esm/vs/editor/editor.worker.js';

            try {
              if (label === 'json') {
                try { console.debug('[Editor] creating module worker for json', { url: jsonPath }); } catch(_) {}
                try {
                  const w = new Worker(jsonPath, { type: 'module' });
                  try {
                    if (w && typeof w.addEventListener === 'function') {
                      w.addEventListener('error', (ev) => {
                        try {
                          const msg = (ev && ev.message ? ev.message : '') + ' ' + (ev && ev.filename ? (ev.filename + ':' + (ev.lineno||0) + ':' + (ev.colno||0)) : '');
                          const errMsg = (ev && ev.error && ev.error.message) ? (' error:' + ev.error.message) : '';
                          console.error('[Editor] worker error event', msg + errMsg);
                          try { if (typeof window !== 'undefined') { window.__jsonium_worker_errors = window.__jsonium_worker_errors || []; window.__jsonium_worker_errors.push({ ts: Date.now(), label: 'editor', detail: msg + errMsg }); } } catch(_){}
                        } catch(_){}
                      });
                      w.addEventListener('messageerror', (ev) => { try { console.error('[Editor] worker messageerror', String(ev)); } catch(_){} });
                    }
                  } catch(_){}
                  return w;
                } catch (e) {
                  throw e;
                }
              }
              try { console.debug('[Editor] creating module worker for editor', { url: editorPath }); } catch(_) {}
              try {
                const w = new Worker(editorPath, { type: 'module' });
                try {
                  if (w && typeof w.addEventListener === 'function') {
                    w.addEventListener('error', (ev) => {
                      try {
                        const msg = (ev && ev.message ? ev.message : '') + ' ' + (ev && ev.filename ? (ev.filename + ':' + (ev.lineno||0) + ':' + (ev.colno||0)) : '');
                        const errMsg = (ev && ev.error && ev.error.message) ? (' error:' + ev.error.message) : '';
                        console.error('[Editor] worker error event', msg + errMsg);
                        try { if (typeof window !== 'undefined') { window.__jsonium_worker_errors = window.__jsonium_worker_errors || []; window.__jsonium_worker_errors.push({ ts: Date.now(), label: 'editor', detail: msg + errMsg }); } } catch(_){}
                      } catch(_){}
                    });
                    w.addEventListener('messageerror', (ev) => { try { console.error('[Editor] worker messageerror', String(ev)); } catch(_){} });
                  }
                } catch(_){}
                return w;
              } catch (e) {
                throw e;
              }
            } catch (err) {
              // fallback: try creating a module worker from a blob that imports the real worker module
              try { console.error('[Editor] module worker creation error', err && err.message ? err.message : err); } catch (_) {}
              try { console.debug('[Editor] module worker creation stack', err && err.stack ? err.stack : 'no-stack'); } catch (_) {}
              try {
                const url = label === 'json' ? makeUrl(jsonPath) : makeUrl(editorPath);
                try { console.debug('[Editor] module worker failed, falling back to blob import', { url, label }); } catch(_) {}
                const blob = new Blob([`import("${url}");`], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                try {
                  try { console.debug('[Editor] creating blob module worker', { blobUrl }); } catch(_) {}
                  const w = new Worker(blobUrl, { type: 'module' });
                  try {
                    if (w && typeof w.addEventListener === 'function') {
                      w.addEventListener('error', (ev) => {
                        try {
                          const msg = (ev && ev.message ? ev.message : '') + ' ' + (ev && ev.filename ? (ev.filename + ':' + (ev.lineno||0) + ':' + (ev.colno||0)) : '');
                          const errMsg = (ev && ev.error && ev.error.message) ? (' error:' + ev.error.message) : '';
                          console.error('[Editor] worker error event', msg + errMsg);
                          try { if (typeof window !== 'undefined') { window.__jsonium_worker_errors = window.__jsonium_worker_errors || []; window.__jsonium_worker_errors.push({ ts: Date.now(), label: 'editor', detail: msg + errMsg }); } } catch(_){}
                        } catch(_){}
                      });
                      w.addEventListener('messageerror', (ev) => { try { console.error('[Editor] worker messageerror', String(ev)); } catch(_){} });
                    }
                  } catch(_){}
                  try { URL.revokeObjectURL(blobUrl); } catch (e) { }
                  return w;
                } catch (errWorker) {
                  try { console.error('[Editor] blob module worker creation error', errWorker && errWorker.message ? errWorker.message : errWorker); } catch (_) {}
                  try { URL.revokeObjectURL(blobUrl); } catch (e) { }
                  throw errWorker;
                }
              } catch (e) {
                // last resort: classic worker using importScripts (may or may not work depending on packaging)
                try { console.error('[Editor] blob fallback error', e && e.message ? e.message : e); } catch (_) {}
                try { console.debug('[Editor] blob fallback stack', e && e.stack ? e.stack : 'no-stack'); } catch (_) {}
                try {
                  const url = label === 'json' ? makeUrl(jsonPath) : makeUrl(editorPath);
                  try { console.debug('[Editor] blob module failed, trying importScripts worker', { url, label }); } catch(_) {}
                  const blob = new Blob([`self.importScripts("${url}");`], { type: 'application/javascript' });
                  const b = URL.createObjectURL(blob);
                  try {
                    try { console.debug('[Editor] creating importScripts worker', { blobUrl: b }); } catch(_) {}
                    const w2 = new Worker(b);
                    try { if (w2 && typeof w2.addEventListener === 'function') { w2.addEventListener('error', (ev) => { try { console.error('[Editor] worker error event', ev && ev.message ? ev.message : ev); } catch(_){} }); w2.addEventListener('messageerror', (ev) => { try { console.error('[Editor] worker messageerror', ev); } catch(_){} }); } } catch(_){}
                    try { URL.revokeObjectURL(b); } catch (e) { }
                    return w2;
                  } catch (errWorker2) {
                    try { console.error('[Editor] importScripts worker creation error', errWorker2 && errWorker2.message ? errWorker2.message : errWorker2); } catch (_) {}
                    try { URL.revokeObjectURL(b); } catch (e) { }
                    throw errWorker2;
                  }
                } catch (e2) {
                  try { console.error('[Editor] importScripts fallback error', e2 && e2.message ? e2.message : e2); } catch (_) {}
                  try { console.debug('[Editor] importScripts fallback stack', e2 && e2.stack ? e2.stack : 'no-stack'); } catch (_) {}
                  // rethrow original error to surface failure
                  throw err;
                }
              }
            }
          };
        }
      } catch (e) { /* ignore injection failures */ }

      // 加载 Monaco CSS（容错）
      try { await import('monaco-editor/min/vs/editor/editor.main.css'); } catch (_) { /* ignore */ }

      // 优先加载 ESM 编辑器 API（兼容 vite 的打包方式）
      try {
        const m = await import('monaco-editor/esm/vs/editor/editor.api');
        // normalize module shape: prefer default.editor, then module.editor, then window.monaco
        if (m && Object.keys(m).length) {
          monaco = (m.default && m.default.editor) ? m.default : m;
        } else {
          monaco = (window && window.monaco) || null;
        }
        // ensure global reference for other parts of the app and diagnostic scripts
        try { if (monaco && typeof window !== 'undefined' && !window.monaco) window.monaco = monaco; } catch (_) {}
      } catch (e) {
        // 回退到常规包（部分环境下可用）
        try {
          const m2 = await import('monaco-editor');
          monaco = m2 && m2.editor ? m2 : (window && window.monaco) || null;
          try { if (monaco && typeof window !== 'undefined' && !window.monaco) window.monaco = monaco; } catch (_) {}
        } catch (e2) {
          monaco = (window && window.monaco) || null;
        }
      }
    } catch (_) {
      monaco = window.monaco || null;
    }

    // Register the JSON formatting provider once (idempotent)
    try { registerJsonFormattingProvider(monaco); } catch (_) { }

    // 尝试加载 JSON 语言贡献并开启诊断（以启用高亮与错误提示）
    try {
      // 动态加载 language contribution（容错）
      try { await import('monaco-editor/esm/vs/language/json/monaco.contribution'); } catch (_) { /* ignore */ }

      // 配置 JSON 诊断/校验选项（若可用）
    if (monaco && monaco.languages && monaco.languages.json && monaco.languages.json.jsonDefaults) {
      try {
        // 禁用远程 schema 请求与代码验证以避免 worker 发起 fetch/loadForeignModule 导致错误
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
          validate: false,
          enableSchemaRequest: false,
          allowComments: true,
          schemas: [] // 可在此加入 JSON Schema 强化自动补全与校验
        });
      } catch (_) { /* ignore */ }
    }
    } catch (_) { /* ignore */ }

    initEditor();
  });

  watch(showEditorContextMenu, (visible) => {
    if (visible) {
      document.addEventListener('click', handleEditorContextMenuClick, true);
      window.addEventListener('resize', positionEditorContextMenu);
      window.addEventListener('scroll', positionEditorContextMenu, { capture: true, passive: true });
    } else {
      document.removeEventListener('click', handleEditorContextMenuClick, true);
      window.removeEventListener('resize', positionEditorContextMenu);
      window.removeEventListener('scroll', positionEditorContextMenu, { capture: true, passive: true });
    }
  });

  onBeforeUnmount(() => {
    cancelScheduledAutoFormat(scheduleState);
    hideEditorContextMenu();
    try {
      try {
        if (themeAppliedHandler && typeof window !== 'undefined') {
          window.removeEventListener('jsonium-theme-applied', themeAppliedHandler);
        }
        if (themeRefreshRaf) {
          if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(themeRefreshRaf);
          } else {
            clearTimeout(themeRefreshRaf);
          }
        }
      } catch (_) {}
      themeAppliedHandler = null;
      themeRefreshRaf = null;
      // remove modifier listeners
      try { window.removeEventListener('keydown', modifierHandler); } catch (e) { }
      try { window.removeEventListener('keyup', modifierHandler); } catch (e) { }
      if (editor) {
        // remove both window listener (added as fallback) and any dom listener if present
        try { window.removeEventListener('keydown', domKeydownHandler); } catch (e) { }
        try {
          const domNode = editor && editor.getDomNode && editor.getDomNode();
          if (domNode && domKeydownHandler) {
            try { domNode.removeEventListener('keydown', domKeydownHandler, true); } catch (e) { }
            try { domNode.removeEventListener('keydown', domKeydownHandler); } catch (e) { }
            try { domNode.removeEventListener('contextmenu', handleEditorContextMenu, true); } catch (e) { }
          }
          if (domNode && domPasteHandler) {
            try { domNode.removeEventListener('paste', domPasteHandler); } catch (e) { }
            domPasteHandler = null;
          }
        } catch (e) { }
        domKeydownHandler = null;
        try { editor && editor.dispose && editor.dispose(); } catch (e) { }

        // disconnect ResizeObserver if present
        try {
          if (resizeObserver && typeof resizeObserver.disconnect === 'function') {
            try { resizeObserver.disconnect(); } catch (e) { }
            resizeObserver = null;
          }
        } catch (e) { }

        // remove fallback window resize listener if it was added
        try {
          if (fallbackResizeListenerAdded) {
            try { window.removeEventListener('resize', adjustWrap); } catch (e) { }
            fallbackResizeListenerAdded = false;
          }
        } catch (e) { }
      }
    } catch (e) { }
  });

  // watch external content and sync if differs
  watch(() => props.content, (newContent) => {
    if (editor && newContent !== editor.getValue()) {
      // mark as external-sync to avoid scheduling auto-format on this sync
      cancelScheduledAutoFormat(scheduleState);
      applyEdit(newContent);
    }
  });

  /**
   * applyEdit: apply new content using minimal incremental edits to preserve cursor position.
   * Uses computeMinimalEdits to generate the smallest set of edits, then applies via
   * pushEditOperations so Monaco can automatically maintain cursor/selection positions.
   */
  function applyEdit(newContent) {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    const oldContent = model.getValue();
    if (oldContent === newContent) return;

    __applyingEdit = true;
    try {
      let usedAsync = false;
      const useWorker = (oldContent && oldContent.length > (WORKER_OFFLOAD_CHARS || 0)) || (newContent && newContent.length > (WORKER_OFFLOAD_CHARS || 0));
      if (useWorker && typeof computeMinimalEditsAsync === 'function') {
        usedAsync = true;
        // Offload expensive diff computation to a worker; apply edits when ready.
        computeMinimalEditsAsync(oldContent, newContent, monaco).then((edits) => {
          try {
            if (!edits || edits.length === 0) return;
            const selections = editor.getSelections() || [];
            model.pushEditOperations(selections, edits, () => null);
          } catch (e) {
            // fallback to synchronous path if applying edits failed
            try {
              const fallbackEdits = computeMinimalEdits(oldContent, newContent, monaco);
              if (fallbackEdits && fallbackEdits.length) {
                const selections = editor.getSelections() || [];
                model.pushEditOperations(selections, fallbackEdits, () => null);
              }
            } catch (_) {}
          }
        }).finally(() => {
          // allow change handlers after microtask
          setTimeout(() => { __applyingEdit = false; }, 0);
        });
        if (usedAsync) return;
      }

      // synchronous small-doc path
      const edits = computeMinimalEdits(oldContent, newContent, monaco);
      if (edits.length === 0) return;

      const selections = editor.getSelections() || [];
      model.pushEditOperations(
        selections,
        edits,
        () => null // let Monaco compute cursor positions from the edits
      );
    } finally {
      // if we used async worker path, the worker promise finalizer clears __applyingEdit;
      // otherwise clear for the synchronous path.
      if (typeof usedAsync !== 'undefined' && usedAsync) {
        // do not clear here; the async path clears it in its own finally
      } else {
        setTimeout(() => { __applyingEdit = false; }, 0);
      }
    }
  }

function getJsoniumThemeVars(mode = 'light') {
  // 获取页面根节点的 CSS 变量校准
  const computed = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : { getPropertyValue: () => '' };
  // fallback 颜色
  if (mode === 'light') {
    return {
      bg: computed.getPropertyValue('--color-bg-primary')?.trim() || '#eff1f5',
      fg: computed.getPropertyValue('--color-text-primary')?.trim() || '#4c4f69'
    };
  } else {
    return {
      bg: computed.getPropertyValue('--color-bg-primary')?.trim() || '#24273a',
      fg: computed.getPropertyValue('--color-text-primary')?.trim() || '#cad3f5'
    };
  }
}

function defineAndSetMonacoTheme(monaco, mode) {
  // mode: 'light' | 'dark'
  const { bg, fg } = getJsoniumThemeVars(mode);
  try {
    if (mode === 'light') {
      monaco.editor.defineTheme('jsonium-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': bg,
          'editor.foreground': fg,
          'editor.lineHighlightBackground': '#e3eaff', // 微弱高亮
          'editor.selectionBackground': '#c6a0f645'    // 柔和主色 alpha
        }
      });
    } else {
      monaco.editor.defineTheme('jsonium-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': bg,
          'editor.foreground': fg,
          'editor.lineHighlightBackground': '#363a4f',
          'editor.selectionBackground': '#a6da9540'
        }
      });
    }
    monaco.editor.setTheme(mode === 'light' ? 'jsonium-light' : 'jsonium-dark');
  } catch (e) {}
}

function getCurrentThemeMode() {
  // 返回 light/dark
  const eff = store.getEffectiveTheme();
  return eff?.mode === 'dark' ? 'dark' : 'light';
}

function applyCurrentTheme() {
  if (!monaco) return;
  const mode = getCurrentThemeMode();
  const { bg } = getJsoniumThemeVars(mode);
  try {
    if (editorContainer.value) {
      editorContainer.value.style.background = bg;
    }
    const editorNode = editor && typeof editor.getDomNode === 'function' ? editor.getDomNode() : null;
    if (editorNode && editorNode.style) {
      editorNode.style.background = bg;
    }
  } catch (_) {}
  defineAndSetMonacoTheme(monaco, mode);
  try {
    if (editor && typeof editor.layout === 'function') {
      editor.layout();
    }
  } catch (_) {}
}

function installThemeRefreshListener() {
  if (themeAppliedHandler || typeof window === 'undefined') return;
  themeAppliedHandler = () => {
    try {
      if (themeRefreshRaf && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(themeRefreshRaf);
      }
    } catch (_) {}
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
    } catch (_) {
      applyCurrentTheme();
    }
  };
  try {
    window.addEventListener('jsonium-theme-applied', themeAppliedHandler);
  } catch (_) {}
}

function initEditor() {
    if (!editorContainer.value) return;
    if (!monaco) return; // monaco not available (tests or unsupported env)

    // ---------- 新增：注册主题 ----------
  const mode = getCurrentThemeMode();
    applyCurrentTheme();
    // -----------------------------------

    const settings = store.getEditorSettings();

    // compute initial wrap options based on settings and container width
    const containerWidth = (editorContainer.value && editorContainer.value.clientWidth) || 0;
    let initialWordWrap = settings.wordWrap || 'off';
    let initialWordWrapColumn = settings.wrapColumn || 120;

    if (settings.wrapEnabled && settings.wrapByWidth) {
      try {
        const width = containerWidth || (window.innerWidth || 1200);
        // simple threshold-based decision
        if (typeof settings.wrapThresholdPx === 'number' && width <= settings.wrapThresholdPx) {
          initialWordWrap = 'on';
        } else {
          initialWordWrap = 'off';
        }
        // estimate column based on font size (approx avg char width ~ 0.6 * fontSize)
        const avgCharPx = (settings.fontSize || 14) * 0.6;
        if (avgCharPx > 0) {
          initialWordWrapColumn = Math.max(40, Math.floor(width / avgCharPx));
        }
      } catch (_) { /* ignore and fall back */ }
    } else if (settings.wrapEnabled && !settings.wrapByWidth) {
      // fixed-column wrap mode: enable bounded wrap with explicit column
      initialWordWrap = 'bounded';
      initialWordWrapColumn = settings.wrapColumn || 120;
    }

    editor = monaco.editor.create(editorContainer.value, {
      value: props.content,
      language: 'json',
      theme: mode === 'dark' ? 'jsonium-dark' : 'jsonium-light', // 启动使用自定义主题
      fontSize: settings.fontSize || 14,
      fontFamily: settings.fontFamily || undefined,
      minimap: { enabled: settings.minimap !== false },
      folding: settings.folding !== false,
      lineNumbers: settings.lineNumbers !== false ? 'on' : 'off',
      wordWrap: initialWordWrap,
      wordWrapColumn: initialWordWrapColumn,
      automaticLayout: true,
      tabSize: 2,
      insertSpaces: true,
      formatOnPaste: true,
      scrollBeyondLastLine: false,
      'bracketPairColorization.enabled': true
    });

    // Ensure initial wrap reflects current settings immediately
    try { adjustWrap && adjustWrap(); } catch (_) {}

    // helper to adjust wrap on resize
    adjustWrap = () => {
      try {
        if (!editor) return;
        const s = store.getEditorSettings();
        if (!s.wrapEnabled) {
          editor.updateOptions({ wordWrap: 'off' });
          return;
        }
        const width = (editorContainer.value && editorContainer.value.clientWidth) || (window.innerWidth || 1200);
        if (s.wrapByWidth) {
          const shouldWrap = (typeof s.wrapThresholdPx === 'number') ? (width <= s.wrapThresholdPx) : (width <= 900);
          if (shouldWrap) {
            // compute approximate column
            const avgCharPx = (s.fontSize || 14) * 0.6;
            const col = Math.max(40, Math.floor(width / (avgCharPx || 8)));
            editor.updateOptions({ wordWrap: 'bounded', wordWrapColumn: col });
          } else {
            editor.updateOptions({ wordWrap: 'off' });
          }
        } else {
          // use explicit column setting
          const col = s.wrapColumn || 120;
          editor.updateOptions({ wordWrap: 'bounded', wordWrapColumn: col });
        }
      } catch (_) { /* ignore */ }
    };

    // install ResizeObserver to adjust wrap dynamically
    try {
      if (typeof ResizeObserver !== 'undefined' && editorContainer.value) {
        resizeObserver = new ResizeObserver(() => {
          adjustWrap();
        });

  try {
    watch(
      () => store.themePreference,
      () => {
        applyCurrentTheme();
      },
      { deep: true }
    );
  } catch (_) {}
  installThemeRefreshListener();
        resizeObserver.observe(editorContainer.value);
      } else {
        // fallback to window resize
        window.addEventListener('resize', adjustWrap);
      }
    } catch (_) { /* ignore */ }

    // watch editor settings to apply changes immediately (e.g., toggling wrap)
    try {
      try {
        watch(() => store.editorSettings.wrapEnabled, () => { try { adjustWrap && adjustWrap(); } catch (_) {} });
        watch(() => store.editorSettings.wrapByWidth, () => { try { adjustWrap && adjustWrap(); } catch (_) {} });
        watch(() => store.editorSettings.wrapThresholdPx, () => { try { adjustWrap && adjustWrap(); } catch (_) {} });
        watch(() => store.editorSettings.wrapColumn, () => { try { adjustWrap && adjustWrap(); } catch (_) {} });
        // watch font size / family and apply to editor options
        watch(() => store.editorSettings.fontSize, (n) => { try { if (editor) editor.updateOptions({ fontSize: n || 14 }); } catch (_) {} });
        watch(() => store.editorSettings.fontFamily, (f) => { try { if (editor) editor.updateOptions({ fontFamily: f || undefined }); } catch (_) {} });
      } catch (_) {}
    } catch (_) {}

    // track Enter key timestamp to implement an "enter guard" protecting immediate formatting
    editor.onKeyDown((e) => {
      try {
        if (e && e.keyCode === monaco.KeyCode.Enter) {
          lastEnterTs = Date.now();
        }
      } catch (err) {
        // ignore
      }
    });

    // report changes upward; auto-format scheduling handled separately
    editor.onDidChangeModelContent(() => {
      if (__applyingEdit) return;
      const content = editor.getValue();
      emit('change', content);

      if (!props.autoFormat) return;

      // determine idle delay and enter guard from settings (fallback to existing debounceMs)
      const s = store.getEditorSettings();
      const idle = s.idleDelayMs || s.debounceMs || 300;
      const enterGuard = s.enterGuardMs || 0;
      const autoFormatOnEnter = !!s.autoFormatOnEnter;

      if (props.autoFormatOnIdle) {
        const now = Date.now();
        const elapsedSinceEnter = lastEnterTs ? (now - lastEnterTs) : Number.POSITIVE_INFINITY;

        if (!autoFormatOnEnter && lastEnterTs && elapsedSinceEnter < enterGuard) {
          // within enter guard window: schedule after remaining guard + idle to avoid immediate formatting
          const remaining = enterGuard - elapsedSinceEnter;
          const delay = Math.max(remaining + idle, idle);
          scheduleAutoFormat(scheduleState, 'idle', delay, () => {
            formatJson('idle');
          });
        } else {
          // normal idle scheduling
          scheduleAutoFormat(scheduleState, 'idle', idle, () => {
            formatJson('idle');
          });
        }
      }
    });

    // paste handling: run immediate format (after paste applied)
    if (typeof editor.onDidPaste === 'function') {
      editor.onDidPaste(() => {
        if (!props.autoFormat || !props.autoFormatOnPaste) return;
        // run async to allow paste to finish
        setTimeout(() => formatJson('paste'), 0);
      });
    } else {
      // best-effort: listen to DOM paste event as fallback
      const domNode = editor.getDomNode && editor.getDomNode();
      if (domNode) {
        domPasteHandler = () => {
          if (!props.autoFormat || !props.autoFormatOnPaste) return;
          setTimeout(() => formatJson('paste'), 0);
        };
        try { domNode.addEventListener('paste', domPasteHandler); } catch (e) { }
      }
    }

    // formatting shortcut
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
      () => {
        formatJson('manual');
      }
    );

    try {
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF,
        () => { try { formatJson('manual'); } catch (e) { /* ignore */ } }
      );
    } catch (e) { }

    try {
      editor.addAction({
        id: 'json-copy-current',
        label: '复制当前 JSON',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 3.5,
        keybindings: [
          monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyJ,
          monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ
        ],
        run: () => { try { copyCurrentJson(); } catch (e) { /* ignore */ } }
      });
    } catch (e) { }

    try {
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyJ,
        () => { try { copyCurrentJson(); } catch (e) { /* ignore */ } }
      );
    } catch (e) { }

    try {
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ,
        () => { try { copyCurrentJson(); } catch (e) { /* ignore */ } }
      );
    } catch (e) { }

    // editor context menu actions: keep high-frequency operations near the content area
    try {
      editor.addAction({
        id: 'json-format',
        label: '格式化 JSON',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1,
        keybindings: [
          monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
          monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF
        ],
        run: () => { try { formatJson('manual'); } catch (e) { /* ignore */ } }
      });
    } catch (e) { }

    try {
      editor.addAction({
        id: 'json-escape',
        label: '转义 JSON 字符串',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 2,
        run: () => { try { escapeCurrentDocument(); } catch (e) { /* ignore */ } }
      });
    } catch (e) { }

    try {
      editor.addAction({
        id: 'json-unescape',
        label: '反转义 JSON 字符串',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 3,
        run: () => { try { unescapeCurrentDocument(); } catch (e) { /* ignore */ } }
      });
  } catch (e) { }

  try {
    editor.addAction({
      id: 'copy-jsonpath',
      label: '复制当前 JSONPath',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 4.5,
      run: () => { try { copyCurrentPath('jsonpath'); } catch (e) { /* ignore */ } }
    });
  } catch (e) { }

  try {
    editor.addAction({
      id: 'copy-jqpath',
      label: '复制当前 jq',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 4.6,
      run: () => { try { copyCurrentPath('jq'); } catch (e) { /* ignore */ } }
      });
    } catch (e) { }

    // copy actions: prefer addAction with keybindings (more reliable)
    try {
      editor.addAction({
        id: 'copy-singleline',
        label: '复制为单行',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 4,
        keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyC],
        run: () => { try { copyAsSingleLine(); } catch (e) { /* ignore */ } }
      });
    } catch (e) { }

    try {
      editor.addAction({
        id: 'copy-escaped',
        label: '复制为转义字符串',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 5,
        keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.Backslash],
        run: () => { try { copyAsEscapedString(); } catch (e) { /* ignore */ } }
      });
    } catch (e) { }

    // also register alternative bindings for platforms where Alt+Shift isn't delivered reliably
    try {
      editor.addAction({
        id: 'copy-singleline-cmd',
        label: 'Copy as single line (Cmd/Ctrl fallback)',
        keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC],
        run: () => { try { copyAsSingleLine(); } catch (e) { /* ignore */ } }
      });
    } catch (e) { }

    try {
      editor.addAction({
        id: 'copy-escaped-cmd',
        label: 'Copy as escaped string (Cmd/Ctrl fallback)',
        keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backslash],
        run: () => { try { copyAsEscapedString(); } catch (e) { /* ignore */ } }
      });
    } catch (e) { }

    // also register Monaco commands as fallback (some environments handle addCommand better)
    try {
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyC,
        () => { try { copyAsSingleLine(); } catch (e) { /* ignore */ } }
      );
    } catch (e) { }

    try {
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.Backslash,
        () => { try { copyAsEscapedString(); } catch (e) { /* ignore */ } }
      );
    } catch (e) { }

    // register Cmd/Ctrl+Shift fallbacks too
    try {
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC,
        () => { try { copyAsSingleLine(); } catch (e) { /* ignore */ } }
      );
    } catch (e) { }

    try {
      editor.addCommand(
        monaco.KeyMod.Shift | monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backslash,
        () => { try { copyAsEscapedString(); } catch (e) { /* ignore */ } }
      );
    } catch (e) { }

    // fallback keydown listener: attach on editor DOM (capture) and window as fallback
    domKeydownHandler = (e) => {
      try {
        if (showEditorContextMenu.value && e.key === 'Escape') {
          hideEditorContextMenu();
          return;
        }

        const domNode = editor && editor.getDomNode && editor.getDomNode();
        // allow if event originates inside editor DOM (cover nested nodes) OR editor has focus
        const originatedInEditor = domNode && e.target && domNode.contains(e.target);
        const editorFocused = editor && typeof editor.hasTextFocus === 'function' && editor.hasTextFocus();
        // also consider document.activeElement residing inside editor DOM (covers some focus edge-cases)
        let activeInEditor = false;
        try {
          const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
          activeInEditor = !!(activeEl && domNode && domNode.contains(activeEl));
        } catch (_) { }
        if (!originatedInEditor && !editorFocused && !activeInEditor) return;

        const isShift = !!e.shiftKey;
        let isAlt = !!e.altKey;
        try {
          if (!isAlt && e.getModifierState) {
            isAlt = !!(e.getModifierState('Alt') || e.getModifierState('AltGraph'));
          }
        } catch (_) { }
        // debug log to help diagnose missing single-line shortcut
        if (isShift && (isAlt || e.metaKey || e.ctrlKey || modifierState.alt || modifierState.meta || modifierState.ctrl)) {
          const code = e.code || '';
          const key = e.key || '';
          // eslint-disable-next-line no-console
          console.debug('[Editor] domKeydown', { code, key, altKey: isAlt, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, activeInEditor, modifierState });
          // allow either Alt+Shift or Cmd/Ctrl+Shift as trigger (fallback)
          if (!e.ctrlKey && !e.metaKey && !modifierState.ctrl && !modifierState.meta) {
            // Alt+Shift path
            if (code === 'KeyF' || key === 'f' || key === 'F') {
              e.preventDefault();
              try { formatJson('manual'); } catch (_) { /* ignore */ }
            } else if (code === 'KeyJ' || key === 'j' || key === 'J') {
              e.preventDefault();
              try { copyCurrentJson(); } catch (_) { /* ignore */ }
            } else if (code === 'KeyC' || key === 'c' || key === 'C') {
              e.preventDefault();
              try { copyAsSingleLine(); } catch (_) { /* ignore */ }
            } else if (code === 'Backslash' || key === '\\' || key === 'IntlBackslash') {
              e.preventDefault();
              try { copyAsEscapedString(); } catch (_) { /* ignore */ }
            }
          } else {
            // Cmd/Ctrl+Shift fallback
            if (code === 'KeyF' || key === 'f' || key === 'F') {
              e.preventDefault();
              try { formatJson('manual'); } catch (_) { /* ignore */ }
            } else if (code === 'KeyJ' || key === 'j' || key === 'J') {
              e.preventDefault();
              try { copyCurrentJson(); } catch (_) { /* ignore */ }
            } else if (code === 'KeyC' || key === 'c' || key === 'C') {
              e.preventDefault();
              try { copyAsSingleLine(); } catch (_) { /* ignore */ }
            } else if (code === 'Backslash' || key === '\\' || key === 'IntlBackslash') {
              e.preventDefault();
              try { copyAsEscapedString(); } catch (_) { /* ignore */ }
            }
          }
        }
      } catch (err) {
        // ignore
      }
    };
    // prefer attaching on editor DOM with capture to intercept before Monaco stops propagation
    try {
      const root = editor && editor.getDomNode && editor.getDomNode();
      if (root && root.addEventListener) {
        try { root.addEventListener('keydown', domKeydownHandler, true); } catch (e) { }
        try { root.addEventListener('contextmenu', handleEditorContextMenu, true); } catch (e) { }
      }
    } catch (e) { }
    // keep a window fallback as well
    try { window.addEventListener('keydown', domKeydownHandler); } catch (e) { }
    // register modifier handlers to track Alt/Shift pressed state across separate events
    try { window.addEventListener('keydown', modifierHandler); } catch (e) { }
    try { window.addEventListener('keyup', modifierHandler); } catch (e) { }
  }

  /**
   * formatJson: unified formatting entry.
   * Delegates to runEditorFormat which uses the registered formatting provider (incremental edits)
   * or falls back to computing minimal edits manually.
   * reason: 'manual' | 'idle' | 'paste' | 'external-sync'
   */
  async function formatJson(reason = 'manual') {
    if (!editor) return;
    // prevent scheduling conflicts when user explicitly requests format
    cancelScheduledAutoFormat(scheduleState);

    try {
      await runEditorFormat(editor, {
        fallbackFormatter: formatJsonString,
        reason,
        allowFallback: true,
        monacoInstance: monaco
      });
    } catch (e) {
      // swallow formatting errors to avoid interrupting user input
      // eslint-disable-next-line no-console
      console.warn('formatJson failed quietly', e);
    }
  }

  function getSelectionOrFull() {
    if (!editor) return '';
    try {
      const sel = editor.getSelection && editor.getSelection();
      if (sel && typeof sel.isEmpty === 'function' && !sel.isEmpty()) {
        const model = editor.getModel && editor.getModel();
        if (model && typeof model.getValueInRange === 'function') {
          return model.getValueInRange(sel);
        }
      }

      // Fallback: try DOM selection inside the editor DOM (handles some platforms/bindings)
      try {
        const domNode = editor.getDomNode && editor.getDomNode();
        const domSel = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
        if (domSel && domSel.rangeCount > 0 && domNode && domNode.contains(domSel.anchorNode)) {
          const s = domSel.toString();
          if (s && s.length > 0) return s;
        }
      } catch (_) { }

      // final fallback: full editor content
      return editor.getValue();
    } catch (e) {
      return editor.getValue ? editor.getValue() : '';
    }
  }

    async function copyToClipboard(text) {
    if (text === null || text === undefined) return false;

    // respect preserveWhitespaceOnCopy setting: remove whitespace only if disabled
    const preserve = store && store.editorSettings && store.editorSettings.preserveWhitespaceOnCopy;
    const payload = preserve ? String(text) : String(text).replace(/\s+/g, '');

    // Prefer uTools API when available (ensures copy works inside utools environment)
    try {
      if (typeof window !== 'undefined' && window.utools && typeof window.utools.copyText === 'function') {
        try {
          window.utools.copyText(payload);
          // eslint-disable-next-line no-console
          console.debug('[Editor] copyToClipboard via utools.copyText', { textSample: payload.slice(0, 200) });
          return true;
        } catch (e) {
          // fall through to other methods
          // eslint-disable-next-line no-console
          console.warn('[Editor] utools.copyText failed, falling back', e);
        }
      }
    } catch (_) { }

    // Try navigator.clipboard
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(payload);
        // eslint-disable-next-line no-console
        console.debug('[Editor] copyToClipboard via navigator.clipboard', { textSample: String(payload).slice(0, 200) });
        return true;
      }
    } catch (e) {
      // fall through to fallback
    }

    // Fallback to execCommand approach
    try {
      const ta = document.createElement('textarea');
      ta.value = payload;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      // eslint-disable-next-line no-console
      console.debug('[Editor] copyToClipboard via execCommand', { textSample: String(payload).slice(0, 200) });
      return true;
    } catch (e) {
      // emit error for UI feedback (both Vue emit and global window event)
      try { emit('copy-error', { reason: e && e.message ? e.message : 'clipboard-failed' }); } catch (_) { }
      try { window.dispatchEvent(new CustomEvent('editor-copy-error', { detail: { reason: e && e.message ? e.message : 'clipboard-failed' } })); } catch (_) { }
      return false;
    }
  }

  async function copyRawTextToClipboard(text) {
    if (text === null || text === undefined) return false;

    try {
      if (typeof window !== 'undefined' && window.utools && typeof window.utools.copyText === 'function') {
        window.utools.copyText(String(text));
        return true;
      }
    } catch (_) { }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(String(text));
        return true;
      }
    } catch (_) { }

    try {
      const ta = document.createElement('textarea');
      ta.value = String(text);
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e) {
      try { emit('copy-error', { reason: e && e.message ? e.message : 'clipboard-failed' }); } catch (_) { }
      try { window.dispatchEvent(new CustomEvent('editor-copy-error', { detail: { reason: e && e.message ? e.message : 'clipboard-failed' } })); } catch (_) { }
      return false;
    }
  }

  function getFullEditorText() {
    try {
      const model = editor && editor.getModel && editor.getModel();
      if (model && typeof model.getValue === 'function') {
        return model.getValue();
      }
    } catch (_) { }

    try {
      return editor && typeof editor.getValue === 'function' ? editor.getValue() : '';
    } catch (_) {
      return '';
    }
  }

  function escapeWholeDocument(text) {
    const parsed = JSON.parse(String(text));
    return JSON.stringify(JSON.stringify(parsed));
  }

  function unescapeWholeDocument(text) {
    const parsed = JSON.parse(String(text));
    const source = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    const unescaped = JSON.parse(source);
    return JSON.stringify(unescaped, null, 2);
  }

  async function escapeCurrentDocument() {
    if (!editor) return;
    try {
      const source = getFullEditorText();
      if (!source || !String(source).trim()) {
        notify.warn('请输入 JSON 内容');
        return;
      }
      const escaped = escapeWholeDocument(source);
      applyEdit(escaped);
    } catch (e) {
      notify.error('转义失败: ' + (e && e.message ? e.message : String(e)));
    }
  }

  async function unescapeCurrentDocument() {
    if (!editor) return;
    try {
      const source = getFullEditorText();
      if (!source || !String(source).trim()) {
        notify.warn('请输入 JSON 内容');
        return;
      }

      let unescaped;
      try {
        unescaped = unescapeWholeDocument(source);
      } catch (_) {
        const parsed = JSON.parse(JSON.parse(String(source)));
        unescaped = JSON.stringify(parsed, null, 2);
      }

      applyEdit(unescaped);
    } catch (e) {
      notify.error('反转义失败: ' + (e && e.message ? e.message : String(e)));
    }
  }

  async function copyCurrentPath(kind) {
    if (!editor) return;

    try {
      const model = editor.getModel && editor.getModel();
      if (!model || typeof model.getValue !== 'function') {
        notify.error('无法读取编辑器内容');
        return;
      }

      const text = model.getValue();
      const selection = editor.getSelection && editor.getSelection();
      const position = editor.getPosition && editor.getPosition();
      let result = null;

      if (selection && typeof selection.isEmpty === 'function' && !selection.isEmpty()) {
        const selectionStart = typeof model.getOffsetAt === 'function' ? model.getOffsetAt(selection.getStartPosition()) : null;
        const selectionEnd = typeof model.getOffsetAt === 'function' ? model.getOffsetAt(selection.getEndPosition()) : null;
        result = extractPathFromText(text, {
          selectionStart,
          selectionEnd
        });

        if (result && result.success && result.nodeType === 'document') {
          const fullSelection = selectionStart === 0 && selectionEnd === text.length;
          if (!fullSelection) {
            result = null;
          }
        }
      }

      if (!result || !result.success) {
        result = extractPathFromText(text, {
          cursorOffset: position && typeof model.getOffsetAt === 'function' ? model.getOffsetAt(position) : null
        });
      }

      if (!result || !result.success) {
        notify.error(result?.error || '无法提取路径');
        return;
      }

      const value = kind === 'jq' ? result.jq : result.jsonpath;
      const ok = await copyRawTextToClipboard(value);
      if (!ok) {
        notify.error('复制路径失败');
        return;
      }

      notify.success(kind === 'jq' ? '已复制 jq' : '已复制 JSONPath');
    } catch (e) {
      notify.error('提取路径失败: ' + (e && e.message ? e.message : String(e)));
    }
  }

  async function copyCurrentJson() {
    if (!editor) return;

    if (copyingLock) {
      return;
    }
    copyingLock = true;

    try {
      try {
        const now = Date.now();
        if (now - lastCopyTs < 300) {
          return;
        }
        lastCopyTs = now;
      } catch (_) { }

      const text = getFullEditorText();
      if (!text) {
        notify.error('当前内容为空');
        return;
      }

      const formatted = formatJsonString(text);
      const ok = await copyRawTextToClipboard(formatted);
      if (!ok) {
        notify.error('复制当前 JSON 失败');
        return;
      }

      notify.success('已复制当前 JSON');
    } catch (e) {
      notify.error('复制当前 JSON 失败: ' + (e && e.message ? e.message : String(e)));
    } finally {
      copyingLock = false;
    }
  }

  async function copyAsSingleLine() {
    // prevent overlapping copy operations
    if (copyingLock) {
      // eslint-disable-next-line no-console
      console.debug('[Editor] copyAsSingleLine aborted due to copyingLock');
      return;
    }
    copyingLock = true;
    try {
      // avoid duplicate rapid invocations (monaco action + dom fallback both firing)
      try {
        const now = Date.now();
        if (now - lastCopyTs < 300) {
          // eslint-disable-next-line no-console
          console.debug('[Editor] copyAsSingleLine skipped duplicate');
          return;
        }
        lastCopyTs = now;
      } catch (_) { }

      // robustly obtain text from Monaco model (prefer selection, fallback to full model value)
      let txt = '';
      try {
        const model = editor && editor.getModel && editor.getModel();
        const sel = editor && editor.getSelection && editor.getSelection();
        if (model && sel && typeof sel.isEmpty === 'function' && !sel.isEmpty() && typeof model.getValueInRange === 'function') {
          txt = model.getValueInRange(sel);
        } else if (model && typeof model.getValue === 'function') {
          txt = model.getValue();
        } else if (editor && typeof editor.getValue === 'function') {
          txt = editor.getValue();
        } else {
          txt = getSelectionOrFull() || '';
        }
      } catch (e) {
        txt = getSelectionOrFull() || '';
      }

      let out = '';
      try {
        const parsed = JSON.parse(txt);
        out = JSON.stringify(parsed);
      } catch (e) {
        out = String(txt);
      }
      // apply whitespace preservation setting
      if (!(store && store.editorSettings && store.editorSettings.preserveWhitespaceOnCopy)) {
        out = String(out).replace(/\s+/g, '');
      }

      const ok = await copyToClipboard(out);
      // eslint-disable-next-line no-console
      console.debug('[Editor] copyAsSingleLine', { txtSample: String(txt).slice(0, 200), outSample: String(out).slice(0, 200), ok });
    } finally {
      copyingLock = false;
    }
  }

  async function copyAsEscapedString() {
    // prevent overlapping copy operations
    if (copyingLock) {
      // eslint-disable-next-line no-console
      console.debug('[Editor] copyAsEscapedString aborted due to copyingLock');
      return;
    }
    copyingLock = true;
    try {
      // avoid duplicate rapid invocations
      try {
        const now = Date.now();
        if (now - lastCopyTs < 300) {
          // eslint-disable-next-line no-console
          console.debug('[Editor] copyAsEscapedString skipped duplicate');
          return;
        }
        lastCopyTs = now;
      } catch (_) { }

      // robustly obtain text from Monaco model (prefer selection, fallback to full model value)
      let txt = '';
      try {
        const model = editor && editor.getModel && editor.getModel();
        const sel = editor && editor.getSelection && editor.getSelection();
        if (model && sel && typeof sel.isEmpty === 'function' && !sel.isEmpty() && typeof model.getValueInRange === 'function') {
          txt = model.getValueInRange(sel);
        } else if (model && typeof model.getValue === 'function') {
          txt = model.getValue();
        } else if (editor && typeof editor.getValue === 'function') {
          txt = editor.getValue();
        } else {
          txt = getSelectionOrFull() || '';
        }
      } catch (e) {
        txt = getSelectionOrFull() || '';
      }

      let compactJsonText;
      try {
        const parsed = JSON.parse(txt);
        compactJsonText = JSON.stringify(parsed);
      } catch (e) {
        compactJsonText = String(txt)
          .replace(/\r?\n/g, '')
          .replace(/\t/g, '');
      }

      let out;
      try {
        out = JSON.stringify(compactJsonText);
      } catch (e) {
        out = '"' + String(compactJsonText)
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\r/g, '\\r')
          .replace(/\n/g, '\\n')
          .replace(/\t/g, '\\t') + '"';
      }
      const ok = await copyToClipboard(out);
      // eslint-disable-next-line no-console
      console.debug('[Editor] copyAsEscapedString', { txtSample: String(txt).slice(0, 200), outSample: String(out).slice(0, 200), ok });
    } finally {
      copyingLock = false;
    }
  }

  async function unescapeSelectionOrContent() {
    if (copyingLock) {
      // eslint-disable-next-line no-console
      console.debug('[Editor] unescapeSelectionOrContent aborted due to copyingLock');
      return;
    }
    copyingLock = true;
    try {
      let txt = '';
      try {
        const model = editor && editor.getModel && editor.getModel();
        const sel = editor && editor.getSelection && editor.getSelection();
        if (model && sel && typeof sel.isEmpty === 'function' && !sel.isEmpty() && typeof model.getValueInRange === 'function') {
          txt = model.getValueInRange(sel);
        } else if (model && typeof model.getValue === 'function') {
          txt = model.getValue();
        } else if (editor && typeof editor.getValue === 'function') {
          txt = editor.getValue();
        } else {
          txt = getSelectionOrFull() || '';
        }
      } catch (e) {
        txt = getSelectionOrFull() || '';
      }

      let out = txt;
      try {
        const parsed = JSON.parse(String(txt));
        out = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
      } catch (e) {
        try {
          const parsed = JSON.parse(JSON.parse(String(txt)));
          out = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
        } catch (_) {
          out = String(txt);
        }
      }

      const ok = await copyToClipboard(out);
      // eslint-disable-next-line no-console
      console.debug('[Editor] unescapeSelectionOrContent', { txtSample: String(txt).slice(0, 200), outSample: String(out).slice(0, 200), ok });
    } finally {
      copyingLock = false;
    }
  }

  // expose minimal API to parent components
  defineExpose({
    getContent: () => editor?.getValue() || '',
    setContent: (content) => applyEdit(content),
    format: formatJson,
    focus: () => { try { editor && typeof editor.focus === 'function' && editor.focus(); } catch (_) {} }
  });
</script>

<template>
  <div class="editor-wrapper">
    <div ref="editorContainer" class="editor-container"></div>
  </div>

  <teleport to="body">
    <div v-if="showEditorContextMenu" ref="editorContextMenuRef" class="editor-context-menu"
      :style="editorContextMenuStyles" @click.stop>
      <button class="editor-context-menu__item" type="button" @click="handleEditorContextMenuAction('format')">
        <span class="editor-context-menu__label">格式化 JSON</span>
        <span class="editor-context-menu__hint">Shift + Alt + F</span>
      </button>
      <button class="editor-context-menu__item" type="button" @click="handleEditorContextMenuAction('escape')">
        <span class="editor-context-menu__label">转义 JSON 字符串</span>
      </button>
      <button class="editor-context-menu__item" type="button" @click="handleEditorContextMenuAction('unescape')">
        <span class="editor-context-menu__label">反转义 JSON 字符串</span>
      </button>
      <button class="editor-context-menu__item" type="button" @click="handleEditorContextMenuAction('copy-json')">
        <span class="editor-context-menu__label">复制当前 JSON</span>
      </button>
      <div class="editor-context-menu__divider"></div>
      <button class="editor-context-menu__item" type="button" @click="handleEditorContextMenuAction('jsonpath')">
        <span class="editor-context-menu__label">复制当前 JSONPath</span>
      </button>
      <button class="editor-context-menu__item" type="button" @click="handleEditorContextMenuAction('jq')">
        <span class="editor-context-menu__label">复制当前 jq</span>
      </button>
    </div>
  </teleport>
</template>

<style scoped>
  .editor-wrapper {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-primary);
  }

  .editor-container {
    flex: 1;
    border: none;
    background: var(--color-bg-primary);
    /* 防止父布局收缩导致编辑器高度为 0 的问题，设置一个保底高度 */
    min-height: 240px;
  }

  .editor-context-menu {
    position: fixed;
    z-index: 300000;
    min-width: 220px;
    padding: 6px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-bg-primary);
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
    backdrop-filter: blur(10px);
  }

  .editor-context-menu__item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--color-text-primary);
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .editor-context-menu__item:hover,
  .editor-context-menu__item:focus-visible {
    background: var(--color-hover-bg);
    color: var(--color-primary);
    outline: none;
  }

  .editor-context-menu__label {
    font-size: var(--font-size-xs);
    line-height: 1.2;
    white-space: nowrap;
  }

  .editor-context-menu__hint {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .editor-context-menu__divider {
    height: 1px;
    margin: 6px 4px;
    background: var(--color-divider);
  }
</style>