<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
  import { useEnterActionImport } from '../composables/useEnterActionImport.js';
  import { useGlobalShortcuts } from '../composables/useGlobalShortcuts.js';
  import { useLeftPanelResize } from '../composables/useLeftPanelResize.js';
  import { copyText } from '../services/clipboard.js';
import { convert } from '../services/converter.js';
import { stringifySortedJson } from '../services/diffEngine.js';
import { detectAndConvert, FORMAT_TYPES, toFormat } from '../services/formatDetector.js';
import notify from '../services/notify.js';
import { queryJq, queryJsonPath } from '../services/queryEngine.js';
import { useJsonStore } from '../store/index.js';
import { getFormatName } from '../utils/formatNames.js';
import { getStringifyIndent } from '../utils/indent.js';
import ControlPanel from './ControlPanel.vue';
import DiffSidebar from './DiffSidebar.vue';
import DiffView from './DiffView.vue';
import Editor from './Editor.vue';
import StatusBar from './StatusBar.vue';
import TabBar from './TabBar.vue';
import TableView from './TableView.vue';

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
  const activePanel = ref('editor');
const isNarrow = ref(false);
  const {
    controlPanelStyle,
    isLeftResizing,
    startLeftPanelResize,
    resetLeftPanelWidth,
    clearLeftResizeSelection
  } = useLeftPanelResize(isNarrow, {
    defaultWidth: 340,
    minWidth: 280,
    maxWidth: 420
  });

const tabs = computed(() => store.tabs);

  onMounted(() => {
  try {
    if (typeof window !== 'undefined') {
      const update = () => {
        isNarrow.value = window.innerWidth <= 900;
        // 窗口尺寸变化时强制 Monaco 编辑器重新布局
        nextTick(() => {
          try {
            if (editorRef.value && typeof editorRef.value.layout === 'function') {
              editorRef.value.layout();
            }
          } catch (_) { }
        });
      };
      update();
      window.addEventListener('resize', update);
      // 监听 uTools 插件进入事件，重新布局编辑器
      const handlePluginEnterLayout = () => {
        nextTick(() => {
          try {
            if (editorRef.value && typeof editorRef.value.layout === 'function') {
              editorRef.value.layout();
            }
          } catch (_) { }
          update(); // 同时更新窄屏状态
        });
      };
      window.addEventListener('jsonium-plugin-enter', handlePluginEnterLayout);
      onUnmounted(() => {
        try { window.removeEventListener('resize', update); } catch (_) {}
        try { window.removeEventListener('jsonium-plugin-enter', handlePluginEnterLayout); } catch (_) { }
      });
    }
  } catch (_) {}
});
const activeTab = computed(() => store.getActiveTab());
const editorRef = ref(null);
  const {
    restoreTabsOrCreateInitial,
    importEnterAction
  } = useEnterActionImport(store, editorRef, activePanel);

// line diff overlay
const showLineDiff = ref(false);
const lineLeft = ref('');
const lineRight = ref('');
const showCenteredDiff = ref(false);
const centeredLeft = ref('');
const centeredRight = ref('');

function handleOpenLineDiff(left, right) {
  lineLeft.value = left || '';
  lineRight.value = right || '';
  showLineDiff.value = true;
}
function handleOpenCenteredDiff(left, right) {
  centeredLeft.value = left || '';
  centeredRight.value = right || '';
  showCenteredDiff.value = true;
}
function closeLineDiff() {
  showLineDiff.value = false;
  lineLeft.value = '';
  lineRight.value = '';
}
function closeCenteredDiff() {
  showCenteredDiff.value = false;
  centeredLeft.value = '';
  centeredRight.value = '';
}

  useGlobalShortcuts({
    onEscape(event) {
      if (showCenteredDiff.value) {
        event.preventDefault();
        closeCenteredDiff();
        return true;
      }
      if (store.outputPanel.visible) {
        event.preventDefault();
        store.hideOutputPanel();
        return true;
      }
      if (store.diffSidebar.visible) {
        event.preventDefault();
        store.hideDiffSidebar();
        return true;
      }
      if (store.editorSettings.controlPanelVisible) {
        event.preventDefault();
        store.editorSettings.controlPanelVisible = false;
        return true;
      }
      return false;
    },
    onCloseTab() {
      if (store.activeTabId) store.closeTab(store.activeTabId);
    },
    onNewTab() {
      createNewTab('{}');
    }
  });

function toggleFloatingSidebar() {
  try {
    const outputVisible = store.outputPanel.visible;
    const sidebarVisible = store.diffSidebar.visible && !store.diffSidebar.collapsed;

    if (outputVisible) {
      store.hideOutputPanel();
      return;
    }

    if (!sidebarVisible) {
      store.showDiffSidebar('');
      store.diffSidebar.collapsed = false;
    } else {
      store.diffSidebar.collapsed = !store.diffSidebar.collapsed;
    }
  } catch (e) {
    // ignore
  }
}

  onMounted(async () => {
    const initialEnterAction = { ...props.enterAction };
    await restoreTabsOrCreateInitial();
    await importEnterAction(initialEnterAction);

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', _save);
  }
  if (typeof window !== 'undefined' && window.utools && typeof window.utools.onPluginOut === 'function') {
    try { window.utools.onPluginOut(_save); } catch (e) { /* ignore */ }
  }

});

onUnmounted(() => {
  clearLeftResizeSelection();
  // 清理 beforeunload 监听（若已注册）
  if (typeof window !== 'undefined' && window.removeEventListener) {
    try { window.removeEventListener('beforeunload', _save); } catch (e) { /* ignore */ }
  }
});

watch(() => props.enterAction, async (action) => {
  await importEnterAction(action);
}, { deep: true });

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
      result = await queryJq(activeTab.value.content, expression);
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
      const queryResult = typeof queryData === 'string' ? queryData : JSON.stringify(queryData, null, getStringifyIndent());
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

    // 两个都有内容 - 仅保留行级对比所需的标准化内容
    const sortedLeft = stringifySortedJson(leftContent);
    const sortedRight = stringifySortedJson(rightContent);

    store.setDiffResult(sortedLeft, sortedRight, {
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

 // 复制到剪贴板
const copyTextToClipboard = async (text, showFeedback = false) => {
  if (text === null || text === undefined) return false;
  const ok = await copyText(text, { preserveWhitespace: !!store.editorSettings.preserveWhitespaceOnCopy });
  if (showFeedback) {
    ok ? notify.success('已复制到剪贴板') : notify.error('复制失败');
  }
  return ok;
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

// 表格视图
const tableViewVisible = computed(() => store.tableView.visible);

const handleOpenTableView = () => {
  store.showTableView();
};

const handleApplyTableChanges = (newJsonString) => {
  if (!activeTab.value) return;
  store.updateTabContent(activeTab.value.id, newJsonString);
  try {
    if (editorRef.value && typeof editorRef.value.setContent === 'function') {
      editorRef.value.setContent(newJsonString);
    }
  } catch (_) {}
  store.hideTableView();
  notify.success('表格修改已应用');
};

// 辅助函数
onMounted(() => {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.search && window.location.search.indexOf('autotest') !== -1) {
      // 自动化测试模式：注入示例左右内容并直接打开行级对比视图
      const left = JSON.stringify({ a: 1, b: 2, c: { x: 1, y: 2 } }, null, getStringifyIndent());
      const right = JSON.stringify({ a: 1, b: 3, d: 4, c: { x: 1, y: 9 } }, null, getStringifyIndent());
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
  <div class="json-processor" :class="{ 'has-active-tab': !!activeTab }">
    <button
      class="global-sidebar-toggle"
      :class="{ 'is-active': (store.diffSidebar.visible && !store.diffSidebar.collapsed) || store.outputPanel.visible }"
      @click="toggleFloatingSidebar"
      aria-label="侧边栏切换"
      title="切换右侧栏"
    >
      <span v-if="(store.diffSidebar.visible && !store.diffSidebar.collapsed) || store.outputPanel.visible">◀</span>
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
      <div
        class="control-panel-wrapper"
        :class="{ 'drawer-mode': isNarrow }"
        :style="controlPanelStyle"
        v-if="store.editorSettings.controlPanelVisible"
      >
        <template v-if="isNarrow">
          <div class="drawer-overlay" @click="store.editorSettings.controlPanelVisible = false"></div>
          <div class="control-panel-drawer">
            <ControlPanel
              :activePanel="activePanel"
              @panelChange="(p) => activePanel = p"
              @import="handleImportText"
              @convert="handleConvert"
              @generateCode="handleGenerateCode"
              @query="handleQuery"
              @compare="handleCompare"
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
            @copyToClipboard="handleCopyToClipboard"
            @download="handleDownload"
          />
        </template>
      </div>
      <div
        v-if="store.editorSettings.controlPanelVisible && !isNarrow"
        class="left-panel-resizer"
        :class="{ active: isLeftResizing }"
        @mousedown="startLeftPanelResize"
        @dblclick="resetLeftPanelWidth"
        title="拖动调整左侧栏宽度，双击恢复默认"
      ></div>
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
      </div>
      <DiffSidebar @openLineDiff="handleOpenLineDiff" @openCenteredDiff="handleOpenCenteredDiff" />
    </div>

    <div v-if="showLineDiff" class="line-diff-overlay">
      <button class="line-diff-close" @click="closeLineDiff">关闭</button>
      <DiffView :leftContent="lineLeft" :rightContent="lineRight" />
    </div>

    <div v-if="showCenteredDiff" class="centered-diff-overlay" @click.self="closeCenteredDiff">
      <div class="centered-diff-panel" role="dialog" aria-modal="true" aria-label="居中对比结果">
        <div class="centered-diff-header">
          <div class="centered-diff-copy">
            <h3>对比结果</h3>
            <p>大视图预览，适合查看更长的结构差异</p>
          </div>
          <button class="centered-diff-close" @click="closeCenteredDiff">关闭</button>
        </div>
        <div class="centered-diff-body">
          <DiffView :leftContent="centeredLeft" :rightContent="centeredRight" />
        </div>
      </div>
    </div>

    <!-- 表格视图悬浮面板 -->
    <teleport to="body">
      <TableView
        v-if="tableViewVisible && activeTab"
        :jsonContent="activeTab.content"
        :arrayPath="store.tableView.arrayPath"
        @apply="handleApplyTableChanges"
        @close="store.hideTableView()"
      />
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
        @openTableView="handleOpenTableView"
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

@media (min-width: 1400px) {
  /* StatusBar is fixed on large screens, reserve space to avoid covering work area. */
  .json-processor.has-active-tab {
    padding-bottom: calc(64px + env(safe-area-inset-bottom));
    box-sizing: border-box;
  }
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
    position: relative;



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
  width: 520px;
  max-width: min(520px, 100%);
  z-index: 99999;
  flex-shrink: 0;
    box-shadow: -4px 0 12px rgba(0, 0, 0, 0.06);


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
  left: 40px;
  right: 40px;
  top: 28px;
  bottom: 28px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-divider);
    box-shadow: 0 18px 36px rgba(0, 0, 0, 0.16);


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

.centered-diff-overlay {
  position: fixed;
  inset: 0;
  z-index: 200001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: rgba(15, 23, 42, 0.68);
  backdrop-filter: blur(6px);
}

.centered-diff-panel {
  width: min(1480px, 96vw);
  height: min(94vh, 1080px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 20px;
  border: 1px solid color-mix(in srgb, var(--color-divider) 76%, transparent);
  background: var(--color-bg-primary);
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.35);
}

.centered-diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-divider) 78%, transparent);
  background: color-mix(in srgb, var(--color-bg-secondary) 90%, var(--color-bg-primary));
}

.centered-diff-copy h3 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
  color: var(--color-text-primary);
}

.centered-diff-copy p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.centered-diff-close {
  border: 1px solid var(--color-divider);
  border-radius: 999px;
  padding: 8px 14px;
  background: color-mix(in srgb, var(--color-bg-primary) 88%, var(--color-bg-secondary));
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.centered-diff-body {
  flex: 1;
  min-height: 0;
  padding: 12px;
  background: color-mix(in srgb, var(--color-bg-primary) 94%, transparent);
}

@media (max-width: 768px) {
  .processor-container {
    flex-direction: column;
  }

  .centered-diff-overlay {
    padding: 8px;
  }

  .centered-diff-panel {
    width: 100%;
    height: min(94vh, 100%);
    border-radius: 16px;
  }

  .centered-diff-header {
    align-items: flex-start;
    flex-direction: column;
  }
}

/* 控制面板容器宽度 */
.control-panel-wrapper {
  width: 340px;
  min-width: 280px;
  max-width: 420px;
  flex: 0 0 340px;
  border-right: 1px solid var(--color-divider);
  overflow: auto;
    background: var(--color-bg-secondary);

}

.left-panel-resizer {
  width: 8px;
  cursor: col-resize;
  flex: 0 0 8px;
  position: relative;
  background: transparent;
}

.left-panel-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: var(--color-divider);
  opacity: 0.8;
  transform: translateX(-50%);
}

.left-panel-resizer:hover::after,
.left-panel-resizer.active::after {
  width: 2px;
  background: var(--color-primary);
  opacity: 1;
}

@media (max-width: 900px) {
  /* 窄屏下不再彻底隐藏侧栏，而使用抽屉覆盖方式（由 isNarrow 控制） */
  .control-panel-wrapper {
    width: 100%;
    min-width: 0;
  }
  .control-panel-wrapper.drawer-mode {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 12px;
    bottom: 12px;
    width: auto;
    max-width: 640px;
    z-index: 100000;
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.25);


    border-right: none;
      border-radius: 4px;

    overflow: hidden;
  }
  .drawer-overlay {
    position: absolute;
    inset: 0;
      background: rgba(0, 0, 0, 0.12);


    z-index: 99999;
  }
  .control-panel-drawer {
    position: relative;
      background: var(--color-bg-secondary);

    height: 100%;
    overflow: auto;
    padding: 12px;
    z-index: 100001;
  }
}

/* Ensure control panel (non-drawer) is above editor but below global modals */
.control-panel-wrapper:not(.drawer-mode) {
  position: relative;
  z-index: 1;
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
    border-radius: 4px;

  background: var(--color-bg-secondary);
    backdrop-filter: none;

  border: 1px solid var(--color-divider);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  z-index: 180000;
  opacity: 0.92;
  transition: opacity .18s ease, transform .12s ease, background .18s ease, border-color .18s ease, color .18s ease;
  color: var(--color-text-primary);
}

.global-sidebar-toggle:hover {
  opacity: 1;
  transform: translateY(-50%) scale(1.04);
  background: var(--color-bg-primary);
    border-color: var(--color-primary);

}

.global-sidebar-toggle.is-active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
    box-shadow: none;


}
</style>
