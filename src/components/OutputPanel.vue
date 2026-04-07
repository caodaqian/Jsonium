<script setup>
import { computed } from 'vue';
import { useJsonStore } from '../store/index.js';
import { detectAndConvert } from '../services/formatDetector.js';
import notify from '../services/notify.js';

const store = useJsonStore();

const outputTabs = ['jsonpath', 'jq', 'diff'];

const tabLabels = {
  jsonpath: '🔍 JSONPath',
  jq: '🌀 jq',
  diff: '⚖️ 对比'
};

const currentPanel = computed(() => store.outputPanel.content[store.outputPanel.currentTab]);
const formattedContent = computed(() => {
  const entry = currentPanel.value;
  if (!entry) return '';
  if (entry.error) return entry.error;
  if (entry.value === null || entry.value === undefined) return '';
  if (typeof entry.value === 'string') {
    return entry.value;
  }
  return JSON.stringify(entry.value, null, 2);
});

const hasContent = computed(() => {
  const entry = currentPanel.value;
  if (!entry) return false;
  return entry.error !== null || entry.value !== null;
});

const isError = computed(() => {
  const entry = currentPanel.value;
  return entry && entry.error !== null && entry.error !== undefined;
});

const handleCopyOutput = async () => {
  if (!hasContent.value) return;
  
  try {
    if (window.utools) {
      window.utools.copyText(formattedContent.value);
    } else {
      await navigator.clipboard.writeText(formattedContent.value);
    }
    notify.success('已复制输出内容');
    } catch (e) {
    notify.error('复制失败: ' + e.message);
  }
};

const handleInsertToEditor = async () => {
  if (!hasContent.value) return;
  const entry = currentPanel.value;
  if (!entry) return;
    if (entry.error) {
    notify.warn('无法插入：输出为错误信息');
    return;
  }
  try {
    let contentToWrite = '';
    if (typeof entry.value === 'string') {
      const detected = await detectAndConvert(entry.value);
      if (detected.success) {
        contentToWrite = detected.data;
      } else {
        contentToWrite = entry.value;
      }
    } else {
      contentToWrite = JSON.stringify(entry.value, null, 2);
    }
    const active = store.getActiveTab();
    if (!active) {
      notify.warn('没有打开的主编辑标签');
      return;
    }
    store.updateTabContent(active.id, contentToWrite);
    notify.success('已替换主编辑区内容');
  } catch (e) {
    notify.error('插入失败: ' + e.message);
  }
};

const handleClose = () => {
  store.hideOutputPanel();
};

const switchTab = (tab) => {
  store.switchOutputTab(tab);
};
</script>

<template>
  <div class="output-panel card card-blur" v-if="store.outputPanel.visible">
    <div class="output-header">
      <div class="output-tabs">
        <button
          v-for="tab in outputTabs"
          :key="tab"
          :class="['output-tab', { active: store.outputPanel.currentTab === tab }]"
          @click="switchTab(tab)"
        >
          {{ tabLabels[tab] }}
        </button>
      </div>
      <button class="output-close" @click="handleClose" title="关闭">✕</button>
    </div>

    <div class="output-content" v-if="hasContent">
      <pre :class="['output-text', { 'is-error': isError }]">{{ formattedContent }}</pre>
      <div class="output-actions">
        <button @click="handleCopyOutput" class="output-action-btn">
          📋 复制
        </button>
        <button @click="handleInsertToEditor" class="output-action-btn" title="替换主编辑区">
          🔁 替换主编辑区
        </button>
      </div>
    </div>

    <div class="output-empty" v-else>
      <p>暂无输出内容</p>
    </div>
  </div>
</template>

<style scoped>
.output-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-primary);
  border-left: 1px solid var(--color-divider);
  overflow: hidden;
  box-shadow: inset 1px 0 0 var(--color-divider);
}

.output-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-divider);
  flex-shrink: 0;
  gap: var(--spacing-md);
}

.output-tabs {
  display: flex;
  gap: var(--spacing-sm);
  flex: 1;
  overflow-x: auto;
  min-width: 0;
}

.output-tab {
  padding: 6px 12px;
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.output-tab:hover {
  background: var(--color-hover-bg);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.output-tab.active {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.output-close {
  background: none;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  padding: 0;
  font-size: 18px;
  flex-shrink: 0;
  transition: color 0.2s ease;
}

.output-close:hover {
  color: var(--color-error);
}

.output-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.output-text {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: var(--spacing-md);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-size: 12px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Courier New', monospace;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.output-text.is-error {
  color: var(--color-error, #ef4444);
  background: rgba(239, 68, 68, 0.05);
}

.output-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
  padding: var(--spacing-lg);
}

.output-actions {
  display: flex;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border-top: 1px solid var(--color-divider);
  flex-shrink: 0;
}

.output-action-btn {
  padding: 6px 12px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: all 0.2s ease;
}

.output-action-btn:hover {
  background: var(--color-primary-dark);
}

.output-action-btn:active {
  background: var(--color-primary-darker);
}
</style>