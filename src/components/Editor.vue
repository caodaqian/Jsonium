<script setup>
  let monaco = null;
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import {
    cancelScheduledAutoFormat,
    computeMinimalEdits,
    formatJsonString,
    registerJsonFormattingProvider,
    runEditorFormat,
    scheduleAutoFormat
  } from '../services/editorFormatting.js';
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
  let editor = null;
  let __applyingEdit = false;
  let domKeydownHandler = null;
  let modifierState = { shift: false, alt: false, ctrl: false, meta: false };
  let lastCopyTs = 0; // short guard to avoid duplicate rapid copy invocations
  let copyingLock = false; // prevent overlapping copy ops
  let resizeObserver = null;
  let adjustWrap = null;

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
          window.MonacoEnvironment = window.MonacoEnvironment || {};
          window.MonacoEnvironment.getWorker = function (moduleId, label) {
            try {
              const env = window.MonacoEnvironment || {};
              if (typeof env.getWorkerUrl === 'function') {
                try {
                  const url = env.getWorkerUrl(moduleId, label);
                  return new Worker(url);
                } catch (e) {
                  // fall through to other strategies
                }
              }
              if (typeof env.getWorker === 'function') {
                try { return env.getWorker(moduleId, label); } catch (_) { /* fallthrough */ }
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
        }
      } catch (e) { /* ignore injection failures */ }

      // 加载 Monaco CSS（容错）
      try { await import('monaco-editor/min/vs/editor/editor.main.css'); } catch (_) { /* ignore */ }

      // 优先加载 ESM 编辑器 API（兼容 vite 的打包方式）
      try {
        const m = await import('monaco-editor/esm/vs/editor/editor.api');
        monaco = m && Object.keys(m).length ? m : (window.monaco || null);
      } catch (e) {
        // 回退到常规包（部分环境下可用）
        try {
          const m2 = await import('monaco-editor');
          monaco = m2 && m2.editor ? m2 : (window.monaco || null);
        } catch (e2) {
          monaco = window.monaco || null;
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

  onBeforeUnmount(() => {
    cancelScheduledAutoFormat(scheduleState);
    try {
      // remove modifier listeners
      try { window.removeEventListener('keydown', modifierHandler); } catch (e) { }
      try { window.removeEventListener('keyup', modifierHandler); } catch (e) { }
      if (editor) {
        // remove both window listener (added as fallback) and any dom listener if present
        try { window.removeEventListener('keydown', domKeydownHandler); } catch (e) { }
        const domNode = editor.getDomNode && editor.getDomNode();
        if (domNode && domKeydownHandler) {
          try { domNode.removeEventListener('keydown', domKeydownHandler, true); } catch (e) { }
          try { domNode.removeEventListener('keydown', domKeydownHandler); } catch (e) { }
        }
        domKeydownHandler = null;
        editor.dispose && editor.dispose();
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
      const edits = computeMinimalEdits(oldContent, newContent, monaco);
      if (edits.length === 0) return;

      const selections = editor.getSelections() || [];
      model.pushEditOperations(
        selections,
        edits,
        () => null // let Monaco compute cursor positions from the edits
      );
    } finally {
      // allow change handlers after microtask
      setTimeout(() => { __applyingEdit = false; }, 0);
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

function initEditor() {
    if (!editorContainer.value) return;
    if (!monaco) return; // monaco not available (tests or unsupported env)

    // ---------- 新增：注册主题 ----------
    const mode = getCurrentThemeMode();
    defineAndSetMonacoTheme(monaco, mode);
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

  // ========== 新增：watch 主题切换，动态 setTheme ==========
  try {
    watch(
      () => store.themePreference,
      () => {
        const mode = getCurrentThemeMode();
        defineAndSetMonacoTheme(monaco, mode); // 重新注册并切换
      },
      { deep: true }
    );
  } catch (_) {}
  // =====================================================
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
        domNode.addEventListener('paste', () => {
          if (!props.autoFormat || !props.autoFormatOnPaste) return;
          setTimeout(() => formatJson('paste'), 0);
        });
      }
    }

    // formatting shortcut
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
      () => {
        formatJson('manual');
      }
    );

    // editor context menu actions: keep high-frequency operations near the content area
    try {
      editor.addAction({
        id: 'json-format',
        label: '格式化 JSON',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1,
        keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
        run: () => { try { formatJson('manual'); } catch (e) { /* ignore */ } }
      });
    } catch (e) { }

    try {
      editor.addAction({
        id: 'json-escape',
        label: '转义 JSON 字符串',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 2,
        run: () => { try { copyAsEscapedString(); } catch (e) { /* ignore */ } }
      });
    } catch (e) { }

    try {
      editor.addAction({
        id: 'json-unescape',
        label: '反转义 JSON 字符串',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 3,
        run: () => { try { unescapeSelectionOrContent(); } catch (e) { /* ignore */ } }
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
            if (code === 'KeyC' || key === 'c' || key === 'C') {
              e.preventDefault();
              try { copyAsSingleLine(); } catch (_) { /* ignore */ }
            } else if (code === 'Backslash' || key === '\\' || key === 'IntlBackslash') {
              e.preventDefault();
              try { copyAsEscapedString(); } catch (_) { /* ignore */ }
            }
          } else {
            // Cmd/Ctrl+Shift fallback
            if (code === 'KeyC' || key === 'c' || key === 'C') {
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

      let out;
      try {
        out = JSON.stringify(txt);
      } catch (e) {
        out = '"' + String(txt)
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\r/g, '\\r')
          .replace(/\n/g, '\\n')
          .replace(/\t/g, '\\t') + '"';
      }
      // apply whitespace preservation setting
      if (!(store && store.editorSettings && store.editorSettings.preserveWhitespaceOnCopy)) {
        out = String(out).replace(/\s+/g, '');
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
</style>