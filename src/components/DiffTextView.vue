<script setup>
import { ref, onMounted, watch, onBeforeUnmount } from 'vue';
let monaco = null;

const props = defineProps({
  left: {
    type: String,
    default: ''
  },
  right: {
    type: String,
    default: ''
  },
  language: {
    type: String,
    default: 'json'
  },
  options: {
    type: Object,
    default: () => ({})
  }
});

const editorContainer = ref(null);
let diffEditor = null;
let leftModel = null;
let rightModel = null;

onMounted(async () => {
  try {
    const m = await import('monaco-editor');
    monaco = m;
  } catch (e) {
    monaco = null;
  }
  initDiffEditor();
});

onBeforeUnmount(() => {
  try { diffEditor?.dispose && diffEditor.dispose(); } catch (e) {}
  try { leftModel?.dispose && leftModel.dispose(); } catch (e) {}
  try { rightModel?.dispose && rightModel.dispose(); } catch (e) {}
});

function initDiffEditor() {
  if (!editorContainer.value) return;

  diffEditor = monaco.editor.createDiffEditor(editorContainer.value, {
    enableSplitViewResizing: true,
    renderSideBySide: true,
    automaticLayout: true,
    ...props.options
  });

  leftModel = monaco.editor.createModel(props.left || '', props.language);
  rightModel = monaco.editor.createModel(props.right || '', props.language);

  diffEditor.setModel({
    original: leftModel,
    modified: rightModel
  });
}

watch(() => props.left, (v) => {
  if (!leftModel) return;
  const cur = leftModel.getValue();
  if (cur !== v) leftModel.setValue(v);
});

watch(() => props.right, (v) => {
  if (!rightModel) return;
  const cur = rightModel.getValue();
  if (cur !== v) rightModel.setValue(v);
});

import { computed } from 'vue';
import { diffWordsWithSpace } from 'diff';

// expose API
defineExpose({
  getDiffEditor: () => diffEditor,
  revealOriginalLine: (line) => {
    if (!diffEditor) return;
    try { diffEditor.getOriginalEditor().revealLine(line); } catch (e) {}
  },
  revealModifiedLine: (line) => {
    if (!diffEditor) return;
    try { diffEditor.getModifiedEditor().revealLine(line); } catch (e) {}
  }
});

// word-level HTML diff (uses diff.diffWordsWithSpace)
const wordDiffHtml = computed(() => {
  try {
    const a = leftModel ? leftModel.getValue() : (props.left || '');
    const b = rightModel ? rightModel.getValue() : (props.right || '');
    const parts = diffWordsWithSpace(a, b);
    return parts.map(p => {
      const text = String(p.value)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/\n/g, '<br/>');
      if (p.added) return `<span class="word-added">${text}</span>`;
      if (p.removed) return `<span class="word-removed">${text}</span>`;
      return `<span class="word-unchanged">${text}</span>`;
    }).join('');
  } catch (e) {
    return '';
  }
});
</script>

<template>
  <div class="diff-text-wrapper">
    <div ref="editorContainer" class="diff-editor-container"></div>
    <div class="word-diff" v-html="wordDiffHtml"></div>
  </div>
</template>

<style scoped>
.diff-text-wrapper {
  width: 100%;
  height: 100%;
  background: var(--color-bg-primary);
}
.diff-editor-container {
  width: 100%;
  height: 100%;
  background: var(--color-bg-secondary);
  border-radius: 4px;
  overflow: hidden;
}
.word-diff {
  padding: 8px;
  border-top: 1px solid var(--color-divider);
  background: var(--color-bg-secondary);
  max-height: 220px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Helvetica Neue", monospace;
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
  color: var(--color-text-primary);
}
.word-diff .word-added {
  background: rgba(16,185,129,0.10);
  color: #10b981;
  padding: 0 2px;
  border-radius: 2px;
}
.word-diff .word-removed {
  background: rgba(239,68,68,0.06);
  color: #ef4444;
  text-decoration: line-through;
  opacity: 0.95;
  padding: 0 2px;
  border-radius: 2px;
}
.word-diff .word-unchanged { color: var(--color-text-primary); }
</style>