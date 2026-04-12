<script setup>
import { computed, ref } from 'vue';
import { buildTreeDiff, stringifySortedJson } from '../services/diffEngine.js';
import { useJsonStore } from '../store/index.js';
import DiffView from './DiffView.vue';
import Editor from './Editor.vue';
const emit = defineEmits(['openLineDiff']);

const store = useJsonStore();

const visible = computed(() => store.diffSidebar.visible);
const mode = computed(() => store.diffSidebar.mode);
const collapsed = computed(() => store.diffSidebar.collapsed);
const headerLabel = computed(() => (mode.value === 'input' ? '输入面板' : '结果视图'));

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
      store.diffSidebar.leftInput = JSON.stringify(parsed, null, 2);
      leftError.value = '';
    } catch (e) {
      leftError.value = 'JSON 格式错误: ' + e.message;
    }
  }
}

function handleLeftPaste() {
  setTimeout(() => {
    try {
      const parsed = JSON.parse(leftInput.value || '');
      store.diffSidebar.leftInput = JSON.stringify(parsed, null, 2);
      leftError.value = '';
    } catch (e) {
      // ignore
    }
  }, 0);
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

    // 直接触发行级对比（不构建树形结果）
    openLineDiff();
  } catch (e) {
    store.setDiffError('对比失败: ' + e.message);
  } finally {
    isComparing.value = false;
  }
}

function openLineDiff() {
  const left = store.diffSidebar.leftContent || leftInput.value || '';
  const right = rightContent.value || '';
  emit('openLineDiff', left, right);
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

function embedToBottom() {
  try {
    const left = store.diffSidebar.leftContent || leftInput.value || '';
    const right = store.diffSidebar.rightContent || (store.getActiveTab ? (store.getActiveTab().content || '') : '') || '';
    store.setDiffResult(left, right, {
      diffLines: store.diffSidebar.diffLines || [],
      diffTree: store.diffSidebar.diffTree || null,
      diffStats: store.diffSidebar.diffStats || {}
    });
    // 隐藏侧边并在底部面板展示
    try { store.hideDiffSidebar(); } catch (e) {}
    try { store.outputPanel.visible = true; } catch (e) {}
    try { store.switchOutputTab('diff'); } catch (e) {}
  } catch (e) {
    store.setDiffError('嵌入底部失败: ' + (e && e.message ? e.message : String(e)));
  }
}

</script>

<template>
  <aside class="diff-sidebar" :class="{ active: visible, collapsed: collapsed }">
    <header class="diff-sidebar-header">
      <div class="header-copy">
        <h3 class="title">对比</h3>
        <span class="header-badge">{{ headerLabel }}</span>
      </div>
      <button class="close-btn" @click="closeSidebar" title="关闭" aria-label="关闭对比侧栏">✕</button>
    </header>

    <div v-if="mode === 'input'" class="input-mode">
      <div class="input-header">
        <div class="controls">
          <button class="diff-btn diff-btn--ghost" @click="handleFormatLeft">格式化</button>
          <button class="diff-btn diff-btn--ghost" @click="handleLeftPaste">粘贴并格式化</button>
        </div>
        <div class="actions">
          <button class="diff-btn diff-btn--primary" @click="handleCompare" :disabled="isComparing">⚖️ 对比主编辑区</button>
          <button class="diff-btn diff-btn--ghost" @click="embedToBottom">📥 在底部展示</button>
        </div>
      </div>

      <div class="editor-wrapper-large">
        <Editor ref="editorRef" :content="leftInput" @change="handleLeftChange" />
      </div>
      <p v-if="leftError" class="error-hint">{{ leftError }}</p>
    </div>

    <div v-else class="result-mode">
      <div class="result-toolbar">
        <div class="summary">
          <div class="stat added">新增: {{ diffStats.added }}</div>
          <div class="stat removed">删除: {{ diffStats.removed }}</div>
          <div class="stat changed">变化: {{ diffStats.changed }}</div>
          <div class="stat unchanged">相同: {{ diffStats.unchanged }}</div>
        </div>
        <div class="actions">
          <button class="diff-btn diff-btn--ghost" @click="openLineDiff">行级对比</button>
          <button class="diff-btn diff-btn--ghost" @click="embedToBottom">嵌入底部</button>
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
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  flex-direction: column;
  overflow: hidden;
  box-shadow: -8px 0 32px rgba(0,0,0,0.12);
  z-index: 99999;
  transition: width 180ms ease;
}
.diff-sidebar.active { display: flex; }
.diff-sidebar.collapsed { width: 0; min-width: 0; max-width: 0; overflow: hidden; border-left: none; box-shadow: none; display: none; }

.diff-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-divider) 82%, transparent);
  background: color-mix(in srgb, var(--color-bg-secondary) 88%, var(--color-bg-primary));
  backdrop-filter: blur(10px);
}

.header-copy {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
}

.header-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: color-mix(in srgb, var(--color-text-secondary) 78%, var(--color-text-primary));
  background: color-mix(in srgb, var(--color-bg-primary) 80%, var(--color-bg-secondary));
  border: 1px solid color-mix(in srgb, var(--color-divider) 72%, transparent);
  white-space: nowrap;
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
  box-shadow: 0 1px 0 rgba(255,255,255,0.04), 0 4px 10px rgba(0,0,0,0.04);
  transition: transform 160ms ease, background-color 160ms ease, color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}
.close-btn:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--color-bg-primary) 72%, var(--color-primary) 10%);
  border-color: color-mix(in srgb, var(--color-primary) 28%, var(--color-divider));
  color: var(--color-text-primary);
  box-shadow: 0 6px 16px rgba(0,0,0,0.08);
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
