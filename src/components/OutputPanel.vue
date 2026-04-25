<script setup>
import * as monacoModule from 'monaco-editor';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { detectAndConvert } from '../services/formatDetector.js';
import notify from '../services/notify.js';
import { useJsonStore } from '../store/index.js';
import { getStringifyIndent } from '../utils/indent.js';
import DiffView from './DiffView.vue';

const store = useJsonStore();

const outputTabs = ['jsonpath', 'jq', 'diff'];

const tabLabels = {
  jsonpath: '🔍 JSONPath',
  jq: '🌀 jq',
  diff: '⚖️ 对比'
};

const currentPanel = computed(() => store.outputPanel.content[store.outputPanel.currentTab]);
const monacoContainer = ref(null);
const monacoLoadFailed = ref(false);

let monaco = null;
let monacoEditor = null;
let monacoThemeMediaQuery = null;

const formattedContent = computed(() => {
  const entry = currentPanel.value;
  if (!entry) return '';
  if (entry.error) return entry.error;
  if (entry.value === null || entry.value === undefined) return '';
  if (typeof entry.value === 'string') {
    return entry.value;
  }
  return JSON.stringify(entry.value, null, getStringifyIndent());
});

const monacoContent = computed(() => {
  const entry = currentPanel.value;
  if (!entry || entry.error || entry.value === null || entry.value === undefined) {
    return '';
  }
  if (typeof entry.value === 'string') {
    return JSON.stringify(entry.value, null, getStringifyIndent());
  }
  return JSON.stringify(entry.value, null, getStringifyIndent());
});

const hasContent = computed(() => {
  const entry = currentPanel.value;
  if (!entry) return false;
  return entry.error !== null || entry.value !== null;
});

const isError = computed(() => {
  const entry = currentPanel.value;
  return entry && entry.error !== null && entry.error !== undefined;
});

const shouldUseMonaco = computed(() => {
  return (
    store.outputPanel.currentTab !== 'diff'
    && hasContent.value
    && !isError.value
    && !monacoLoadFailed.value
  );
});

const getPreferredMonacoTheme = () => {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const mode = root?.dataset?.themeMode;
    if (mode === 'dark') return 'vs-dark';
    if (mode === 'light') return 'vs';
  }

  const mediaQuery = globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)');
  if (mediaQuery?.matches) {
    return 'vs-dark';
  }

  return 'vs';
};

const applyMonacoTheme = () => {
  if (!monaco?.editor || typeof monaco.editor.setTheme !== 'function') {
    return;
  }
  monaco.editor.setTheme(getPreferredMonacoTheme());
};

const disposeMonaco = () => {
  if (monacoThemeMediaQuery && typeof monacoThemeMediaQuery.removeEventListener === 'function') {
    monacoThemeMediaQuery.removeEventListener('change', applyMonacoTheme);
  }
  monacoThemeMediaQuery = null;
  if (monacoEditor && typeof monacoEditor.dispose === 'function') {
    monacoEditor.dispose();
  }
  monacoEditor = null;
};

const loadMonaco = async () => {
  if (monaco?.editor) {
    return monaco;
  }

  monaco = monacoModule?.default?.editor ? monacoModule.default : monacoModule;
  if (!monaco?.editor) {
    monacoLoadFailed.value = true;
    return null;
  }

  return monaco;
};

const createMonacoViewer = (monacoInstance, value) => {
  applyMonacoTheme();
  monacoEditor = monacoInstance.editor.create(monacoContainer.value, {
    value,
    language: 'json',
    readOnly: true,
    domReadOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    glyphMargin: false,
    folding: true,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    renderLineHighlight: 'none',
    overviewRulerBorder: false,
    wordWrap: 'on'
  });

  const mediaQuery = globalThis.window?.matchMedia?.('(prefers-color-scheme: dark)');
  if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
    monacoThemeMediaQuery = mediaQuery;
    monacoThemeMediaQuery.addEventListener('change', applyMonacoTheme);
  }
};

const updateMonacoViewerValue = (value) => {
  const model = typeof monacoEditor?.getModel === 'function' ? monacoEditor.getModel() : null;
  if (model && typeof model.setValue === 'function') {
    if (typeof model.getValue !== 'function' || model.getValue() !== value) {
      model.setValue(value);
    }
  } else if (typeof monacoEditor?.setValue === 'function') {
    monacoEditor.setValue(value);
  }

  if (typeof monacoEditor?.layout === 'function') {
    monacoEditor.layout();
  }
};

const ensureMonacoViewer = async () => {
  if (!shouldUseMonaco.value) {
    disposeMonaco();
    return;
  }

  await nextTick();
  if (!monacoContainer.value) {
    return;
  }

  const monacoInstance = await loadMonaco();
  if (!monacoInstance?.editor) {
    return;
  }

  const nextValue = monacoContent.value;

  if (!monacoEditor) {
    createMonacoViewer(monacoInstance, nextValue);
    return;
  }

  updateMonacoViewerValue(nextValue);
};

const handleCopyOutput = async () => {
  if (!hasContent.value) return;

  try {
    if (globalThis.window && globalThis.window.utools) {
      globalThis.window.utools.copyText(formattedContent.value);
    } else {
      await navigator.clipboard.writeText(formattedContent.value);
    }
    notify.success('已复制输出内容');
  } catch (e) {
    notify.error('复制失败: ' + e.message);
  }
};

const handleInsertToEditor = async () => {
  if (!hasContent.value) return;
  const entry = currentPanel.value;
  if (!entry) return;
  if (entry.error) {
    notify.warn('无法插入：输出为错误信息');
    return;
  }
  try {
    let contentToWrite = '';
    if (typeof entry.value === 'string') {
      const detected = await detectAndConvert(entry.value);
      if (detected.success) {
        contentToWrite = detected.data;
      } else {
        contentToWrite = entry.value;
      }
    } else {
      contentToWrite = JSON.stringify(entry.value, null, getStringifyIndent());
    }
    const active = store.getActiveTab();
    if (!active) {
      notify.warn('没有打开的主编辑标签');
      return;
    }
    store.updateTabContent(active.id, contentToWrite);
    notify.success('已替换主编辑区内容');
  } catch (e) {
    notify.error('插入失败: ' + e.message);
  }
};

const handleClose = () => {
  store.hideOutputPanel();
};

const switchTab = (tab) => {
  store.switchOutputTab(tab);
};

const diffLeft = computed(() => {
  try {
    return store.diffSidebar.leftContent || store.diffSidebar.leftInput || (store.getActiveTab ? (store.getActiveTab().content || '') : '');
  } catch (e) {
    return store.diffSidebar.leftContent || store.diffSidebar.leftInput || '';
  }
});

const diffRight = computed(() => {
  try {
    return store.diffSidebar.rightContent || (store.getActiveTab ? (store.getActiveTab().content || '') : '');
  } catch (e) {
    return store.diffSidebar.rightContent || '';
  }
});

watch(shouldUseMonaco, () => {
  void ensureMonacoViewer();
});

watch(monacoContent, () => {
  void ensureMonacoViewer();
});

watch(() => store.outputPanel.currentTab, () => {
  void ensureMonacoViewer();
});

onMounted(() => {
  void ensureMonacoViewer();
});

onBeforeUnmount(() => {
  disposeMonaco();
});

</script>

<template>
  <div class="output-panel card card-blur" v-if="store.outputPanel.visible">
    <div class="output-header">
      <div class="output-tabs">
        <button
          v-for="tab in outputTabs"
          :key="tab"
          :class="['output-tab', { active: store.outputPanel.currentTab === tab }]"
          @click="switchTab(tab)"
        >
          {{ tabLabels[tab] }}
        </button>
      </div>
      <button class="output-close" @click="handleClose" title="关闭">✕</button>
    </div>

    <div v-if="store.outputPanel.currentTab === 'diff'">
      <div class="diff-panel-wrapper" style="display:flex;flex-direction:column;height:100%">
        <DiffView :leftContent="diffLeft" :rightContent="diffRight" />
        <div class="output-actions">
          <button @click="handleCopyOutput" class="output-action-btn">
            📋 复制
          </button>
          <button @click="handleInsertToEditor" class="output-action-btn" title="替换主编辑区">
            🔁 替换主编辑区
          </button>
        </div>
      </div>
    </div>

    <div class="output-content" v-else-if="hasContent">
      <div v-if="shouldUseMonaco" ref="monacoContainer" class="output-monaco"></div>
      <pre v-else :class="['output-text', { 'is-error': isError }]">{{ formattedContent }}</pre>
      <div class="output-actions">
        <button @click="handleCopyOutput" class="output-action-btn">
          📋 复制
        </button>
        <button @click="handleInsertToEditor" class="output-action-btn" title="替换主编辑区">
          🔁 替换主编辑区
        </button>
      </div>
    </div>

    <div class="output-empty" v-else>
      <p>暂无输出内容</p>
    </div>
  </div>
</template>

<style scoped>
.output-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-primary);
  border-left: 1px solid var(--color-divider);
  overflow: hidden;
    box-shadow: none;

}

.output-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-divider);
  flex-shrink: 0;
  gap: var(--spacing-md);
}

.output-tabs {
  display: flex;
  gap: var(--spacing-sm);
  flex: 1;
  overflow-x: auto;
  min-width: 0;
}

.output-tab {
    padding: 6px 10px;

  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.output-tab:hover {
  background: var(--color-hover-bg);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.output-tab.active {
    background: var(--color-bg-primary);
    color: var(--color-primary);
    border-color: var(--color-divider);

}

.output-close {
  background: none;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  padding: 0;
  font-size: 18px;
  flex-shrink: 0;
  transition: color 0.2s ease;
}

.output-close:hover {
  color: var(--color-error);
}

.output-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.output-monaco {
  flex: 1;
  min-height: 0;
}

.output-text {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: var(--spacing-md);
    background: var(--color-bg-primary);

  color: var(--color-text-primary);
  font-size: 12px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Courier New', monospace;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.output-text.is-error {
  color: var(--color-error, #ef4444);
  background: rgba(239, 68, 68, 0.05);
}

.output-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
  padding: var(--spacing-lg);
}

.output-actions {
  display: flex;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border-top: 1px solid var(--color-divider);
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
}

.output-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
    border-radius: 4px;

  border: 1px solid var(--color-divider);
  background: color-mix(in srgb, var(--color-bg-secondary) 90%, var(--color-bg-primary));
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  transition: transform 160ms ease, border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease, color 160ms ease;
}

.output-action-btn:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-divider));
  background: color-mix(in srgb, var(--color-bg-secondary) 80%, var(--color-primary) 20%);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
}

.output-action-btn:active {
  transform: translateY(0);
  box-shadow: none;
}

.output-action-btn--primary {
  border-color: color-mix(in srgb, var(--color-primary) 42%, var(--color-divider));
    background: color-mix(in srgb, var(--color-primary) 10%, var(--color-bg-primary));
    color: var(--color-primary);

}

.output-action-btn--primary:hover {
  background: color-mix(in srgb, var(--color-primary) 18%, var(--color-bg-secondary));
  border-color: color-mix(in srgb, var(--color-primary) 58%, var(--color-divider));
}

/* Diff panel specific adjustments */
.diff-panel-wrapper { display:flex; flex-direction:column; height:100%; }
.diff-panel-wrapper > .output-actions { border-top: 1px solid var(--color-divider); background: var(--color-bg-secondary); }
.output-panel .diff-view { height: 100%; min-height: 0; border-left: none; }
.output-panel .diff-view .text-area { border-radius: 6px; }

@media (max-width: 900px) {
  .output-actions {
    gap: 8px;
  }

  .output-action-btn {
    padding: 6px 10px;
  }
}
</style>