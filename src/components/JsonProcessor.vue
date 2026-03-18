<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useJsonStore } from '../store/index.js';
import { detectAndConvert, toFormat, FORMAT_TYPES } from '../services/formatDetector.js';
import { convert } from '../services/converter.js';
import { queryJsonPath, queryJq } from '../services/queryEngine.js';
import { getDifferences, buildLineDiffs, buildTreeDiff } from '../services/diffEngine.js';
import { processWithAI } from '../services/aiProcessor.js';
import Editor from './Editor.vue';
import TabBar from './TabBar.vue';
import StatusBar from './StatusBar.vue';
import OutputPanel from './OutputPanel.vue';
import DiffSidebar from './DiffSidebar.vue';
import DiffView from './DiffView.vue';
import { stringifySortedJson } from '../services/diffEngine.js';
import notify from '../services/notify.js';
import { getFormatName } from '../utils/formatNames.js';

const store = useJsonStore();

const displayedTabs = computed(() => {
  const list = (store.tabs && store.tabs.value) ? store.tabs.value : (store.tabs || []);
  const fav = list.filter(t => t.favorited);
  const others = list.filter(t => !t.favorited);
  return [...fav, ...others];
});

function _save() {
  if (typeof store.saveTabsState === 'function') {
    try { store.saveTabsState(); } catch (e) { /* ignore */ }
  }
}

const props = defineProps({
  enterAction: {
    type: Object,
    required: true
  }
});

// UI 状态
const activePanel = ref('editor'); // editor, convert, query, diff, ai
const showLeftPanel = ref(true);
const tabs = computed(() => store.tabs);
const activeTab = computed(() => store.getActiveTab());
const editorRef = ref(null);

// line diff overlay
const showLineDiff = ref(false);
const lineLeft = ref('');
const lineRight = ref('');

function handleOpenLineDiff(left, right) {
  lineLeft.value = left || '';
  lineRight.value = right || '';
  showLineDiff.value = true;
}
function closeLineDiff() {
  showLineDiff.value = false;
  lineLeft.value = '';
  lineRight.value = '';
}

// 初始化
const lastImportedText = ref('');

onMounted(async () => {
  // 尝试从持久化恢复 tabs；若恢复失败则创建初始 tab
  try {
    if (typeof store.loadTabsState === 'function') {
      const restored = await store.loadTabsState();
      if (!restored) {
        ensureInitialTab();
      } else {
        // 启动时尝试清理过期标签（默认 1 天）
        try { if (typeof store.cleanupOldTabs === 'function') store.cleanupOldTabs(1); } catch (_) {}
      }
    } else {
      ensureInitialTab();
    }
  } catch (e) {
    // ignore and fallback
    ensureInitialTab();
  }

  await importEnterAction(props.enterAction);

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', _save);
  }
  if (typeof window !== 'undefined' && window.utools && typeof window.utools.onPluginOut === 'function') {
    try { window.utools.onPluginOut(_save); } catch (e) { /* ignore */ }
  }

  // 全局快捷键：Cmd/Ctrl+W 关闭当前标签、Cmd/Ctrl+N 新建标签
  function globalKeydown(e) {
    try {
      const isCmd = e.metaKey || e.ctrlKey;
      if (!isCmd) return;
      const k = (e.key || '').toLowerCase();
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const editorEl = typeof document !== 'undefined' ? document.querySelector('.editor-container') : null;
      const tabbarEl = typeof document !== 'undefined' ? document.querySelector('.tab-bar') : null;
      const inEditor = editorEl && active && (editorEl.contains(active) || active === editorEl);
      const inTabbar = tabbarEl && active && (tabbarEl.contains(active) || active === tabbarEl);
      const isTextInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (k === 'w') {
        if (inEditor || inTabbar || !isTextInput) {
          e.preventDefault();
          if (store.activeTabId) store.closeTab(store.activeTabId);
        }
      } else if (k === 'n') {
        e.preventDefault();
        store.addTab('{}');
      }
    } catch (_) { /* ignore */ }
  }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('keydown', globalKeydown);
    try { if (typeof window !== 'undefined') window.__jsonium_globalKeydown = globalKeydown; } catch (_) {}
  }
});

onUnmounted(() => {
  // 清理 beforeunload 监听（若已注册）
  if (typeof window !== 'undefined' && window.removeEventListener) {
    try { window.removeEventListener('beforeunload', _save); } catch (e) { /* ignore */ }
    // 清理全局快捷键监听
    try {
      const g = typeof window !== 'undefined' ? window.__jsonium_globalKeydown : null;
      if (g) window.removeEventListener('keydown', g);
      try { window.__jsonium_globalKeydown = null; } catch (_) {}
    } catch (e) { /* ignore */ }
  }
});

watch(() => props.enterAction, async (action) => {
  await importEnterAction(action);
}, { deep: true });

function ensureInitialTab() {
  if (store.tabs.length === 0) {
    store.addTab('{}', '', FORMAT_TYPES.JSON);
  }
}

async function importEnterAction(action) {
  const text = action?.text;
  if (!text || text === lastImportedText.value) {
    return;
  }

  const result = await detectAndConvert(text);
  if (!result.success) {
    return;
  }

  store.addTab(result.data, '导入内容', result.originalFormat);
  activePanel.value = 'editor';
  lastImportedText.value = text;

  await nextTick();
  await nextTick();

  if (editorRef.value && typeof editorRef.value.format === 'function') {
    editorRef.value.format();
  }
}

// 处理编辑器内容变化
const handleEditorChange = (content) => {
  if (activeTab.value) {
    store.updateTabContent(activeTab.value.id, content);
  }
};

 // 底部操作（来自 StatusBar）的处理：委托给 Editor 实例的 format()，以保留光标与最小编辑
const handleBottomFormat = () => {
  if (editorRef.value && typeof editorRef.value.format === 'function') {
    editorRef.value.format();
  }
};

const handleBottomEscape = (escaped) => {
  if (!activeTab.value) return;
  store.updateTabContent(activeTab.value.id, escaped);
  void copyTextToClipboard(escaped);
};

const handleBottomUnescape = (unescaped) => {
  if (!activeTab.value) return;
  store.updateTabContent(activeTab.value.id, unescaped);
  void copyTextToClipboard(unescaped);
};

// 处理文本导入
const handleImportText = async (text) => {
  const result = await detectAndConvert(text);
  if (result.success) {
    store.addTab(result.data, '导入文本', result.originalFormat);
    activePanel.value = 'editor';
  }
};

// 转换格式
const handleConvert = async (targetFormat) => {
  if (!activeTab.value) return;
  
  try {
    const result = await toFormat(activeTab.value.content, targetFormat);
    if (result.success) {
      const formatName = getFormatName(targetFormat);
      store.addTab(result.data, `${activeTab.value.name} - 转为${formatName}`, targetFormat);
    }
  } catch (e) {
    notify.error('转换失败: ' + e.message);
  }
};

// 生成代码
const handleGenerateCode = async (language) => {
  if (!activeTab.value) return;
  
  try {
    const result = convert(activeTab.value.content, language);
    if (result.success) {
      store.addTab(result.data, `${activeTab.value.name} - ${language}`, language);
    }
  } catch (e) {
    notify.error('生成失败: ' + e.message);
  }
};

// 执行查询
const handleQuery = async (expression, type) => {
  if (!activeTab.value) return;
  
  try {
    let result;
    if (type === 'jsonpath') {
      result = queryJsonPath(activeTab.value.content, expression);
    } else {
      result = queryJq(activeTab.value.content, expression);
    }
    
    if (result.success) {
      // 尝试自动解码（转义 JSON / Base64 等），以便展示/写回更友好的内容
      let queryData = result.results;
      if (typeof queryData === 'string') {
        try {
          const detected = await detectAndConvert(queryData);
          if (detected.success) {
            queryData = detected.data;
          }
        } catch (e) {
          // 忽略解码错误，保留原始字符串
        }
      }
      const queryResult = typeof queryData === 'string' ? queryData : JSON.stringify(queryData, null, 2);
      store.addTab(queryResult, `查询结果 - ${type}`, FORMAT_TYPES.JSON);
      store.addQueryHistory(expression, type);
    } else {
      notify.error('查询失败: ' + result.error);
    }
  } catch (e) {
    notify.error('查询失败: ' + e.message);
  }
};

 // 对比 JSON
const handleCompare = async (leftContent, rightContent) => {
  try {
    // 统一约定：leftContent = 待比对 A（侧边栏输入），rightContent = 主编辑区基准 B
    // 场景处理：
    // 1) 若没有基准 B，打开侧栏以便用户先准备（保留 leftContent 作为初始，如果有）
    if (!rightContent?.trim()) {
      store.showDiffSidebar(leftContent || '');
      return;
    }
    // 2) 若没有 leftContent，打开空侧栏让用户输入 A（基准已在主编辑区）
    if (!leftContent?.trim()) {
      store.showDiffSidebar('');
      return;
    }

    // 两个都有内容 - 使用树形 Diff 生成节点级结果并展示
    const sortedLeft = stringifySortedJson(leftContent);
    const sortedRight = stringifySortedJson(rightContent);

    const { tree, stats } = buildTreeDiff(sortedLeft, sortedRight);

    store.setDiffResult(sortedLeft, sortedRight, {
      diffTree: tree,
      diffStats: stats,
      diffLines: []
    });
  } catch (e) {
    notify.error('对比失败: ' + e.message);
    store.showDiffSidebar('');
  }
};

 // AI 处理 JSON
const handleAIProcess = async (instruction, config) => {
  if (!activeTab.value) return;

  // 合并传入配置并写回 store（保持兼容老契约）
  let currentConfig = store.getAIConfig();
  if (config && typeof config === 'object') {
    currentConfig = { ...currentConfig, ...config };
    store.setAIConfig(currentConfig);
  }

  // provider 默认为 utools（本次范围固定）
  if (!currentConfig.provider) currentConfig.provider = 'utools';

  // model 兜底：优先使用传入 model -> store.aiComposer.selectedModel -> aiConfig.model -> 'utools-default'
  currentConfig.model = currentConfig.model || store.aiComposer.selectedModel || store.aiConfig.model || 'utools-default';

  try {
    const result = await processWithAI(activeTab.value.content, instruction, currentConfig);
    if (result.success) {
      store.addTab(result.data, 'AI 处理结果', FORMAT_TYPES.JSON);
    } else {
      notify.error('处理失败: ' + result.error);
    }
  } catch (e) {
    notify.error('处理失败: ' + e.message);
  }
};

// 复制到剪贴板
const copyTextToClipboard = async (text, showFeedback = false) => {
  if (text === null || text === undefined) return false;
  // normalize: remove ALL whitespace characters before copying
  const payload = String(text).replace(/\s+/g, '');

  if (typeof window !== 'undefined' && window.utools) {
    try {
      window.utools.copyText(payload);
      if (showFeedback) {
        notify.success('已复制到剪贴板');
      }
      return true;
    } catch (e) {
      // fall through to navigator fallback
      // eslint-disable-next-line no-console
      console.warn('[JsonProcessor] utools.copyText failed, falling back', e);
    }
  }

  try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(payload);
      if (showFeedback) {
        notify.success('已复制到剪贴板');
      }
      return true;
    }
  } catch {
    // fall through to failure
  }

  if (showFeedback) {
    notify.error('复制失败');
  }
  return false;
};

const handleCopyToClipboard = () => {
  if (!activeTab.value) return;
  void copyTextToClipboard(activeTab.value.content, true);
};

// 下载为文件
const handleDownload = () => {
  if (!activeTab.value) return;
  
  const element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(activeTab.value.content));
  element.setAttribute('download', `${activeTab.value.name || 'data'}.json`);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
};

// 辅助函数
</script>

<template>
  <div class="json-processor">
    <div class="processor-header">
      <h1 class="app-title">Jsonium</h1>
      <TabBar 
        :tabs="displayedTabs" 
        :activeTabId="store.activeTabId"
        @selectTab="(id) => store.setActiveTab(id)"
        @closeTab="(id) => store.closeTab(id)"
        @renameTab="(id, name) => store.updateTabName(id, name)"
        @newTab="() => store.addTab('{}')"
        @toggleFavorite="(id) => store.toggleFavorite(id)"
        @closeOtherTabs="(id) => store.closeOtherTabs(id)"
        @closeAllTabs="() => store.closeAllTabs()"
        @closeLeftTabs="(id) => store.closeLeftTabs(id)"
      />
    </div>
    
    <div class="processor-container" v-if="activeTab">
      <div class="workspace">
        <div class="editor-section">
          <Editor 
            ref="editorRef"
            :content="activeTab.content"
            :autoFormat="store.getEditorSettings().autoFormat"
            :debounceMs="store.getEditorSettings().debounceMs || 300"
            :autoFormatOnIdle="store.getEditorSettings().autoFormatOnIdle"
            :autoFormatOnPaste="store.getEditorSettings().autoFormatOnPaste"
            @change="handleEditorChange"
          />
        </div>
        <OutputPanel />
      </div>
      <DiffSidebar @openLineDiff="handleOpenLineDiff" />
    </div>

    <div v-if="showLineDiff" class="line-diff-overlay">
      <button class="line-diff-close" @click="closeLineDiff">关闭</button>
      <DiffView :leftContent="lineLeft" :rightContent="lineRight" />
    </div>
    
    <!-- 底部状态栏 -->
    <StatusBar
      v-if="activeTab"
      :content="activeTab.content"
      @copy="handleCopyToClipboard"
      @format="handleBottomFormat"
      @escape="handleBottomEscape"
      @unescape="handleBottomUnescape"
      @compare="handleCompare"
      @aiProcess="handleAIProcess"
    />
    
    <div class="processor-empty" v-else>
      <p>没有打开的标签页，请新建或导入文件</p>
    </div>
    
  </div>
</template>

<style scoped>
.json-processor {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg-primary);
}

.processor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  background: var(--color-bg-primary);
  border-bottom: 1px solid var(--color-divider);
  padding: 8px 12px;
  box-shadow: var(--shadow-sm);
}

.processor-header .app-title {
  font-size: 16px;
  margin: 0;
  color: var(--color-text-primary);
  font-weight: 600;
}

.processor-container {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 1px;
}

.workspace {
  flex: 1;
  display: flex;
  position: relative;
  min-height: 0;
  gap: 1px;
}

.workspace > .editor-section {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.workspace .output-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  max-width: 360px;
  z-index: 10;
  flex-shrink: 0;
  box-shadow: -4px 0 12px rgba(0, 0, 0, 0.1);
}

.editor-section {
  flex: 1;
  background: var(--color-bg-primary);
  overflow: hidden;
}

.processor-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--color-text-tertiary);
  background: var(--color-bg-primary);
}

.line-diff-overlay {
  position: fixed;
  left: 80px;
  right: 80px;
  top: 60px;
  bottom: 60px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-divider);
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  z-index: 200000;
  display: flex;
  flex-direction: column;
  padding: 8px;
}

.line-diff-close {
  align-self: flex-end;
  background: none;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  font-size: 14px;
  margin-bottom: 8px;
}

@media (max-width: 768px) {
  .processor-container {
    flex-direction: column;
  }
}
</style>