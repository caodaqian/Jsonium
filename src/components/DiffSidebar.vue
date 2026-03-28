<script setup>
import { ref, computed } from 'vue';
const emit = defineEmits(['openLineDiff']);
import { useJsonStore } from '../store/index.js';
import Editor from './Editor.vue';
import { buildTreeDiff, stringifySortedJson } from '../services/diffEngine.js';

const store = useJsonStore();

const visible = computed(() => store.diffSidebar.visible);
const mode = computed(() => store.diffSidebar.mode);
const collapsed = computed(() => store.diffSidebar.collapsed);

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

</script>

<template>
  <aside class="diff-sidebar" :class="{ active: visible, collapsed: collapsed }">
    <header class="diff-sidebar-header">
      <h3 class="title">JSON 对比（基准：主编辑区）</h3>
      <button class="close-btn" @click="closeSidebar">✕</button>
    </header>

    <!-- 原先的视图切换按钮已移除（输入 / 行级），保留侧边栏主要交互 -->


    <!-- 输入模式：单编辑器 -->
    <div v-if="mode === 'input'" class="input-mode">
      <div class="input-header">
        <label>待比对 JSON（A）</label>
        <div class="controls">
          <button class="format-btn" @click="handleFormatLeft">📐 格式化</button>
          <button class="compare-btn primary" @click="handleCompare" :disabled="isComparing">
            {{ isComparing ? '对比中...' : '⚖️ 对比主编辑区' }}
          </button>
        </div>
      </div>

      <div class="editor-wrapper-large">
        <Editor
          ref="editorRef"
          :content="leftInput"
          :autoFormat="store.getEditorSettings().autoFormat"
          :debounceMs="store.getEditorSettings().debounceMs || 300"
          :autoFormatOnIdle="store.getEditorSettings().autoFormatOnIdle"
          :autoFormatOnPaste="store.getEditorSettings().autoFormatOnPaste"
          @change="handleLeftChange"
        />
      </div>

      <p v-if="leftError" class="error-hint">⚠️ {{ leftError }}</p>
      <p v-if="globalError" class="error-hint">⚠️ {{ globalError }}</p>
    </div>


    <div v-if="error && mode === 'result'" class="global-error">
      {{ error }}
    </div>
  </aside>
</template>

<style scoped>
.diff-sidebar {
  width: 520px;
  max-width: 100%;
  background: var(--color-bg-secondary);
  border-left: 1px solid var(--color-divider);
  display: none;
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  flex-direction: column;
  overflow: hidden;
  box-shadow: -4px 0 24px rgba(0,0,0,0.18);
  z-index: 99999;
}
.diff-sidebar.active { display: flex; }

.diff-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-divider);
  gap: var(--spacing-sm);
}
.title { margin: 0; font-size: 14px; font-weight: 600; color: var(--color-text-primary); }
.close-btn { background: none; border: none; cursor: pointer; font-size: 18px; color: var(--color-text-tertiary); padding: 0; }

.input-mode { display:flex; flex-direction:column; gap:var(--spacing-md); padding:var(--spacing-md); flex:1; overflow-y:auto; }
.input-header { display:flex; justify-content:space-between; align-items:center; gap:var(--spacing-sm); }
.controls { display:flex; gap:8px; align-items:center; }

  .editor-wrapper-large { flex: 1; min-height: 0; display:flex; flex-direction:column; border:1px solid var(--color-border); border-radius:4px; overflow:hidden; background:var(--color-bg-primary); }

.error-hint { margin:0; padding:0 4px; font-size:11px; color:var(--color-error); line-height:1.4; }

.result-mode { display:flex; flex-direction:column; gap:var(--spacing-md); padding:var(--spacing-md); flex:1; overflow:hidden; }
.result-toolbar { display:flex; justify-content:space-between; align-items:center; padding:8px; background:var(--color-bg-primary); border-radius:4px; gap:var(--spacing-sm); }
.summary { display:flex; gap:var(--spacing-md); font-size:12px; color:var(--color-text-primary); }
.stat.added { color:#10b981; } .stat.removed { color:#ef4444; } .stat.changed { color:#f59e0b; }

.actions { display:flex; gap:8px; align-items:center; }

.result-content { flex:1; overflow-y:auto; background:var(--color-bg-primary); border-radius:4px; border:1px solid var(--color-divider); padding:8px; }

  .tree-root { font-family: 'Monaco','Menlo','Courier New',monospace; font-size:13px; color:var(--color-text-primary); }

.tree-node { margin-left: 4px; }
.node-line { display:flex; align-items:center; gap:8px; padding:4px 6px; border-bottom:1px solid var(--color-divider); }
.node-line.added { background: rgba(16,185,129,0.06); }
.node-line.removed { background: rgba(239,68,68,0.06); }
.node-line.changed { background: rgba(245,158,11,0.04); }

.toggle-btn { background:none; border:none; cursor:pointer; padding:0 6px; font-size:12px; }
.toggle-placeholder { width:18px; display:inline-block; }

.node-key { font-weight:500; color:var(--color-text-primary); }
.node-type { margin-left:6px; font-size:11px; color:var(--color-text-tertiary); }
.node-val { margin-left:auto; font-size:12px; color:var(--color-text-tertiary); }

.result-empty { flex:1; display:flex; align-items:center; justify-content:center; color:var(--color-text-tertiary); font-size:13px; }
  .global-error { padding:8px; background:rgba(239,68,68,0.1); border-top:1px solid rgba(239,68,68,0.3); color:var(--color-error); font-size:11px; text-align:center; }

  /* 侧边栏收起样式与悬浮箭头 */
  .diff-sidebar {
    transition: width 180ms ease;
  }

  .diff-sidebar.collapsed {
    width: 0;
    min-width: 0;
    max-width: 0;
    overflow: hidden;
    border-left: none;
    box-shadow: none;
    display: none;
  }

  .diff-sidebar.collapsed .input-mode,
  .diff-sidebar.collapsed .result-mode,
  .diff-sidebar.collapsed .result-content,
  .diff-sidebar.collapsed .result-empty {
    display: none;
  }




  .diff-sidebar.collapsed .diff-sidebar-header { display: none; }

  /* 清理：移除不再使用的标签样式（原 .diff-tabs/.tab-btn） */
  .diff-tabs { display: none !important; }
  .tab-btn { display: none !important; }

</style>
