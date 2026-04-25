<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
    buildLineDiffs,
    buildLineDiffsAsync,
    extractOnlyDifferences,
    generateDiffSummary,
    getDifferences,
    getValueAtPath
} from '../services/diffEngine.js';
import { WORKER_OFFLOAD_CHARS } from '../services/editorFormatting.js';
import notify from '../services/notify.js';
import { getStringifyIndent } from '../utils/indent.js';
import DiffTextView from './DiffTextView.vue';

const props = defineProps({
  leftContent: String,
  rightContent: String,
  singleColumn: {
    type: Boolean,
    default: false
  }
});

const differences = ref([]);
const summary = ref(null);
const selectedPath = ref(null);
const diffTextRef = ref(null);
const onlyDiffs = ref(false);
const lineDiffs = ref([]);

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
    return JSON.stringify(value, null, getStringifyIndent());
  } catch (e) {
    return content || '';
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

      await nextTick();
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

</script>

<template>
  <div class="diff-view">
    <div class="toolbar">
      <div class="toolbar-title">行级对比</div>
      <div class="toolbar-actions">
        <button class="diff-btn diff-btn--ghost" @click="compareDiffs">刷新</button>
        <label class="toolbar-toggle">
          <input type="checkbox" v-model="onlyDiffs" />
          <span>只显示差异</span>
        </label>
      </div>
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

    <div class="line-body">
      <div class="text-area">
        <DiffTextView
          ref="diffTextRef"
          :left="displayedLeftString"
          :right="displayedRightString"
          :singleColumn="singleColumn"
          language="json"
        />
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

.toolbar-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
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

.diff-btn {
  padding: 6px 10px;
  font-size: 12px;
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
  display: flex;
  min-height: 0;
  flex: 1;
}

.text-area {
  flex: 1;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--color-divider);
  border-radius: 14px;
  overflow: hidden;
  background: var(--color-bg-primary);
  min-height: 360px;
}

.text-area .diff-textview {
  height: 100%;
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
    display: flex;
  }

  .text-area {
    min-height: 300px;
  }
}

@media (max-width: 640px) {
  .diff-view {
    padding: 10px;
  }

  .diff-btn {
    border-radius: 9px;
  }

  .summary-text {
    white-space: normal;
    overflow: visible;
  }

  .line-body {
    display: flex;
  }

  .text-area {
    min-height: 280px;
  }
}
</style>