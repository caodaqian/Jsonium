<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
    buildLineDiffs,
    buildLineDiffsAsync,
    computeDiffStats,
    findLineForPath as engineFindLineForPath,
    extractOnlyDifferences,
    generateDiffSummary,
    getDifferences,
    getValueAtPath
} from '../services/diffEngine.js';
import { WORKER_OFFLOAD_CHARS } from '../services/editorFormatting.js';
import notify from '../services/notify.js';
import DiffTextView from './DiffTextView.vue';
import DiffTreeNode from './DiffTreeNode.vue';

const props = defineProps({
  leftContent: String,
  rightContent: String
});

const differences = ref([]);
const summary = ref(null);
const selectedPath = ref(null);
const diffTextRef = ref(null);
const onlyDiffs = ref(false);
const lineDiffs = ref([]);
const folded = ref(false);
const foldThreshold = 5;
const currentTab = ref('line');
const treeRoot = ref(null);
const treeStats = ref({ added: 0, removed: 0, changed: 0, unchanged: 0 });
const treeError = ref('');
const expandAllFlag = ref(null);

const diffCounts = computed(() => {
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  (lineDiffs.value || []).forEach((diff) => {
    if (!diff || !diff.type) return;
    if (diff.type === 'added') counts.added += 1;
    else if (diff.type === 'removed') counts.removed += 1;
    else if (diff.type === 'unchanged') counts.unchanged += 1;
    else counts.changed += 1;
  });
  return counts;
});

const compactSummary = computed(() => {
  const total = summary.value?.total ?? (diffCounts.value.added + diffCounts.value.removed + diffCounts.value.changed);
  const added = summary.value?.keyAdded ?? diffCounts.value.added;
  const removed = summary.value?.keyRemoved ?? diffCounts.value.removed;
  const typeChanges = summary.value?.typeChanges ?? 0;
  const valueChanges = summary.value?.valueChanges ?? diffCounts.value.changed;
  const unchanged = diffCounts.value.unchanged;

  return `总计差异 ${total} · 新增 ${added} · 删除 ${removed} · 类型 ${typeChanges} · 值 ${valueChanges} · 相同 ${unchanged}`;
});

const filteredLineDiffs = computed(() => (lineDiffs.value || []).filter((diff) => diff && diff.type !== 'unchanged'));

const displayedLeft = computed(() => {
  try {
    if (onlyDiffs.value) {
      const result = extractOnlyDifferences(props.leftContent, props.rightContent);
      if (result && result.success) {
        const left = result.left;
        if (!selectedPath.value) return pretty(left);
        const value = getValueAtPath(left, selectedPath.value);
        return pretty(value === undefined ? '' : value);
      }
    }
    return getSubContent(selectedPath.value, props.leftContent);
  } catch (e) {
    return getSubContent(selectedPath.value, props.leftContent);
  }
});

const displayedRight = computed(() => {
  try {
    if (onlyDiffs.value) {
      const result = extractOnlyDifferences(props.leftContent, props.rightContent);
      if (result && result.success) {
        const right = result.right;
        if (!selectedPath.value) return pretty(right);
        const value = getValueAtPath(right, selectedPath.value);
        return pretty(value === undefined ? '' : value);
      }
    }
    return getSubContent(selectedPath.value, props.rightContent);
  } catch (e) {
    return getSubContent(selectedPath.value, props.rightContent);
  }
});

const displayedLeftString = computed(() => String(displayedLeft.value || ''));
const displayedRightString = computed(() => String(displayedRight.value || ''));

function pretty(content) {
  try {
    const value = typeof content === 'string' ? JSON.parse(content) : content;
    return JSON.stringify(value, null, 2);
  } catch (e) {
    return content || '';
  }
}

function findLineForPath(prettyContent, path) {
  try {
    return engineFindLineForPath(prettyContent, path);
  } catch (e) {
    return null;
  }
}

function getSubContent(path, content) {
  try {
    if (!path) return pretty(content);
    const obj = typeof content === 'string' ? JSON.parse(content) : content;
    const value = getValueAtPath(obj, path);
    return pretty(value === undefined ? '' : value);
  } catch (e) {
    return pretty(content);
  }
}

async function compareDiffs() {
  if (!props.leftContent || !props.rightContent) {
    notify.warn('请输入两个 JSON');
    return;
  }

  try {
    const result = getDifferences(props.leftContent, props.rightContent);
    if (result.success) {
      differences.value = result.differences;
      summary.value = generateDiffSummary(result.differences);
    }

    try {
      const sortedLeft = typeof props.leftContent === 'string' ? props.leftContent : JSON.stringify(props.leftContent);
      const sortedRight = typeof props.rightContent === 'string' ? props.rightContent : JSON.stringify(props.rightContent);
      const treeResult = await import('../services/diffEngine.js').then((m) => m.buildTreeDiff(sortedLeft, sortedRight));

      function prune(node) {
        if (!node) return null;
        if (node.children && node.children.length) {
          node.children = node.children.map(prune).filter(Boolean);
        }
        if (node.type === 'unchanged' && (!node.children || node.children.length === 0)) return null;
        return node;
      }

      const pruned = prune(treeResult.tree);
      treeRoot.value = pruned || null;
      treeStats.value = pruned ? computeDiffStats(pruned) : { added: 0, removed: 0, changed: 0, unchanged: 0 };
      treeError.value = '';
    } catch (e) {
      treeRoot.value = null;
      treeStats.value = { added: 0, removed: 0, changed: 0, unchanged: 0 };
      treeError.value = '生成树形对比失败: ' + (e && e.message ? e.message : String(e));
    }

    try {
      const leftText = String(displayedLeftString.value || '').split(/\r?\n/);
      const rightText = String(displayedRightString.value || '').split(/\r?\n/);
      const leftStr = leftText.join('\n');
      const rightStr = rightText.join('\n');
      const useWorker = leftStr.length > (WORKER_OFFLOAD_CHARS || 0) || rightStr.length > (WORKER_OFFLOAD_CHARS || 0);

      let lineDiffResult;
      if (useWorker && typeof buildLineDiffsAsync === 'function') {
        try {
          lineDiffResult = await buildLineDiffsAsync(leftStr, rightStr);
        } catch (e) {
          lineDiffResult = buildLineDiffs(leftText, rightText);
        }
      } else {
        lineDiffResult = buildLineDiffs(leftText, rightText);
      }
      lineDiffs.value = lineDiffResult;

      const leftRanges = [];
      const rightRanges = [];
      let index = 0;
      while (index < lineDiffResult.length) {
        if (lineDiffResult[index].type === 'unchanged') {
          const start = index;
          let end = index;
          while (end < lineDiffResult.length && lineDiffResult[end].type === 'unchanged') end += 1;
          if (end - start >= foldThreshold) {
            const firstLeft = lineDiffResult[start].leftLine;
            const lastLeft = lineDiffResult[end - 1].leftLine;
            const firstRight = lineDiffResult[start].rightLine;
            const lastRight = lineDiffResult[end - 1].rightLine;
            if (firstLeft && lastLeft && firstLeft < lastLeft) leftRanges.push([firstLeft, lastLeft]);
            if (firstRight && lastRight && firstRight < lastRight) rightRanges.push([firstRight, lastRight]);
          }
          index = end;
        } else {
          index += 1;
        }
      }

      await nextTick();
      if (diffTextRef.value && typeof diffTextRef.value.foldRanges === 'function') {
        diffTextRef.value.foldRanges({ left: leftRanges, right: rightRanges });
        folded.value = leftRanges.length > 0 || rightRanges.length > 0;
      }
    } catch (e) {
      // ignore line diff errors
    }
  } catch (e) {
    notify.error('对比失败: ' + e.message);
  }
}

onMounted(() => {
  try {
    compareDiffs();
  } catch (e) {
    // ignore
  }
});

watch(() => [props.leftContent, props.rightContent], () => {
  try {
    compareDiffs();
  } catch (e) {
    // ignore
  }
});

async function openTextView(path = null) {
  selectedPath.value = path;
  currentTab.value = 'line';
  await nextTick();

  if (!path) return;
  const leftPretty = pretty(displayedLeft.value);
  const rightPretty = pretty(displayedRight.value);
  const origLine = findLineForPath(leftPretty, path);
  const modLine = findLineForPath(rightPretty, path);

  const tryReveal = (attempt = 0) => {
    try {
      if (!diffTextRef.value) throw new Error('no diffTextRef');
      if (origLine) diffTextRef.value.revealOriginalLine(origLine);
      if (modLine) diffTextRef.value.revealModifiedLine(modLine);
    } catch (e) {
      if (attempt < 6) {
        setTimeout(() => tryReveal(attempt + 1), 150);
      }
    }
  };
  tryReveal();
}

function trimSnippet(text, len = 80) {
  try {
    const str = String(text || '').trim().replace(/\s+/g, ' ');
    if (str.length <= len) return str;
    return str.slice(0, len - 1) + '…';
  } catch (e) {
    return '';
  }
}

function jumpToLine(diff) {
  try {
    if (!diffTextRef.value) return;
    if (diff.type === 'removed' && diff.leftLine) {
      diffTextRef.value.revealOriginalLine(diff.leftLine);
    } else if (diff.type === 'added' && diff.rightLine) {
      diffTextRef.value.revealModifiedLine(diff.rightLine);
    } else if (diff.type === 'unchanged') {
      if (diff.leftLine) diffTextRef.value.revealOriginalLine(diff.leftLine);
      if (diff.rightLine) diffTextRef.value.revealModifiedLine(diff.rightLine);
    } else {
      if (diff.leftLine) diffTextRef.value.revealOriginalLine(diff.leftLine);
      if (diff.rightLine) diffTextRef.value.revealModifiedLine(diff.rightLine);
    }
  } catch (e) {
    // ignore
  }
}

function expandAllNodes(value) {
  expandAllFlag.value = !!value;
  setTimeout(() => {
    expandAllFlag.value = null;
  }, 100);
}
</script>

<template>
  <div class="diff-view">
    <div class="toolbar">
      <div class="tabs">
        <button :class="['tab-btn', { active: currentTab === 'line' }]" @click="currentTab = 'line'">行级对比</button>
        <button :class="['tab-btn', { active: currentTab === 'tree' }]" @click="currentTab = 'tree'">diff 树状对比</button>
      </div>
      <label class="toolbar-toggle">
        <input type="checkbox" v-model="onlyDiffs" />
        <span>只显示差异</span>
      </label>
    </div>

    <div class="summary-strip">
      <div class="summary-text">{{ compactSummary }}</div>
      <div class="summary-pills" aria-label="差异统计">
        <span class="pill added">新增 <b>{{ diffCounts.added }}</b></span>
        <span class="pill removed">删除 <b>{{ diffCounts.removed }}</b></span>
        <span class="pill changed">变化 <b>{{ diffCounts.changed }}</b></span>
        <span class="pill unchanged">相同 <b>{{ diffCounts.unchanged }}</b></span>
      </div>
    </div>

    <div v-if="currentTab === 'line'" class="line-body">
      <div class="text-area">
        <DiffTextView
          ref="diffTextRef"
          :left="displayedLeftString"
          :right="displayedRightString"
          language="json"
        />
      </div>

      <div class="list-area">
        <div class="list-header">
          <div class="title">行级差异</div>
          <div class="controls">
              <button class="diff-btn diff-btn--ghost" @click="compareDiffs">刷新</button>
              <button class="diff-btn diff-btn--ghost" @click="() => { if (diffTextRef.value && diffTextRef.value.clearFold) diffTextRef.value.clearFold(); folded.value = false; }">展开全部</button>
              <button class="diff-btn diff-btn--ghost" v-if="folded" @click="() => { if (diffTextRef.value && diffTextRef.value.clearFold) diffTextRef.value.clearFold(); folded.value = false; }">取消折叠</button>
          </div>
        </div>

        <ul class="diff-list">
          <li v-for="(diff, idx) in filteredLineDiffs" :key="idx">
            <button @click="jumpToLine(diff)" class="diff-list-btn">
              <div class="diff-item-grid">
                <div class="icon" :class="diff.type">
                  <span v-if="diff.type === 'added'">➕</span>
                  <span v-else-if="diff.type === 'removed'">➖</span>
                  <span v-else-if="diff.type === 'unchanged'">·</span>
                  <span v-else>🔄</span>
                </div>
                <div class="meta">
                  <div class="lines">{{ diff.leftLine ? ('L:' + diff.leftLine) : '' }} {{ diff.rightLine ? (' R:' + diff.rightLine) : '' }}</div>
                  <div class="type">{{ diff.type }}</div>
                </div>
                <div class="snippet">{{ trimSnippet(diff.left || diff.right || '') }}</div>
              </div>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="currentTab === 'tree'" class="tree-area">
      <div class="tree-toolbar">
        <button class="diff-btn diff-btn--ghost" @click="compareDiffs">刷新</button>
        <button class="diff-btn diff-btn--ghost" @click="expandAllNodes(true)">展开全部</button>
        <button class="diff-btn diff-btn--ghost" @click="expandAllNodes(false)">折叠全部</button>
        <button class="diff-btn diff-btn--ghost" @click="currentTab = 'line'">切回 行级对比</button>
      </div>
      <div class="tree-root">
        <div v-if="treeError" class="error-hint">{{ treeError }}</div>
        <div v-else-if="!treeRoot">暂无树形结果，请先点击刷新</div>
        <div v-else>
          <div class="tree-stats">
            <span>新增 {{ treeStats.added }}</span>
            <span>删除 {{ treeStats.removed }}</span>
            <span>变化 {{ treeStats.changed }}</span>
            <span>相同 {{ treeStats.unchanged }}</span>
          </div>
          <DiffTreeNode :node="treeRoot" :expandAll="expandAllFlag" @select="openTextView" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 14px;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.tab-btn,
.diff-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--color-divider);
  background: color-mix(in srgb, var(--color-bg-secondary) 90%, var(--color-bg-primary));
  color: var(--color-text-primary);
  border-radius: 999px;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease, color 160ms ease;
}

.tab-btn {
  padding: 7px 12px;
  font-size: 13px;
}

.tab-btn.active {
  background: color-mix(in srgb, var(--color-primary) 12%, var(--color-bg-secondary));
  color: color-mix(in srgb, var(--color-primary) 72%, var(--color-text-primary));
  border-color: color-mix(in srgb, var(--color-primary) 42%, var(--color-divider));
}

.diff-btn {
  padding: 6px 10px;
  font-size: 12px;
}

.tab-btn:hover,
.diff-btn:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-divider));
  background: color-mix(in srgb, var(--color-bg-secondary) 80%, var(--color-primary) 20%);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
}

.tab-btn:active,
.diff-btn:active {
  transform: translateY(0);
  box-shadow: none;
}

.diff-btn--ghost {
  background: color-mix(in srgb, var(--color-bg-secondary) 94%, var(--color-bg-primary));
}

.diff-btn--ghost:hover {
  background: color-mix(in srgb, var(--color-bg-secondary) 84%, var(--color-primary) 16%);
}

.summary-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-divider);
  border-radius: 14px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--color-bg-secondary) 88%, transparent), var(--color-bg-primary));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.summary-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow-x: auto;
  scrollbar-width: thin;
}

.summary-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-divider);
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.pill b {
  color: var(--color-text-primary);
}

.pill.added {
  border-color: rgba(16, 185, 129, 0.18);
  background: color-mix(in srgb, var(--color-bg-secondary) 80%, #10b981 20%);
}

.pill.removed {
  border-color: rgba(239, 68, 68, 0.18);
  background: color-mix(in srgb, var(--color-bg-secondary) 80%, #ef4444 20%);
}

.pill.changed {
  border-color: rgba(245, 158, 11, 0.18);
  background: color-mix(in srgb, var(--color-bg-secondary) 80%, #f59e0b 20%);
}

.pill.unchanged {
  border-color: rgba(148, 163, 184, 0.18);
}

.line-body {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(300px, 0.85fr);
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.text-area,
.list-area,
.tree-area {
  min-height: 0;
}

.text-area {
  border: 1px solid var(--color-divider);
  border-radius: 14px;
  overflow: hidden;
  background: var(--color-bg-primary);
  min-height: 360px;
}

.text-area .diff-textview {
  height: 100%;
}

.list-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.list-header .title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.list-header .controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.diff-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--color-divider);
  border-radius: 14px;
  background: var(--color-bg-secondary);
  overflow: auto;
  min-height: 0;
  flex: 1;
}

.diff-list li + li {
  margin-top: 8px;
}

.diff-list-btn {
  width: 100%;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: left;
}

.diff-item-grid {
  display: grid;
  grid-template-columns: 34px 108px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 10px 10px;
  border-radius: 12px;
  border: 1px solid var(--color-divider);
  background: color-mix(in srgb, var(--color-bg-primary) 84%, transparent);
}

.diff-list-btn:hover .diff-item-grid {
  border-color: color-mix(in srgb, var(--color-primary) 50%, var(--color-divider));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 24%, transparent);
}

.diff-item-grid .icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  font-size: 16px;
}

.diff-item-grid .icon.added {
  background: rgba(16, 185, 129, 0.14);
  color: var(--color-text-primary);
}

.diff-item-grid .icon.removed {
  background: rgba(239, 68, 68, 0.14);
  color: var(--color-text-primary);
}

.diff-item-grid .icon.changed {
  background: rgba(245, 158, 11, 0.14);
  color: var(--color-text-primary);
}

.diff-item-grid .icon.unchanged {
  background: rgba(148, 163, 184, 0.14);
  color: var(--color-text-primary);
}

.diff-item-grid .meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.diff-item-grid .lines {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.diff-item-grid .type {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.diff-item-grid .snippet {
  min-width: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.45;
  word-break: break-word;
}

.tree-area {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.tree-toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tree-root {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--color-divider);
  border-radius: 14px;
  background: var(--color-bg-secondary);
}

.tree-stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.error-hint {
  color: var(--color-error);
  font-size: 12px;
}

@media (max-width: 980px) {
  .diff-view {
    padding: 12px;
    gap: 10px;
  }

  .summary-strip {
    flex-direction: column;
    align-items: stretch;
  }

  .summary-pills {
    justify-content: flex-start;
  }

  .line-body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(320px, 1fr) minmax(220px, auto);
  }

  .text-area {
    min-height: 300px;
  }

  .diff-item-grid {
    grid-template-columns: 32px 96px minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .diff-view {
    padding: 10px;
  }

  .tabs {
    gap: 6px;
  }

  .tab-btn,
  .diff-btn {
    border-radius: 9px;
  }

  .summary-text {
    white-space: normal;
    overflow: visible;
  }

  .line-body {
    grid-template-rows: minmax(280px, auto) auto;
  }

  .text-area {
    min-height: 280px;
  }

  .diff-item-grid {
    grid-template-columns: 30px 1fr;
    grid-template-areas:
      'icon meta'
      'snippet snippet';
  }

  .diff-item-grid .icon {
    grid-area: icon;
  }

  .diff-item-grid .meta {
    grid-area: meta;
  }

  .diff-item-grid .snippet {
    grid-area: snippet;
  }
}
</style>