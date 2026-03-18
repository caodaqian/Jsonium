<script setup>
import { ref, computed, nextTick } from 'vue';
import { getDifferences, generateDiffSummary, findLineForPath as engineFindLineForPath, getValueAtPath } from '../services/diffEngine.js';
import DiffTextView from './DiffTextView.vue';
import notify from '../services/notify.js';

const props = defineProps({
  leftContent: String,
  rightContent: String
});

const differences = ref([]);
const summary = ref(null);
const mode = ref('tree'); // 'tree' | 'line'
const selectedPath = ref(null);
const diffTextRef = ref(null);

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

function compareDiffs() {
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
  } catch (e) {
    notify.error('对比失败: ' + e.message);
  }
}

function openTextView(path = null) {
  selectedPath.value = path;
  mode.value = 'line';

  nextTick(() => {
    if (!diffTextRef.value) return;
    if (!path) return;
    const leftPretty = pretty(getSubContent(path, props.leftContent));
    const rightPretty = pretty(getSubContent(path, props.rightContent));
    const origLine = findLineForPath(leftPretty, path);
    const modLine = findLineForPath(rightPretty, path);
    if (origLine) {
      try { diffTextRef.value.revealOriginalLine(origLine); } catch (e) {}
    }
    if (modLine) {
      try { diffTextRef.value.revealModifiedLine(modLine); } catch (e) {}
    }
  });
}
</script>

<template>
  <div class="diff-view">
    <div class="toolbar">
      <button @click="compareDiffs" class="diff-btn">对比</button>
      <div class="view-toggle">
        <button :class="{ active: mode === 'tree' }" @click="mode = 'tree'">折叠视图</button>
        <button :class="{ active: mode === 'line' }" @click="mode = 'line'">行级文本对比</button>
      </div>
    </div>

    <div v-if="summary" class="diff-summary">
      <p>总计差异: {{ summary.total }}</p>
      <p v-if="summary.keyAdded">➕ 新增: {{ summary.keyAdded }}</p>
      <p v-if="summary.keyRemoved">➖ 删除: {{ summary.keyRemoved }}</p>
      <p v-if="summary.typeChanges">⚠️ 类型变化: {{ summary.typeChanges }}</p>
      <p v-if="summary.valueChanges">🔄 值变化: {{ summary.valueChanges }}</p>
    </div>

    <div v-if="mode === 'line'" class="text-area">
      <DiffTextView
        ref="diffTextRef"
        :left="getSubContent(selectedPath, props.leftContent)"
        :right="getSubContent(selectedPath, props.rightContent)"
      />
    </div>

    <div v-if="mode === 'tree'" class="list-area">
      <pre v-if="differences.length" class="diff-content">{{ diffContent }}</pre>

      <div v-if="differences.length" class="diff-actions">
        <p>点击路径以在文本对比中定位：</p>
        <ul class="diff-list">
          <li v-for="d in differences" :key="d.path">
            <button @click="openTextView(d.path)">{{ d.path }}</button>
            <span class="type"> - {{ d.type }}</span>
          </li>
        </ul>
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
.text-area { flex:1; min-height:200px; height:100%; }
.list-area { flex:1; overflow:auto; }
</style>