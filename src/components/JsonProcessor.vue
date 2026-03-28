<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useJsonStore } from '../store/index.js';
import { detectAndConvert, toFormat, FORMAT_TYPES } from '../services/formatDetector.js';
import { convert } from '../services/converter.js';
import { queryJsonPath, queryJq } from '../services/queryEngine.js';
import { getDifferences, buildLineDiffs, buildTreeDiff } from '../services/diffEngine.js';
import { processWithAI, parseAIJsonWithRetry } from '../services/aiProcessor.js';
import Editor from './Editor.vue';
import TabBar from './TabBar.vue';
import StatusBar from './StatusBar.vue';
import OutputPanel from './OutputPanel.vue';
import ControlPanel from './ControlPanel.vue';
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
const isNarrow = ref(false);

const tabs = computed(() => store.tabs);

onMounted(() => {
  try {
    if (typeof window !== 'undefined') {
      const update = () => { isNarrow.value = window.innerWidth <= 900; };
      update();
      window.addEventListener('resize', update);
      onUnmounted(() => {
        try { window.removeEventListener('resize', update); } catch (_) {}
      });
    }
  } catch (_) {}
});
const activeTab = computed(() => store.getActiveTab());
const editorRef = ref(null);

// AI 原始响应展示与重试状态
const aiRawResponse = ref('');
const aiRawVisible = ref(false);
const aiRetrying = ref(false);

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

function toggleFloatingSidebar() {
  try {
    if (!store.diffSidebar.visible) {
      store.showDiffSidebar('');
      store.diffSidebar.collapsed = false;
    } else {
      store.diffSidebar.collapsed = !store.diffSidebar.collapsed;
    }
  } catch (e) {
    // ignore
  }
}

// 初始化
const lastImportedText = ref('');

  onMounted(async () => {
    // 尝试从持久化恢复 tabs；若恢复失败则创建初始 tab
    try {
      if (typeof store.loadTabsState === 'function') {
        const restored = await store.loadTabsState();
        if (restored) {
          // 启动时尝试清理过期标签（默认 1 天）
          try { if (typeof store.cleanupOldTabs === 'function') store.cleanupOldTabs(1); } catch (_) {}
          // 恢复并清理后再确保至少有一个标签（防止清理导致全空）
          ensureInitialTab();
        } else {
          ensureInitialTab();
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
        createNewTab('{}');
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
  try {
    const currentTabs = Array.isArray(store.tabs)
      ? store.tabs
      : (store.tabs && Array.isArray(store.tabs.value) ? store.tabs.value : []);
    if (!Array.isArray(currentTabs) || currentTabs.length === 0) {
      store.addTab('{}', '', FORMAT_TYPES.JSON);
    }
  } catch (e) {
    // 若发生异常，作为兜底仍尝试创建一个标签
    try { store.addTab('{}', '', FORMAT_TYPES.JSON); } catch (_) {}
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

async function createNewTab(initialContent = '{}', name = '', format = FORMAT_TYPES.JSON) {
  try {
    const id = store.addTab(initialContent, name, format);
    activePanel.value = 'editor';
    // 等待 DOM 更新并尝试聚焦编辑器
    await nextTick();
    await nextTick();
    try { if (editorRef.value && typeof editorRef.value.focus === 'function') editorRef.value.focus(); } catch (_) {}
    return id;
  } catch (e) {
    // 兜底：若 addTab 抛出，仍尝试恢复
    try { store.addTab(initialContent, name, format); } catch (_) {}
    return null;
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

    // 同时直接展示行级对比，便于用户快速查看变更（使用原始排序后的文本）
    try {
      handleOpenLineDiff(sortedLeft, sortedRight);
    } catch (e) {
      // ignore
    }
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
      // 如果 AI 返回可解析的 JSON（service 返回格式化 JSON 字符串），优先作为 JSON 面板新建标签
      if (result.originalFormat && result.originalFormat.toLowerCase() === 'json') {
        store.addTab(result.data, 'AI 处理结果', FORMAT_TYPES.JSON);
      } else {
        // 当返回为文本但包含 rawResponse（或返回的 data 与 rawResponse 不同）时，
        // 展示原始响应并提供“仅返回 JSON”重试入口（调用 parseAIJsonWithRetry）
        const raw = result.rawResponse || result.data || '';
        const normalizedData = result.data || '';
        if (raw && raw !== normalizedData) {
          aiRawResponse.value = raw;
          aiRawVisible.value = true;
        } else {
          // 没有可用的 rawResponse，仍将返回值作为新标签展示（文本回退）
          store.addTab(result.data, 'AI 处理结果', FORMAT_TYPES.JSON);
        }
      }
    } else {
      notify.error('处理失败: ' + result.error);
    }
  } catch (e) {
    notify.error('处理失败: ' + e.message);
  }
};

async function handleRetryParseAI() {
  if (!aiRawResponse.value) return;
  if (!store.aiConfig) return;

  aiRetrying.value = true;
  try {
    const cfg = store.getAIConfig();
    const max = typeof cfg.parseRetryMax === 'number' ? cfg.parseRetryMax : 1;
    const res = await parseAIJsonWithRetry(aiRawResponse.value, {
      provider: cfg.provider,
      aiConfig: cfg,
      maxRetries: max
    });
    if (res && res.parsed) {
      const formatted = JSON.stringify(res.parsed, null, 2);
      store.addTab(formatted, 'AI 重试结果（JSON）', FORMAT_TYPES.JSON);
      aiRawVisible.value = false;
      aiRawResponse.value = '';
    } else {
      notify.warn('重试未能解析出有效 JSON');
    }
  } catch (e) {
    notify.error('重试失败: ' + (e && e.message ? e.message : String(e)));
  } finally {
    aiRetrying.value = false;
  }
}

function handleAcceptRaw() {
  if (!aiRawResponse.value) return;
  try {
    // 将原始响应作为新标签加入（以文本展示）
    store.addTab(aiRawResponse.value, 'AI 原始响应', FORMAT_TYPES.JSON);
    aiRawVisible.value = false;
    aiRawResponse.value = '';
  } catch (e) {
    notify.error('接受原始响应失败: ' + (e && e.message ? e.message : String(e)));
  }
}

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
onMounted(() => {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.search && window.location.search.indexOf('autotest') !== -1) {
      // 自动化测试模式：注入示例左右内容并直接打开行级对比视图
      const left = JSON.stringify({ a: 1, b: 2, c: { x: 1, y: 2 } }, null, 2);
      const right = JSON.stringify({ a: 1, b: 3, d: 4, c: { x: 1, y: 9 } }, null, 2);
      try {
        const act = store.getActiveTab && store.getActiveTab();
        if (act && act.id) {
          try { store.updateTabContent(act.id, right); } catch (_) {}
        }
      } catch (_) {}
      try { handleOpenLineDiff(left, right); } catch (_) {}
    }
  } catch (_) {}
});

</script>

<template>
  <div class="json-processor">
    <button class="global-sidebar-toggle" @click="toggleFloatingSidebar" aria-label="侧边栏切换" title="切换对比侧边栏">
      <span v-if="store.diffSidebar.visible && !store.diffSidebar.collapsed">◀</span>
      <span v-else>▶</span>
    </button>
    <div class="processor-header">
      <h1 class="app-title">Jsonium</h1>
      <TabBar 
        :tabs="displayedTabs" 
        :activeTabId="store.activeTabId"
        @selectTab="(id) => store.setActiveTab(id)"
        @closeTab="(id) => store.closeTab(id)"
        @renameTab="(id, name) => store.updateTabName(id, name)"
        @newTab="() => createNewTab()"
        @toggleFavorite="(id) => store.toggleFavorite(id)"
        @closeOtherTabs="(id) => store.closeOtherTabs(id)"
        @closeAllTabs="() => store.closeAllTabs()"
        @closeLeftTabs="(id) => store.closeLeftTabs(id)"
      />
      <!-- 设置入口由状态栏提供，移除此处的重复按钮 -->
    </div>
    
    <div class="processor-container" v-if="activeTab">
      <div class="control-panel-wrapper" :class="{ 'drawer-mode': isNarrow }" v-if="store.editorSettings.controlPanelVisible">
        <template v-if="isNarrow">
          <div class="drawer-overlay" @click="store.editorSettings.controlPanelVisible = false"></div>
          <div class="control-panel-drawer">
            <button class="drawer-close" @click="store.editorSettings.controlPanelVisible = false" aria-label="关闭设置">✕</button>
            <ControlPanel
              :activePanel="activePanel"
              @panelChange="(p) => activePanel = p"
              @import="handleImportText"
              @convert="handleConvert"
              @generateCode="handleGenerateCode"
              @query="handleQuery"
              @compare="handleCompare"
              @aiProcess="handleAIProcess"
              @copyToClipboard="handleCopyToClipboard"
              @download="handleDownload"
            />
          </div>
        </template>
        <template v-else>
          <ControlPanel
            :activePanel="activePanel"
            @panelChange="(p) => activePanel = p"
            @import="handleImportText"
            @convert="handleConvert"
            @generateCode="handleGenerateCode"
            @query="handleQuery"
            @compare="handleCompare"
            @aiProcess="handleAIProcess"
            @copyToClipboard="handleCopyToClipboard"
            @download="handleDownload"
          />
        </template>
      </div>
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
    
    <!-- AI 原始响应悬浮面板 -->
    <teleport to="body">
      <div v-if="aiRawVisible" class="ai-raw-overlay" role="dialog" aria-modal="true">
        <div class="ai-raw-panel">
          <div class="ai-raw-header">
            <div>AI 原始响应</div>
            <div class="ai-raw-actions">
              <button class="btn" @click="aiRawVisible = false">关闭</button>
            </div>
          </div>
          <div class="ai-raw-body">
            <pre class="ai-raw-pre">{{ aiRawResponse }}</pre>
          </div>
          <div class="ai-raw-footer">
            <button class="panel-btn" @click="handleAcceptRaw()">接受原始响应</button>
            <button class="panel-btn primary" :disabled="aiRetrying" @click="handleRetryParseAI()">
              {{ aiRetrying ? '正在重试...' : '重试仅返回 JSON' }}
            </button>
          </div>
        </div>
      </div>
    </teleport>

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

/* 控制面板容器宽度 */
.control-panel-wrapper {
  width: 300px;
  min-width: 260px;
  max-width: 360px;
  flex: 0 0 300px;
  border-right: 1px solid var(--color-divider);
  overflow: auto;
}

@media (max-width: 900px) {
  /* 窄屏下不再彻底隐藏侧栏，而使用抽屉覆盖方式（由 isNarrow 控制） */
  .control-panel-wrapper {
    width: 100%;
    min-width: 0;
  }
  .control-panel-wrapper.drawer-mode {
    position: fixed;
    left: 16px;
    right: 16px;
    top: 64px;
    bottom: 16px;
    width: auto;
    max-width: 640px;
    z-index: 300001;
    box-shadow: 0 12px 48px rgba(0,0,0,0.4);
    border-right: none;
    border-radius: 8px;
    overflow: hidden;
  }
  .drawer-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 300000;
  }
  .control-panel-drawer {
    position: relative;
    background: var(--color-bg-primary);
    height: 100%;
    overflow: auto;
    padding: 12px;
    z-index: 300002;
  }
  .drawer-close {
    position: absolute;
    right: 10px;
    top: 8px;
    background: transparent;
    border: none;
    color: var(--color-text-secondary);
    font-size: 16px;
    cursor: pointer;
  }
}

/* AI 原始响应面板样式 */
.ai-raw-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300000;
  padding: 20px;
}
.ai-raw-panel {
  width: min(1000px, 90%);
  max-height: 80vh;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 48px rgba(0,0,0,0.6);
}
.ai-raw-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-divider);
  font-size: 13px;
  color: var(--color-text-primary);
  background: var(--color-bg-secondary);
}
.ai-raw-body {
  padding: 12px;
  overflow: auto;
  background: var(--color-bg-primary);
  flex: 1;
}
.ai-raw-pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.ai-raw-footer {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--color-divider);
  background: var(--color-bg-secondary);
}
.ai-raw-actions .btn {
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 13px;
}

/* Ensure control panel (non-drawer) is above editor but below global modals */
.control-panel-wrapper:not(.drawer-mode) {
  position: relative;
  z-index: 300000;
  pointer-events: auto;
}

/* Ensure inner control panel receives pointer events (avoid accidental suppression) */
.control-panel-wrapper:not(.drawer-mode) .control-panel {
  pointer-events: auto;
}

/* Global floating sidebar toggle (always visible, semi-transparent) */
.global-sidebar-toggle {
  position: fixed;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border-radius: 22px;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(6px);
  border: 1px solid var(--color-divider);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(0,0,0,0.12);
  z-index: 180000;
  opacity: 0.85;
  transition: opacity .18s ease, transform .12s ease;
  color: var(--color-text-primary);
}

.global-sidebar-toggle:hover { opacity: 1; transform: translateY(-50%) scale(1.04); }
</style>
