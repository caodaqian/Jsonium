<script setup>
import { computed, ref } from 'vue';
import { buildTreeDiff, stringifySortedJson } from '../services/diffEngine.js';
import { detectAndConvert } from '../services/formatDetector.js';
import notify from '../services/notify.js';
import { useJsonStore } from '../store/index.js';
import { getStringifyIndent } from '../utils/indent.js';
import DiffView from './DiffView.vue';
import Editor from './Editor.vue';

const emit = defineEmits(['openLineDiff', 'openCenteredDiff']);
const store = useJsonStore();

const visible = computed(() => store.diffSidebar.visible);
const mode = computed(() => store.diffSidebar.mode);
const collapsed = computed(() => store.diffSidebar.collapsed);

// ── 统一标签栏逻辑 ──────────────────────────────────────
const allTabs = [
  { id: 'diff', label: '⚖️ 对比' },
  { id: 'jsonpath', label: '🔍 JSONPath' },
  { id: 'jq', label: '🌀 jq' },
];

const hasOutputContent = (tab) => {
  const entry = store.outputPanel.content[tab];
  return entry && (entry.error !== null || entry.value !== null);
};

// 始终显示"对比"标签；有内容时才显示查询结果标签
const visibleTabs = computed(() =>
  allTabs.filter((t) => t.id === 'diff' || hasOutputContent(t.id))
);

// 当前活跃标签：output 模式下取 outputPanel.currentTab，否则固定为 'diff'
const activeTabId = computed(() =>
  mode.value === 'output' ? store.outputPanel.currentTab : 'diff'
);
const isDiffOutputTab = computed(() => store.outputPanel.currentTab === 'diff');

function switchTab(tabId) {
  if (tabId === 'diff') {
    // 切到对比模式：有对比结果则显示结果，否则显示输入
    const hasResult = store.diffSidebar.leftContent || store.diffSidebar.diffTree;
    store.diffSidebar.mode = hasResult ? 'result' : 'input';
    store.outputPanel.visible = false;
  } else {
    // 切到查询结果
    store.diffSidebar.mode = 'output';
    store.outputPanel.currentTab = tabId;
    store.outputPanel.visible = true;
  }
}

// ── Output 模式内容逻辑（原 OutputPanel 逻辑）────────────
const currentOutputEntry = computed(() => store.outputPanel.content[store.outputPanel.currentTab]);

const outputFormattedContent = computed(() => {
  const entry = currentOutputEntry.value;
  if (!entry) return '';
  if (entry.error) return entry.error;
  if (entry.value === null || entry.value === undefined) return '';
  return typeof entry.value === 'string'
    ? entry.value
    : JSON.stringify(entry.value, null, getStringifyIndent());
});

const outputHasContent = computed(() => {
  if (isDiffOutputTab.value) {
    return !!(store.diffSidebar.leftContent || store.diffSidebar.rightContent || store.diffSidebar.diffTree);
  }
  const entry = currentOutputEntry.value;
  return entry && (entry.error !== null || entry.value !== null);
});

const outputIsError = computed(() => {
  const entry = currentOutputEntry.value;
  return entry && entry.error !== null && entry.error !== undefined;
});

async function handleCopyOutput() {
  if (isDiffOutputTab.value) {
    notify.warn('对比结果请使用行级对比查看或复制主编辑区内容');
    return;
  }
  if (!outputHasContent.value) return;
  try {
    if (globalThis.window?.utools) {
      globalThis.window.utools.copyText(outputFormattedContent.value);
    } else {
      await navigator.clipboard.writeText(outputFormattedContent.value);
    }
    notify.success('已复制输出内容');
  } catch (e) {
    notify.error('复制失败: ' + e.message);
  }
}

async function handleInsertToEditor() {
  if (isDiffOutputTab.value) {
    notify.warn('对比结果不支持直接替换主编辑区');
    return;
  }
  if (!outputHasContent.value) return;
  const entry = currentOutputEntry.value;
  if (!entry) return;
  if (entry.error) { notify.warn('无法插入：输出为错误信息'); return; }
  try {
    let content = '';
    if (typeof entry.value === 'string') {
      const detected = await detectAndConvert(entry.value);
      content = detected.success ? detected.data : entry.value;
    } else {
      content = JSON.stringify(entry.value, null, getStringifyIndent());
    }
    const active = store.getActiveTab();
    if (!active) { notify.warn('没有打开的主编辑标签'); return; }
    store.updateTabContent(active.id, content);
    notify.success('已替换主编辑区内容');
  } catch (e) {
    notify.error('插入失败: ' + e.message);
  }
}

// ── 关闭按钮：统一处理所有模式 ────────────────────────────
function closePanel() {
  if (mode.value === 'output') {
    store.hideOutputPanel();
  } else {
    closeSidebar();
  }
}

// 左侧仅为待比对输入 A
const leftInput = computed({
  get: () => store.diffSidebar.leftInput,
  set: (v) => { store.diffSidebar.leftInput = v; }
});

// 读取主编辑区当前内容作为基准 B（只读）
const rightContent = computed(() => {
  const active = store.getActiveTab();
  return active ? active.content : '';
});

const diffTree = computed(() => store.diffSidebar.diffTree);
const diffStats = computed(() => store.diffSidebar.diffStats);
const diffFilter = computed({
  get: () => store.diffSidebar.diffFilter,
  set: (v) => { store.diffSidebar.diffFilter = v; }
});
const error = computed(() => store.diffSidebar.error);

const leftError = ref('');
const globalError = ref('');
const isComparing = ref(false);

const editorRef = ref(null);

// 调用 Editor 的 format（若存在）
function handleFormatLeft() {
  if (editorRef.value && editorRef.value.format) {
    editorRef.value.format();
  } else {
    try {
      const parsed = JSON.parse(leftInput.value || '');
      store.diffSidebar.leftInput = JSON.stringify(parsed, null, getStringifyIndent());
      leftError.value = '';
    } catch (e) {
      leftError.value = 'JSON 格式错误: ' + e.message;
    }
  }
}

async function handleLeftPaste() {
  try {
    let text = '';
    if (navigator.clipboard && navigator.clipboard.readText) {
      text = await navigator.clipboard.readText();
    } else {
      notify.warn('当前环境不支持读取剪贴板');
      return;
    }
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      store.diffSidebar.leftInput = JSON.stringify(parsed, null, getStringifyIndent());
    } catch {
      store.diffSidebar.leftInput = text;
    }
    leftError.value = '';
  } catch (e) {
    notify.error('粘贴失败: ' + e.message);
  }
}

function handleLeftChange(content) {
  store.diffSidebar.leftInput = content;
  if (leftError.value) leftError.value = '';
}

function handleBackToInput() {
  store.diffSidebar.mode = 'input';
}

// 执行树形对比
async function handleCompare() {
  leftError.value = '';
  globalError.value = '';
  if (!leftInput.value || !leftInput.value.trim()) {
    leftError.value = '请输入 待比对 JSON';
    return;
  }
  if (!rightContent.value || !rightContent.value.trim()) {
    globalError.value = '主编辑区(JSON 基准)为空或不可用';
    store.showDiffSidebar(leftInput.value);
    return;
  }

  isComparing.value = true;
  try {
    // 校验 JSON 格式
    try {
      JSON.parse(leftInput.value);
    } catch (e) {
      leftError.value = '待比对 JSON 格式错误: ' + e.message;
      isComparing.value = false;
      return;
    }
    try {
      JSON.parse(rightContent.value);
    } catch (e) {
      globalError.value = '主编辑区 JSON 格式错误: ' + e.message;
      isComparing.value = false;
      return;
    }

    const sortedLeft = stringifySortedJson(leftInput.value);
    const sortedRight = stringifySortedJson(rightContent.value);
    const result = buildTreeDiff(sortedLeft, sortedRight);
    store.showOutputPanel('diff', {
      left: sortedLeft,
      right: sortedRight,
      diffPayload: {
        diffTree: result.tree,
        diffStats: result.stats,
        diffLines: []
      }
    });
  } catch (e) {
    store.setDiffError('对比失败: ' + e.message);
  } finally {
    isComparing.value = false;
  }
}

function openLineDiff() {
  const left = store.diffSidebar.leftContent || leftInput.value || '';
  const right = store.diffSidebar.rightContent || rightContent.value || '';
  emit('openLineDiff', left, right);
}

function openCenteredDiff() {
  const left = store.diffSidebar.leftContent || leftInput.value || '';
  const right = store.diffSidebar.rightContent || rightContent.value || '';
  emit('openCenteredDiff', left, right);
}

/**
 * 如果还未构建树形结果则按需构建并切换到结果模式
 */
async function buildTreeIfNeeded() {
  try {
    if (store.diffSidebar.diffTree) {
      return;
    }
    const left = store.diffSidebar.leftContent || leftInput.value || '';
    const right = rightContent.value || '';
    if (!left || !right) return;
    const sortedLeft = stringifySortedJson(left);
    const sortedRight = stringifySortedJson(right);
    const result = buildTreeDiff(sortedLeft, sortedRight);
    store.setDiffResult(sortedLeft, sortedRight, {
      diffTree: result.tree,
      diffStats: result.stats,
      diffLines: []
    });
    // 清理可能被意外写入的 output 面板内容
    try { store.clearOutput(); } catch (e) { /* ignore */ }
  } catch (e) {
    store.setDiffError('对比失败: ' + e.message);
  }
}

function showTreeView() {
  // 树状对比已移除；直接触发行级对比
  openLineDiff();
}

function closeSidebar() {
  store.hideDiffSidebar();
  leftError.value = '';
  globalError.value = '';
}

</script>

<template>
  <aside class="diff-sidebar" :class="{ active: visible, collapsed: collapsed }">
    <header class="diff-sidebar-header">
      <div class="sidebar-tabs">
        <button
          v-for="tab in visibleTabs"
          :key="tab.id"
          :class="['sidebar-tab', { active: tab.id === activeTabId }]"
          @click="switchTab(tab.id)"
        >{{ tab.label }}</button>
      </div>
      <button class="close-btn" @click="closePanel" title="关闭" aria-label="关闭侧栏">✕</button>
    </header>

    <div v-if="mode === 'input'" class="input-mode">
      <div class="input-header">
        <div class="controls">
          <button class="diff-btn diff-btn--ghost" @click="handleFormatLeft">格式化</button>
          <button class="diff-btn diff-btn--ghost" @click="handleLeftPaste">粘贴并格式化</button>
        </div>
        <div class="actions">
          <button class="diff-btn diff-btn--primary" @click="handleCompare" :disabled="isComparing">⚖️ 对比主编辑区</button>
        </div>
      </div>

      <div class="editor-wrapper-large">
        <Editor ref="editorRef" :content="leftInput" @change="handleLeftChange" />
      </div>
      <p v-if="leftError" class="error-hint">{{ leftError }}</p>
    </div>

    <div v-else-if="mode === 'result'" class="result-mode">
      <div class="result-toolbar">
        <div class="summary">
          <div class="stat added">新增: {{ diffStats.added }}</div>
          <div class="stat removed">删除: {{ diffStats.removed }}</div>
          <div class="stat changed">变化: {{ diffStats.changed }}</div>
          <div class="stat unchanged">相同: {{ diffStats.unchanged }}</div>
        </div>
        <div class="actions">
          <button class="diff-btn diff-btn--ghost" @click="openLineDiff">行级对比</button>
          <button class="diff-btn diff-btn--ghost" @click="openCenteredDiff">居中查看</button>
          <button class="diff-btn diff-btn--ghost" @click="handleBackToInput">返回编辑</button>
          <button class="diff-btn diff-btn--ghost" @click="closeSidebar">关闭</button>
        </div>
      </div>

      <div class="result-content">
        <div v-if="error" class="global-error">{{ error }}</div>
        <div v-else class="result-inner">
          <DiffView :leftContent="store.diffSidebar.leftContent || leftInput" :rightContent="store.diffSidebar.rightContent || rightContent" />
        </div>
      </div>
    </div>

    <!-- output 模式：jsonpath / jq 查询结果 -->
    <div v-else-if="mode === 'output'" class="output-mode">
      <div v-if="isDiffOutputTab" class="result-mode">
        <div class="result-toolbar">
          <div class="summary">
            <div class="stat added">新增: {{ diffStats.added }}</div>
            <div class="stat removed">删除: {{ diffStats.removed }}</div>
            <div class="stat changed">变化: {{ diffStats.changed }}</div>
            <div class="stat unchanged">相同: {{ diffStats.unchanged }}</div>
          </div>
          <div class="actions">
            <button class="diff-btn diff-btn--ghost" @click="openLineDiff">行级对比</button>
            <button class="diff-btn diff-btn--ghost" @click="openCenteredDiff">居中查看</button>
          </div>
        </div>
        <div class="result-content">
          <div v-if="error" class="global-error">{{ error }}</div>
          <div v-else class="result-inner">
            <DiffView :leftContent="store.diffSidebar.leftContent || leftInput" :rightContent="store.diffSidebar.rightContent || rightContent" />
          </div>
        </div>
      </div>
      <div class="output-content" v-else-if="outputHasContent">
        <pre :class="['output-text', { 'is-error': outputIsError }]">{{ outputFormattedContent }}</pre>
        <div class="output-actions">
          <button @click="handleCopyOutput" class="diff-btn diff-btn--ghost">📋 复制</button>
          <button @click="handleInsertToEditor" class="diff-btn diff-btn--ghost" title="替换主编辑区">🔁 替换主编辑区</button>
        </div>
      </div>
      <div class="result-empty" v-else>
        <p>暂无输出内容</p>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* Sidebar container */
.diff-sidebar {
  width: 520px;
  max-width: 100%;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--color-bg-primary) 72%, transparent), transparent 22%),
    var(--color-bg-secondary);
  border-left: 1px solid color-mix(in srgb, var(--color-divider) 70%, transparent);
  display: none;
    position: absolute;


  top: 0;
  right: 0;
    bottom: 0;
    height: auto;


  flex-direction: column;
  overflow: hidden;
    box-shadow: -8px 0 32px rgba(0, 0, 0, 0.07);

  z-index: 99999;
  transition: width 180ms ease;
}
.diff-sidebar.active { display: flex; }
.diff-sidebar.collapsed { width: 0; min-width: 0; max-width: 0; overflow: hidden; border-left: none; box-shadow: none; display: none; }

.diff-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-divider) 82%, transparent);
  background: color-mix(in srgb, var(--color-bg-secondary) 88%, var(--color-bg-primary));
  backdrop-filter: blur(10px);
  flex-shrink: 0;
}

.sidebar-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.sidebar-tabs::-webkit-scrollbar { display: none; }

.sidebar-tab {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.sidebar-tab:hover {
  background: color-mix(in srgb, var(--color-bg-primary) 80%, var(--color-primary) 8%);
  color: var(--color-text-primary);
}
.sidebar-tab.active {
  background: color-mix(in srgb, var(--color-primary) 14%, var(--color-bg-secondary));
  border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-divider));
  color: color-mix(in srgb, var(--color-primary) 82%, var(--color-text-primary));
}

/* output 模式内容区 */
.output-mode {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}
.output-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  padding: var(--spacing-md);
  gap: var(--spacing-sm);
}
.output-text {
  flex: 1;
  overflow-y: auto;
  margin: 0;
  padding: 12px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-divider);
  border-radius: 8px;
  font-family: var(--font-mono, 'Fira Mono', monospace);
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-break: break-all;
}
.output-text.is-error {
  color: var(--color-error);
  background: color-mix(in srgb, var(--color-bg-primary) 92%, var(--color-error));
}
.output-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.close-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--color-divider) 60%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-bg-primary) 88%, var(--color-bg-secondary));
  cursor: pointer;
  font-size: 18px;
  color: var(--color-text-tertiary);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 4px 10px rgba(0, 0, 0, 0.03);

  transition: transform 160ms ease, background-color 160ms ease, color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}
.close-btn:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--color-bg-primary) 72%, var(--color-primary) 10%);
  border-color: color-mix(in srgb, var(--color-primary) 28%, var(--color-divider));
  color: var(--color-text-primary);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.05);

}

.input-mode { display:flex; flex-direction:column; gap:var(--spacing-md); padding:var(--spacing-md); flex:1; overflow-y:auto; }
.input-header { display:flex; justify-content:space-between; align-items:center; gap:var(--spacing-sm); flex-wrap: wrap; }
.controls { display:flex; gap:8px; align-items:center; flex-wrap: wrap; }
.editor-wrapper-large { flex: 1; min-height: 0; display:flex; flex-direction:column; border:1px solid var(--color-border); border-radius:8px; overflow:hidden; background:var(--color-bg-primary); }
.error-hint { margin:0; padding:0 4px; font-size:12px; color:var(--color-error); line-height:1.4; }

.result-mode { display:flex; flex-direction:column; gap:var(--spacing-md); padding:var(--spacing-md); flex:1; overflow:hidden; }
.result-toolbar { display:flex; justify-content:space-between; align-items:center; padding:10px; background:var(--color-bg-primary); border-radius:12px; gap:var(--spacing-sm); box-shadow: inset 0 -1px 0 var(--color-divider); flex-wrap: wrap; }
.summary { display:flex; gap:12px; font-size:13px; color:var(--color-text-primary); align-items:center; flex:1 1 260px; flex-wrap: wrap; }
.summary .stat { padding:6px 10px; border-radius:999px; background:color-mix(in srgb, var(--color-bg-secondary) 90%, var(--color-bg-primary)); font-weight:600; white-space: nowrap; border:1px solid var(--color-divider); }
.summary .stat.added { color:#0f766e; border-color:rgba(16,185,129,0.18); }
.summary .stat.removed { color:#b91c1c; border-color:rgba(239,68,68,0.18); }
.summary .stat.changed { color:#9a3412; border-color:rgba(245,158,11,0.18); }
.summary .stat.unchanged { color:#4b5563; border-color:rgba(156,163,175,0.12); }

.actions { display:flex; gap:8px; align-items:center; flex-wrap: wrap; justify-content:flex-end; }
.diff-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--color-divider);
  background: color-mix(in srgb, var(--color-bg-secondary) 90%, var(--color-bg-primary));
  color: var(--color-text-primary);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  transition: transform 160ms ease, border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease, color 160ms ease;
}

.diff-btn:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-divider));
  background: color-mix(in srgb, var(--color-bg-secondary) 80%, var(--color-primary) 20%);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
}

.diff-btn:active {
  transform: translateY(0);
  box-shadow: none;
}

.diff-btn:disabled {
  opacity: 0.62;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.diff-btn--primary {
  border-color: color-mix(in srgb, var(--color-primary) 42%, var(--color-divider));
  background: color-mix(in srgb, var(--color-primary) 12%, var(--color-bg-secondary));
  color: color-mix(in srgb, var(--color-primary) 72%, var(--color-text-primary));
}

.diff-btn--primary:hover {
  background: color-mix(in srgb, var(--color-primary) 18%, var(--color-bg-secondary));
  border-color: color-mix(in srgb, var(--color-primary) 58%, var(--color-divider));
}

.diff-btn--ghost {
  background: color-mix(in srgb, var(--color-bg-secondary) 94%, var(--color-bg-primary));
}

.diff-btn--ghost:hover {
  background: color-mix(in srgb, var(--color-bg-secondary) 84%, var(--color-primary) 16%);
}

.result-content { flex:1; overflow-y:auto; background:var(--color-bg-primary); border-radius:12px; border:1px solid var(--color-divider); padding:10px; }
.result-inner { height:100%; min-height:0; display:flex; flex-direction:column; }


.node-type { margin-left:6px; font-size:11px; color:var(--color-text-tertiary); }
.node-val { margin-left:auto; font-size:12px; color:var(--color-text-tertiary); }

.result-empty { flex:1; display:flex; align-items:center; justify-content:center; color:var(--color-text-tertiary); font-size:13px; }
  .global-error { padding:8px; background:rgba(239,68,68,0.1); border-top:1px solid rgba(239,68,68,0.3); color:var(--color-error); font-size:11px; text-align:center; }

  .diff-sidebar.collapsed .input-mode,
  .diff-sidebar.collapsed .result-mode,
  .diff-sidebar.collapsed .result-content,
  .diff-sidebar.collapsed .result-empty {
    display: none;
  }

@media (max-width: 900px) {
  .result-toolbar {
    padding: 10px;
  }

  .actions {
    justify-content: flex-start;
  }

  .diff-btn {
    padding: 6px 10px;
  }
}

  .diff-sidebar.collapsed .diff-sidebar-header { display: none; }

  /* 清理：移除不再使用的标签样式（原 .diff-tabs/.tab-btn） */
  .diff-tabs { display: none !important; }
  .tab-btn { display: none !important; }

</style>
