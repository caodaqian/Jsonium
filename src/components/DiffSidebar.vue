<script setup>
import { ref, computed } from 'vue';
const emit = defineEmits(['openLineDiff']);
import { useJsonStore } from '../store/index.js';
import Editor from './Editor.vue';
import { buildTreeDiff, stringifySortedJson } from '../services/diffEngine.js';

const store = useJsonStore();

const visible = computed(() => store.diffSidebar.visible);
const mode = computed(() => store.diffSidebar.mode);

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
    let sortedLeft, sortedRight;
    try {
      sortedLeft = stringifySortedJson(leftInput.value);
    } catch (e) {
      leftError.value = '待比对 JSON 格式错误: ' + e.message;
      isComparing.value = false;
      return;
    }
    try {
      sortedRight = stringifySortedJson(rightContent.value);
    } catch (e) {
      globalError.value = '主编辑区 JSON 格式错误: ' + e.message;
      isComparing.value = false;
      return;
    }

    const result = buildTreeDiff(sortedLeft, sortedRight);
    // 将结果写入 store（兼容旧接口）
    store.setDiffResult(sortedLeft, sortedRight, {
      diffTree: result.tree,
      diffStats: result.stats,
      diffLines: []
    });
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

function closeSidebar() {
  store.hideDiffSidebar();
  leftError.value = '';
  globalError.value = '';
}

import DiffTreeNode from './DiffTreeNode.vue';
</script>

<template>
  <aside class="diff-sidebar" :class="{ active: visible }">
    <header class="diff-sidebar-header">
      <h3 class="title">JSON 对比（基准：主编辑区）</h3>
      <button class="close-btn" @click="closeSidebar">✕</button>
    </header>

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

      <div class="editor-wrapper-small">
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

    <!-- 结果模式：树形展示 -->
    <div v-if="mode === 'result'" class="result-mode">
      <div class="result-toolbar">
        <div class="summary">
          <span class="stat added">➕ {{ diffStats.added }}</span>
          <span class="stat removed">➖ {{ diffStats.removed }}</span>
          <span class="stat changed">🔄 {{ diffStats.changed }}</span>
          <span class="stat unchanged" v-if="diffStats.unchanged">· {{ diffStats.unchanged }}</span>
        </div>

        <div class="actions">
          <select v-model="diffFilter">
            <option value="all">全部</option>
            <option value="changed">仅变更</option>
            <option value="added">仅新增</option>
            <option value="removed">仅删除</option>
          </select>
          <button class="line-btn" @click="openLineDiff">🔎 行级对比</button>
          <button class="back-btn" @click="handleBackToInput">↩ 重新输入</button>
        </div>
      </div>

      <div class="result-content" v-if="diffTree">
        <div class="tree-root">
          <DiffTreeNode :node="diffTree" :filter="diffFilter" />
        </div>
      </div>

      <div v-else class="result-empty">
        <p>✓ 两个 JSON 相同或无差异节点</p>
      </div>
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

.editor-wrapper-small { height: 220px; border:1px solid var(--color-border); border-radius:4px; overflow:hidden; background:var(--color-bg-primary); }

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
</style>