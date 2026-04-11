<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { buildLineDiffs, buildLineDiffsAsync, computeDiffStats, findLineForPath as engineFindLineForPath, extractOnlyDifferences, generateDiffSummary, getDifferences, getValueAtPath } from '../services/diffEngine.js';
import { WORKER_OFFLOAD_CHARS } from '../services/editorFormatting.js';
import notify from '../services/notify.js';
import DiffTextView from './DiffTextView.vue';

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
const filteredLineDiffs = computed(() => (lineDiffs.value || []).filter(d => d && d.type !== 'unchanged'));
const folded = ref(false);
const foldThreshold = 5; // 连续相同行超过此值则可折叠
const currentTab = ref('line');
const treeRoot = ref(null);
const treeStats = ref({ added:0, removed:0, changed:0, unchanged:0 });
const treeError = ref('');
const expandAllFlag = ref(null);

function expandAllNodes(val) {
  expandAllFlag.value = !!val;
  // reset after a tick so subsequent toggles work
  setTimeout(() => { expandAllFlag.value = null; }, 100);
}

const displayedLeft = computed(() => {
  try {
    if (onlyDiffs.value) {
      const res = extractOnlyDifferences(props.leftContent, props.rightContent);
      if (res && res.success) {
        const left = res.left;
        if (!selectedPath.value) return pretty(left);
        const val = getValueAtPath(left, selectedPath.value);
        return pretty(val === undefined ? '' : val);
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
      const res = extractOnlyDifferences(props.leftContent, props.rightContent);
      if (res && res.success) {
        const right = res.right;
        if (!selectedPath.value) return pretty(right);
        const val = getValueAtPath(right, selectedPath.value);
        return pretty(val === undefined ? '' : val);
      }
    }
    return getSubContent(selectedPath.value, props.rightContent);
  } catch (e) {
    return getSubContent(selectedPath.value, props.rightContent);
  }
});

const displayedLeftString = computed(() => String(typeof displayedLeft === 'function' ? displayedLeft() : (displayedLeft.value || '')));
const displayedRightString = computed(() => String(typeof displayedRight === 'function' ? displayedRight() : (displayedRight.value || '')));

const diffContent = computed(() => {
  if (!differences.value.length) return 'No differences';
  return differences.value
    .map(diff => {
      let icon = '•';
      if (diff.type === 'key-added') icon = '➕';
      if (diff.type === 'key-removed') icon = '➖';
      if (diff.type === 'type-mismatch') icon = '⚠️';
      if (diff.type === 'value-change') icon = '🔄';
      return `${icon} ${diff.path}: ${diff.type}`;
    })
    .join('\n');
});

function pretty(content) {
  try {
    const obj = typeof content === 'string' ? JSON.parse(content) : content;
    return JSON.stringify(obj, null, 2);
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
    const val = getValueAtPath(obj, path);
    return pretty(val === undefined ? '' : val);
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
    // 同时为树形对比准备数据（用于 tree tab）
    try {
      const sortedLeft = (typeof props.leftContent === 'string') ? props.leftContent : JSON.stringify(props.leftContent);
      const sortedRight = (typeof props.rightContent === 'string') ? props.rightContent : JSON.stringify(props.rightContent);
      const treeRes = (await import('../services/diffEngine.js')).buildTreeDiff(sortedLeft, sortedRight);
      // prune unchanged-only branches from the tree so UI doesn't show irrelevant unchanged nodes
      function prune(node) {
        if (!node) return null;
        if (node.children && node.children.length) {
          const children = node.children.map(prune).filter(Boolean);
          node.children = children;
        }
        // if node is unchanged and has no children after pruning, remove it
        if (node.type === 'unchanged' && (!node.children || node.children.length === 0)) return null;
        return node;
      }

      const pruned = prune(treeRes.tree);
      treeRoot.value = pruned || null;
      // recompute stats from pruned tree
      if (pruned) treeStats.value = computeDiffStats(pruned);
      else treeStats.value = { added:0, removed:0, changed:0, unchanged:0 };
      treeError.value = '';
    } catch (e) {
      treeRoot.value = null;
      treeStats.value = { added:0, removed:0, changed:0, unchanged:0 };
      treeError.value = '生成树形对比失败: ' + (e && e.message ? e.message : String(e));
    }

    // 生成行级 diff 并触发 DiffTextView 装饰与折叠计算
      try {
      const leftText = String(displayedLeftString.value || '').split(/\r?\n/);
      const rightText = String(displayedRightString.value || '').split(/\r?\n/);
      const leftStr = leftText.join('\n');
      const rightStr = rightText.join('\n');
      const useWorker = (leftStr.length > (WORKER_OFFLOAD_CHARS || 0)) || (rightStr.length > (WORKER_OFFLOAD_CHARS || 0));
      let ld;
      if (useWorker && typeof buildLineDiffsAsync === 'function') {
        try { ld = await buildLineDiffsAsync(leftStr, rightStr); } catch (e) { ld = buildLineDiffs(leftText, rightText); }
      } else {
        ld = buildLineDiffs(leftText, rightText);
      }
      lineDiffs.value = ld;

      // 计算折叠区间：扫描连续 unchanged 段
      const leftRanges = [];
      const rightRanges = [];
      let i = 0;
      while (i < ld.length) {
        if (ld[i].type === 'unchanged') {
          const start = i;
          let j = i;
          while (j < ld.length && ld[j].type === 'unchanged') j++;
          const len = j - start;
          if (len >= foldThreshold) {
            // left lines for first and last unchanged entries
            const firstLeft = ld[start].leftLine;
            const lastLeft = ld[j - 1].leftLine;
            const firstRight = ld[start].rightLine;
            const lastRight = ld[j - 1].rightLine;
            if (firstLeft && lastLeft && firstLeft < lastLeft) leftRanges.push([firstLeft, lastLeft]);
            if (firstRight && lastRight && firstRight < lastRight) rightRanges.push([firstRight, lastRight]);
          }
          i = j;
        } else {
          i++;
        }
      }

      // 将折叠范围发送到 DiffTextView
      try {
        await nextTick();
        if (diffTextRef.value && typeof diffTextRef.value.foldRanges === 'function') {
          diffTextRef.value.foldRanges({ left: leftRanges, right: rightRanges });
          folded.value = (leftRanges.length || rightRanges.length) > 0;
        }
      } catch (e) {
        // ignore
      }
    } catch (e) {
      // ignore line diff errors
    }
  } catch (e) {
    notify.error('对比失败: ' + e.message);
  }
}

onMounted(() => {
  // 自动在组件挂载或 props 变化时触发一次对比，使 DiffTextView 能立即显示装饰与折叠
  try { compareDiffs(); } catch (e) {}
});

watch(() => [props.leftContent, props.rightContent], () => {
  try { compareDiffs(); } catch (e) {}
});

async function openTextView(path = null) {
  selectedPath.value = path;

  // 切回行级对比 tab，确保编辑器被渲染和初始化
  currentTab.value = 'line';
  await nextTick();

  if (!path) return;
  const leftPretty = pretty(displayedLeft.value);
  const rightPretty = pretty(displayedRight.value);
  const origLine = findLineForPath(leftPretty, path);
  const modLine = findLineForPath(rightPretty, path);

  // 尝试在 editor 准备好后定位，最多重试若干次以避免 race
  const tryReveal = (attempt = 0) => {
    try {
      if (!diffTextRef.value) throw new Error('no diffTextRef');
      // rely on the exposed methods; if editor not ready these may be no-ops
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

function trimSnippet(s, len = 80) {
  try {
    const str = String(s || '').trim().replace(/\s+/g, ' ');
    if (str.length <= len) return str;
    return str.slice(0, len - 1) + '…';
  } catch (e) {
    return '';
  }
}

function jumpToLine(d) {
  try {
    if (!diffTextRef.value) return;
    if (d.type === 'removed' && d.leftLine) {
      diffTextRef.value.revealOriginalLine(d.leftLine);
    } else if (d.type === 'added' && d.rightLine) {
      diffTextRef.value.revealModifiedLine(d.rightLine);
    } else if (d.type === 'unchanged') {
      if (d.leftLine) diffTextRef.value.revealOriginalLine(d.leftLine);
      if (d.rightLine) diffTextRef.value.revealModifiedLine(d.rightLine);
    } else {
      // value-change or others: try both
      if (d.leftLine) diffTextRef.value.revealOriginalLine(d.leftLine);
      if (d.rightLine) diffTextRef.value.revealModifiedLine(d.rightLine);
    }
  } catch (e) {
    // ignore
  }
}
</script>

<template>
  <div class="diff-view">
    <div class="toolbar">
      <div class="tabs">
        <button :class="['tab-btn', { active: currentTab==='line' }]" @click="currentTab='line'">行级对比</button>
        <button :class="['tab-btn', { active: currentTab==='tree' }]" @click="currentTab='tree'">diff 树状对比</button>
      </div>
      <div style="margin-left:auto;">
        <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" v-model="onlyDiffs" />
          <span>只显示差异</span>
        </label>
      </div>
    </div>

    <div v-if="summary" class="diff-summary">
      <p>总计差异: {{ summary.total }}</p>
      <p v-if="summary.keyAdded">➕ 新增: {{ summary.keyAdded }}</p>
      <p v-if="summary.keyRemoved">➖ 删除: {{ summary.keyRemoved }}</p>
      <p v-if="summary.typeChanges">⚠️ 类型变化: {{ summary.typeChanges }}</p>
      <p v-if="summary.valueChanges">🔄 值变化: {{ summary.valueChanges }}</p>
    </div>

    <div class="list-area" style="margin-bottom:8px;" v-if="currentTab === 'line'">
      <div style="display:flex;align-items:center;gap:8px;">
        <strong>行级差异</strong>
        <button class="diff-btn" @click="compareDiffs">刷新</button>
        <button class="diff-btn" @click="() => { if (diffTextRef.value && diffTextRef.value.clearFold) diffTextRef.value.clearFold(); folded.value=false; }">展开全部</button>
        <button class="diff-btn" v-if="folded" @click="() => { if (diffTextRef.value && diffTextRef.value.clearFold) diffTextRef.value.clearFold(); folded.value=false; }">取消折叠</button>
      </div>
      <ul class="diff-list" style="margin-top:8px;max-height:120px;overflow:auto;">
        <li v-for="(d, idx) in filteredLineDiffs" :key="idx">
          <button @click="jumpToLine(d)" style="background:none;border:none;cursor:pointer;font-family:monospace;">
            <span v-if="d.type==='added'">➕</span>
            <span v-else-if="d.type==='removed'">➖</span>
            <span v-else>·</span>
            <span style="margin-left:8px;color:var(--color-text-primary);font-size:13px;">
              {{ d.leftLine ? ('L:' + d.leftLine) : '' }} {{ d.rightLine ? (' R:' + d.rightLine) : '' }}
            </span>
            <span class="type" style="margin-left:12px;">{{ d.type }}</span>
            <span style="margin-left:8px;color:var(--color-text-tertiary)">{{ trimSnippet(d.left || d.right || '') }}</span>
          </button>
        </li>
      </ul>
    </div>

    <div v-if="currentTab === 'line'" class="text-area">
      <DiffTextView
        ref="diffTextRef"
        :left="displayedLeftString"
        :right="displayedRightString"
        :language="'json'"
      />
    </div>

    <div v-if="currentTab === 'tree'" class="tree-area" style="display:flex;flex-direction:column;height:100%;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <button class="diff-btn" @click="compareDiffs">刷新</button>
        <button class="diff-btn" @click="expandAllNodes(true)">展开全部</button>
        <button class="diff-btn" @click="expandAllNodes(false)">折叠全部</button>
        <button class="diff-btn" @click="() => { currentTab='line'; }">切回 行级对比</button>
      </div>
      <div class="tree-root" style="overflow:auto;flex:1;padding:8px;border:1px solid var(--color-divider);border-radius:4px;">
        <div v-if="treeError" class="error-hint">{{ treeError }}</div>
        <div v-else-if="!treeRoot">暂无树形结果，请先点击刷新</div>
        <div v-else>
          <div style="display:flex;gap:12px;margin-bottom:8px;">
            <div>新增: {{ treeStats.added }}</div>
            <div>删除: {{ treeStats.removed }}</div>
            <div>变化: {{ treeStats.changed }}</div>
            <div>相同: {{ treeStats.unchanged }}</div>
          </div>
          <DiffTreeNode :node="treeRoot" :expandAll="expandAllFlag" @select="openTextView" />
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.diff-view { padding: 12px; display:flex; flex-direction:column; height:100%; }
.toolbar { display:flex; gap:8px; margin-bottom:8px; }
.diff-btn, .text-toggle { padding:6px 10px; border-radius:4px; border:none; cursor:pointer; background:#0078d4; color:#fff; }
.diff-summary { background:#f5f5f5; padding:8px; border-radius:4px; margin-bottom:8px; font-size:13px; }
.diff-content { background:#fff; border:1px solid #ddd; padding:10px; border-radius:4px; max-height:240px; overflow:auto; font-size:13px; }
.diff-list { list-style:none; padding:0; margin:8px 0 0 0; max-height:260px; overflow:auto; }
.diff-list li { margin:6px 0; }
.diff-list button { background:none; border:none; color:#0b69ff; cursor:pointer; padding:0; font-family:monospace; }
.type { margin-left:8px; color:#666; font-size:12px; }
.text-area { flex:1; min-height:0; }
.list-area { flex: none; overflow:auto; }
/* small snippet filter for list */
</style>
