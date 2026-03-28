<script setup>
import { ref, computed, watch } from 'vue';
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

watch(() => store.editorSettings, () => {
  try { if (typeof store.saveSettingsState === 'function') store.saveSettingsState(); } catch (e) {}
}, { deep: true });

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
      <button class="panel-tab" :class="{ active: activePanel === 'editor' }" @click="switchPanel('editor')">
        编辑器
      </button>
    </div>
    
    <!-- 编辑器设置面板（仅包含编辑器相关配置） -->
    <div v-if="activePanel === 'editor'" class="panel-content">
      <h3>编辑器设置</h3>

      <div class="form-group" style="margin-top:6px;">
        <label>
          <span class="input-toggle">
            <input type="checkbox" v-model="store.editorSettings.wrapEnabled" aria-label="默认按编辑器宽度自动换行" />
            <span class="slider" aria-hidden="true"></span>
          </span>
          默认按编辑器宽度自动换行
        </label>

        <label style="display:block; margin-top:6px;">
          <span class="input-toggle">
            <input type="checkbox" v-model="store.editorSettings.wrapByWidth" aria-label="换行策略：按宽度触发（勾选） / 按列数触发（不勾选）" />
            <span class="slider" aria-hidden="true"></span>
          </span>
          换行策略：按宽度触发（勾选） / 按列数触发（不勾选）
        </label>

        <label style="display:block; margin-top:6px;">
          换行阈值（像素）：
          <input type="number" v-model.number="store.editorSettings.wrapThresholdPx" min="200" step="50" style="width:100px; margin-left:8px;" />
        </label>

        <label style="display:block; margin-top:6px;">
          固定换行列数：
          <input type="number" v-model.number="store.editorSettings.wrapColumn" min="40" step="1" style="width:100px; margin-left:8px;" />
        </label>

        <label style="display:block; margin-top:10px;">
          <span class="input-toggle">
            <input type="checkbox" v-model="store.editorSettings.preserveWhitespaceOnCopy" aria-label="保留复制内容中的原始空白（空格/换行）" />
            <span class="slider" aria-hidden="true"></span>
          </span>
          保留复制内容中的原始空白（空格/换行）
        </label>

        <label style="margin-top:8px; display:block;">
          格式检测模式
        </label>
        <select v-model="store.editorSettings.formatDetectorMode" class="form-select" style="width: auto; display: inline-block;">
          <option value="lenient">宽松 (lenient)</option>
          <option value="strict">严格 (strict)</option>
        </select>
      </div>

      <div style="margin-top:12px;">
        <button @click="store.editorSettings.controlPanelVisible = false" class="panel-btn">
          关闭设置
        </button>
      </div>

      <!-- AI 设置（与 AI 解析重试相关） -->
      <div class="form-group" style="margin-top:12px;">
        <h4>AI 解析设置</h4>
        <label>
          <span class="input-toggle">
            <input type="checkbox" v-model="store.aiConfig.parseRetry" aria-label="自动在失败时重试仅返回 JSON（parseRetry）" />
            <span class="slider" aria-hidden="true"></span>
          </span>
          自动在失败时重试仅返回 JSON（parseRetry）
        </label>

        <label style="margin-top:8px; display:block;">
          最大重试次数
        </label>
        <input
          type="number"
          v-model.number="store.aiConfig.parseRetryMax"
          min="0"
          step="1"
          class="form-input"
          style="width:80px;"
        />
      </div>
    </div>
    
    <!-- 转换面板 -->
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

/* modern toggle switch for checkboxes */
.input-toggle {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  vertical-align: middle;
  margin-right: 8px;
}
.input-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.input-toggle .slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-bg-secondary);
  border-radius: 999px;
  transition: all 0.18s ease;
  border: 1px solid var(--color-border);
}
.input-toggle .slider:before {
  content: "";
  position: absolute;
  height: 18px;
  width: 18px;
  left: 2px;
  top: 1px;
  background: var(--color-bg-primary);
  border-radius: 50%;
  transition: transform 0.18s ease;
  box-shadow: 0 1px 2px rgba(0,0,0,0.12);
}
.input-toggle input:checked + .slider {
  background: var(--color-primary);
  border-color: var(--color-primary);
}
.input-toggle input:checked + .slider:before {
  transform: translateX(18px);
}

/* Ensure interactive elements receive pointer events inside uTools draggable window */
.control-panel,
.control-panel button,
.control-panel input,
.control-panel select,
.control-panel textarea,
.control-panel .panel-tab,
.control-panel .input-toggle {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  pointer-events: auto;
}

</style>
