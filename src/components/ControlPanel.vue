<script setup>
import { ref, computed } from 'vue';
import { useJsonStore } from '../store/index.js';
import notify from '../services/notify.js';
import { getFormatName } from '../utils/formatNames.js';

const props = defineProps({
  activePanel: {
    type: String,
    default: 'editor'
  }
});

const emit = defineEmits([
  'panelChange',
  'import',
  'convert',
  'generateCode',
  'query',
  'compare',
  'aiProcess',
  'copyToClipboard',
  'download'
]);

const store = useJsonStore();

// 转换面板
const selectedFormat = ref('json');
const selectedLanguage = ref('go');

// 查询面板
const queryExpression = ref('');
const queryType = ref('jsonpath');

// 对比面板
const compareJson = ref('');


// AI 面板
const aiInstruction = ref('');
const aiProvider = ref('openai');
const aiApiKey = ref('');

const formats = ['json', 'json5', 'yaml', 'xml', 'escaped', 'base64'];
const languages = ['go', 'java', 'python', 'typescript', 'javascript', 'rust', 'cpp', 'excel'];
const queryTypes = ['jsonpath', 'jq'];

function switchPanel(panel) {
  emit('panelChange', panel);
}

function handleImport() {
  const text = prompt('请粘贴 JSON 内容:');
  if (text) {
    emit('import', text);
  }
}

function handleReadFile() {
  if (window.utools) {
    try {
      const files = window.utools.showOpenDialog({
        title: '选择文件',
        properties: ['openFile']
      });
      if (files && files[0]) {
        const content = window.services.readFile(files[0]);
        emit('import', content);
      }
    } catch (err) {
      notify.error('读取文件失败: ' + err.message);
    }
  } else {
    notify.warn('此功能仅在 uTools 中可用');
  }
}

function handleWriteFile() {
  const activeTab = store.getActiveTab();
  if (!activeTab) {
    notify.warn('请先打开一个标签页');
    return;
  }
  
  if (window.utools) {
    try {
      const outputPath = window.services.writeTextFile(activeTab.content);
      if (outputPath) {
        window.utools.shellShowItemInFolder(outputPath);
        notify.success('文件已保存到: ' + outputPath);
      }
    } catch (err) {
      notify.error('保存文件失败: ' + err.message);
    }
  } else {
    notify.warn('此功能仅在 uTools 中可用');
  }
}

function handleConvert() {
  emit('convert', selectedFormat.value);
}

function handleGenerateCode() {
  emit('generateCode', selectedLanguage.value);
}

function handleQuery() {
  if (!queryExpression.value.trim()) {
    notify.warn('请输入查询表达式');
    return;
  }
  emit('query', queryExpression.value, queryType.value);
}

function handleCompare() {
  if (!compareJson.value.trim()) {
    notify.warn('请输入第二个 JSON');
    return;
  }
  emit('compare', '', compareJson.value);
}


function handleAIProcess() {
  if (!aiInstruction.value.trim()) {
    notify.warn('请输入处理指令');
    return;
  }
  
  store.setAIConfig({
    provider: aiProvider.value,
    apiKey: aiApiKey.value
  });
  
  emit('aiProcess', aiInstruction.value);
}

function getTabLabel(tab) {
  const labels = {
    editor: '编辑器',
    convert: '转换',
    query: '查询',
    diff: '对比',
    ai: 'AI'
  };
  return labels[tab] || tab;
}

</script>

<template>
  <div class="control-panel">
    <div class="panel-tabs">
      <button
        v-for="tab in ['editor', 'query', 'diff']"
        :key="tab"
        :class="['panel-tab', { active: activePanel === tab }]"
        @click="switchPanel(tab)"
      >
        {{ getTabLabel(tab) }}
      </button>
    </div>
    
    <!-- 编辑器面板 -->
    <div v-if="activePanel === 'editor'" class="panel-content">
      <h3>编辑器操作</h3>
      <button @click="$emit('copyToClipboard')" class="panel-btn">
        📋 复制到剪贴板
      </button>
      <button @click="$emit('download')" class="panel-btn">
        💾 下载为文件
      </button>
      <button @click="handleImport" class="panel-btn">
        📥 导入文本
      </button>
      <button @click="handleReadFile" class="panel-btn">
        📂 读取文件
      </button>
      <button @click="handleWriteFile" class="panel-btn">
        💾 保存为文件
      </button>
    </div>
    
    <!-- 转换面板 -->
    <div v-if="activePanel === 'convert'" class="panel-content">
      <div class="form-group">
        <h4>格式转换</h4>
        <select v-model="selectedFormat" class="form-select">
          <option v-for="fmt in formats" :key="fmt" :value="fmt">
            {{ getFormatName(fmt) }}
          </option>
        </select>
        <button @click="handleConvert" class="panel-btn primary">
          → 转换
        </button>
      </div>
      
      <div class="form-group">
        <h4>代码生成</h4>
        <select v-model="selectedLanguage" class="form-select">
          <option v-for="lang in languages" :key="lang" :value="lang">
            {{ lang.toUpperCase() }}
          </option>
        </select>
        <button @click="handleGenerateCode" class="panel-btn primary">
          🔧 生成代码
        </button>
      </div>
    </div>
    
    <!-- 查询面板 -->
    <div v-if="activePanel === 'query'" class="panel-content">
      <div class="form-group">
        <h4>JSON 查询</h4>
        <div class="query-type-selector">
          <button
            v-for="type in queryTypes"
            :key="type"
            :class="['type-btn', { active: queryType === type }]"
            @click="queryType = type"
          >
            {{ type.toUpperCase() }}
          </button>
        </div>
        <input
          v-model="queryExpression"
          :placeholder="queryType === 'jsonpath' ? '例: $.store.book[0].title' : '例: .store.book[].price'"
          class="form-input"
        />
        <button @click="handleQuery" class="panel-btn primary">
          🔍 执行查询
        </button>
      </div>
      
      <div class="query-history" v-if="store.queryHistory.length">
        <h4>查询历史</h4>
        <div class="history-list">
          <div
            v-for="item in store.queryHistory.slice(0, 5)"
            :key="item.id"
            class="history-item"
            @click="queryExpression = item.query"
            :title="item.query"
          >
            {{ item.query.substring(0, 30) }}
          </div>
        </div>
      </div>
    </div>
    
    <!-- 对比面板 -->
    <div v-if="activePanel === 'diff'" class="panel-content">
      <h4>JSON 对比</h4>
      <textarea
        v-model="compareJson"
        placeholder="输入第二个 JSON..."
        class="form-textarea"
      ></textarea>
      <button @click="handleCompare" class="panel-btn primary">
        ⚖️ 执行对比
      </button>
    </div>
    
  </div>
</template>

<style scoped>
.control-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-primary);
  overflow: hidden;
}

.panel-tabs {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--color-divider);
  overflow-x: auto;
  flex-wrap: wrap;
}

.panel-tab {
  padding: 4px 12px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
  white-space: nowrap;
  color: var(--color-text-primary);
}

.panel-tab:hover {
  background: var(--color-hover-bg);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.panel-tab.active {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  color: var(--color-text-primary);
}

.panel-content h3 {
  font-size: 14px;
  margin-bottom: 12px;
}

.panel-content h4 {
  font-size: 12px;
  margin: 8px 0 4px;
  color: #333;
}

.form-group {
  margin-bottom: 12px;
}

.form-select,
.form-input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  outline: none;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.form-select:focus,
.form-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.1);
}

.form-textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
  resize: vertical;
  outline: none;
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
}

.form-textarea:focus {
  border-color: var(--color-primary);
}

.panel-btn {
  width: 100%;
  padding: 8px 12px;
  margin-top: 8px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
  color: var(--color-text-primary);
}

.panel-btn:hover {
  background: var(--color-hover-bg);
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.panel-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.panel-btn.primary:hover {
  background: var(--color-primary-dark);
}

.query-type-selector {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.type-btn {
  flex: 1;
  padding: 4px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.2s;
  color: var(--color-text-primary);
}

.type-btn.active {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.query-history {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e0e0e0;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-item {
  padding: 4px 8px;
  background: var(--color-bg-tertiary);
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background 0.2s;
  color: var(--color-text-secondary);
}

.history-item:hover {
  background: var(--color-hover-bg);
  color: var(--color-primary);
}

label {
  display: block;
  font-size: 11px;
  margin-bottom: 4px;
  color: #666;
}
</style>