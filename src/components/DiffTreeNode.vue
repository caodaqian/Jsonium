<script setup>
defineOptions({ name: 'DiffTreeNode' });

import { ref, computed } from 'vue';

const props = defineProps({
  node: { type: Object, required: true },
  filter: { type: String, default: 'all' }
});

const expanded = ref(props.node.type !== 'unchanged');

const visibleByFilter = computed(() => {
  if (!props.filter || props.filter === 'all') return true;
  if (props.filter === 'changed') return props.node.type !== 'unchanged';
  return props.node.type === props.filter;
});

const valueSummary = computed(() => {
  const v = props.node.leftValue !== undefined ? props.node.leftValue : props.node.rightValue;
  if (v === undefined) return '';
  if (v === null) return 'null';
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === 'object') return 'Object';
  return String(v);
});

function toggle() {
  expanded.value = !expanded.value;
}
</script>

<template>
  <div v-if="visibleByFilter" class="tree-node">
    <div class="node-line" :class="node.type">
      <button v-if="node.children && node.children.length" class="toggle-btn" @click="toggle">
        {{ expanded ? '▾' : '▸' }}
      </button>
      <span v-else class="toggle-placeholder"></span>
      <span class="node-key">{{ node.key === undefined || node.key === '$' ? '$' : node.key }}</span>
      <span class="node-type">[{{ node.type }}]</span>
      <span class="node-val">{{ valueSummary }}</span>
    </div>

    <div v-show="expanded" class="node-children" v-if="node.children && node.children.length">
      <DiffTreeNode
        v-for="(c, idx) in node.children"
        :key="c.path + '-' + idx"
        :node="c"
        :filter="filter"
      />
    </div>
  </div>
</template>

<style scoped>
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
</style>