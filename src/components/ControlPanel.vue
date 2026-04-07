<script setup>
import { ref, watch } from 'vue';
import { useJsonStore } from '../store/index.js';
import notify from '../services/notify.js';

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

const themeOptions = [
  { value: 'catppuccin', label: 'Catppuccin（卡布奇诺）', meta: '柔和阅读' },
  { value: 'vue', label: 'Vue 官方风格', meta: '清爽开发' }
];

const modeOptions = [
  { value: 'auto', label: '自动跟随系统/utools' },
  { value: 'light', label: '亮色 Light' },
  { value: 'dark', label: '暗色 Dark' }
];

const themeValue = ref(store.themePreference.theme);
const modeValue = ref(store.themePreference.mode);

const editorSettingsOpen = ref(true);
const aiSettingsOpen = ref(false);

watch(
  [themeValue, modeValue],
  ([theme, mode]) => {
    store.setThemePreference(theme, mode);
    if (typeof window !== 'undefined') {
      try {
        if (window.applyTheme) window.applyTheme();
      } catch (_) {}
    }
  }
);

watch(
  () => store.themePreference,
  (pref) => {
    if (!pref) return;
    themeValue.value = pref.theme;
    modeValue.value = pref.mode;
  },
  { deep: true, immediate: true }
);

watch(
  () => store.editorSettings,
  () => {
    try {
      if (typeof store.saveSettingsState === 'function') store.saveSettingsState();
    } catch (e) {}
  },
  { deep: true }
);

function switchPanel(panel) {
  emit('panelChange', panel);
}

function handleClose() {
  store.editorSettings.controlPanelVisible = false;
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
  emit('convert', 'json');
}

function handleGenerateCode() {
  emit('generateCode', 'javascript');
}

function handleQuery() {
  emit('query', '', 'jsonpath');
}

function handleCompare() {
  emit('compare', '', '');
}

function handleAIProcess() {
  emit('aiProcess', '');
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
    <div class="panel-header">
      <div class="panel-header__copy">
        <p class="panel-eyebrow">控制面板</p>
        <h3 class="panel-title">设置与外观</h3>
        <p class="panel-description">
          优先展示高频设置，进阶项折叠收纳，保证文字清晰、层级明确、操作可预测。
        </p>
      </div>

      <button class="panel-close" type="button" @click="handleClose">
        关闭设置
      </button>
    </div>

    <div class="panel-tabs" role="tablist" aria-label="面板切换">
      <button
        class="panel-tab"
        :class="{ active: activePanel === 'editor' }"
        type="button"
        @click="switchPanel('editor')"
      >
        {{ getTabLabel('editor') }}
      </button>
    </div>

    <div class="panel-content">
      <section class="settings-section settings-section--appearance">
        <div class="section-heading">
          <div>
            <h4>界面外观</h4>
            <p>主题风格与配色模式</p>
          </div>
        </div>

        <div class="theme-grid" aria-label="主题风格">
          <label
            v-for="opt in themeOptions"
            :key="opt.value"
            class="theme-option"
            :class="{ active: themeValue === opt.value }"
          >
            <input
              v-model="themeValue"
              type="radio"
              name="themeStyle"
              :value="opt.value"
            />
            <span class="theme-option__title">{{ opt.label }}</span>
            <span class="theme-option__meta">{{ opt.meta }}</span>
          </label>
        </div>

        <div class="mode-section">
          <div class="mini-label">配色模式</div>
          <div class="mode-grid">
            <label
              v-for="opt in modeOptions"
              :key="opt.value"
              class="mode-option"
              :class="{ active: modeValue === opt.value }"
            >
              <input
                v-model="modeValue"
                type="radio"
                name="themeMode"
                :value="opt.value"
              />
              <span>{{ opt.label }}</span>
            </label>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <button
          class="section-toggle"
          type="button"
          :aria-expanded="editorSettingsOpen"
          aria-controls="editor-settings"
          @click="editorSettingsOpen = !editorSettingsOpen"
        >
          <span>
            <span class="section-toggle__title">编辑器设置</span>
            <span class="section-toggle__desc">行宽、缩进与复制行为</span>
          </span>
          <span class="section-toggle__state">{{ editorSettingsOpen ? '收起' : '展开' }}</span>
        </button>

        <div
          id="editor-settings"
          class="section-body"
          :class="{ 'is-collapsed': !editorSettingsOpen }"
        >
          <label class="setting-row setting-row--toggle">
            <span class="input-toggle">
              <input
                v-model="store.editorSettings.wrapEnabled"
                type="checkbox"
                aria-label="默认按编辑器宽度自动换行"
              />
              <span class="slider" aria-hidden="true"></span>
            </span>
            <span class="setting-copy">
              <span class="setting-name">默认按编辑器宽度自动换行</span>
              <span class="setting-help">长文本浏览时更易阅读。</span>
            </span>
          </label>

          <label class="setting-row setting-row--toggle">
            <span class="input-toggle">
              <input
                v-model="store.editorSettings.wrapByWidth"
                type="checkbox"
                aria-label="换行策略：按宽度触发（勾选） / 按列数触发（不勾选）"
              />
              <span class="slider" aria-hidden="true"></span>
            </span>
            <span class="setting-copy">
              <span class="setting-name">换行策略：按宽度触发 / 按列数触发</span>
              <span class="setting-help">开启后会根据视口或固定列数自动换行。</span>
            </span>
          </label>

          <div class="setting-grid">
            <label class="setting-field">
              <span class="setting-field__label">换行阈值（px）</span>
              <span class="setting-field__help">视口小于该值时按宽度换行。</span>
              <input
                v-model.number="store.editorSettings.wrapThresholdPx"
                type="number"
                min="200"
                step="50"
                class="form-input setting-field__control"
              />
            </label>

            <label class="setting-field">
              <span class="setting-field__label">固定换行列数</span>
              <span class="setting-field__help">按列数换行时使用的最大列宽。</span>
              <input
                v-model.number="store.editorSettings.wrapColumn"
                type="number"
                min="40"
                step="1"
                class="form-input setting-field__control"
              />
            </label>
          </div>
    
          <div class="setting-grid">
            <label class="setting-field">
              <span class="setting-field__label">字体</span>
              <span class="setting-field__help">编辑器首选字体（优先从左到右搜索）</span>
              <select v-model="store.editorSettings.fontFamily" class="form-select setting-field__control">
                <option value="'Cascadia Code NF'">Cascadia Code NF</option>
                <option value="'JetBrains Mono'">JetBrains Mono</option>
                <option value="'Fira Code Retina'">Fira Code Retina</option>
                <option value="Consolas">Consolas</option>
                <option value="'Source Code Pro'">Source Code Pro</option>
                <option value="Menlo">Menlo</option>
                <option value="'Courier New'">Courier New</option>
                <option value="monospace">monospace</option>
                <option value="'Source Han Sans VF'">Source Han Sans VF</option>
                <option value="'思源黑体'">思源黑体</option>
                <option value="">系统默认</option>
              </select>
            </label>
    
            <label class="setting-field">
              <span class="setting-field__label">字号 (px)</span>
              <span class="setting-field__help">调整编辑器字体大小</span>
              <input v-model.number="store.editorSettings.fontSize" type="number" min="8" class="form-input setting-field__control setting-field__control--narrow" />
            </label>
          </div>
    
          <label class="setting-row setting-row--toggle">
            <span class="input-toggle">
              <input
                v-model="store.editorSettings.preserveWhitespaceOnCopy"
                type="checkbox"
                aria-label="保留复制内容中的原始空白（空格/换行）"
              />
              <span class="slider" aria-hidden="true"></span>
            </span>
            <span class="setting-copy">
              <span class="setting-name">复制时保留原始空白</span>
              <span class="setting-help">保留空格与换行，便于二次处理。</span>
            </span>
          </label>

          <div class="setting-field setting-field--inline">
            <span class="setting-field__label">格式检测模式</span>
            <span class="setting-field__help">严格模式更保守，宽松模式更适合混合文本。</span>
            <select v-model="store.editorSettings.formatDetectorMode" class="form-select setting-field__control">
              <option value="lenient">宽松 (lenient)</option>
              <option value="strict">严格 (strict)</option>
            </select>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <button
          class="section-toggle"
          type="button"
          :aria-expanded="aiSettingsOpen"
          aria-controls="ai-settings"
          @click="aiSettingsOpen = !aiSettingsOpen"
        >
          <span>
            <span class="section-toggle__title">AI 解析设置</span>
            <span class="section-toggle__desc">失败重试与输出约束</span>
          </span>
          <span class="section-toggle__state">{{ aiSettingsOpen ? '收起' : '展开' }}</span>
        </button>

        <div
          id="ai-settings"
          class="section-body"
          :class="{ 'is-collapsed': !aiSettingsOpen }"
        >
          <label class="setting-row setting-row--toggle">
            <span class="input-toggle">
              <input
                v-model="store.aiConfig.parseRetry"
                type="checkbox"
                aria-label="自动在失败时重试仅返回 JSON（parseRetry）"
              />
              <span class="slider" aria-hidden="true"></span>
            </span>
            <span class="setting-copy">
              <span class="setting-name">失败时自动重试纯 JSON</span>
              <span class="setting-help">解析失败后，会自动要求模型只返回 JSON。</span>
            </span>
          </label>

          <label class="setting-field setting-field--inline">
            <span class="setting-field__label">最大重试次数</span>
            <span class="setting-field__help">建议保持较小数值，避免重复请求。</span>
            <input
              v-model.number="store.aiConfig.parseRetryMax"
              type="number"
              min="0"
              step="1"
              class="form-input setting-field__control setting-field__control--narrow"
            />
          </label>
        </div>
      </section>

      <section class="settings-section settings-section--footer">
        <div class="footer-actions">
          <button class="panel-btn" type="button" @click="handleClose">
            关闭设置
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.control-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  min-width: 0;
  max-width: none;
  box-sizing: border-box;
  padding: 16px;
  color: var(--color-text-primary);
  background: var(--color-bg-secondary);
  border-left: 1px solid var(--color-divider);
  border-right: 1px solid transparent;
  border-top: 0;
  border-bottom: 0;
  box-shadow: none;
  backdrop-filter: blur(6px);
}

:global(html.dark-mode) .control-panel {
  background: var(--color-bg-secondary);
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.panel-header__copy {
  min-width: 0;
}

.panel-eyebrow {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}

.panel-title {
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
  font-weight: 700;
  color: var(--color-text-primary);
}

.panel-description {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  max-width: 36ch;
}

.panel-close {
  flex: none;
  padding: 8px 14px;
  border-radius: var(--radius-btn, 11px);
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.panel-close:hover,
.panel-close:focus-visible {
  border-color: var(--color-primary);
  color: var(--color-primary-darker);
  background: var(--color-hover-bg);
}

.panel-tabs {
  display: flex;
  gap: 8px;
  padding: 4px;
  border-radius: 12px;
  background: var(--color-bg-primary);
  border: 1px solid var(--color-divider);
}

:global(html.dark-mode) .panel-tabs {
  background: rgba(255, 255, 255, 0.06);
}

.panel-tab {
  min-height: 38px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-secondary);
  font-weight: 600;
  box-shadow: none;
}

.panel-tab:hover {
  background: var(--color-hover-bg);
  color: var(--color-text-primary);
  border-color: var(--color-border);
}

.panel-tab.active {
  background: var(--color-bg-primary);
  color: var(--color-primary-darker);
  border-color: var(--color-primary-light);
  box-shadow: var(--shadow-sm);
}

.panel-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-section {
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--color-divider);
  background: var(--color-bg-primary);
  box-shadow: none;
}

:global(html.dark-mode) .settings-section {
  background: var(--color-bg-primary);
}

.settings-section--footer {
  padding: 10px 14px;
}

.section-heading {
  margin-bottom: 12px;
}

.section-heading h4 {
  margin: 0;
  font-size: 16px;
  line-height: 1.3;
  font-weight: 700;
  color: var(--color-text-primary);
}

.section-heading p {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.theme-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 88px;
  padding: 12px 12px 11px;
  border-radius: 14px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.theme-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.theme-option:hover {
  transform: translateY(-1px);
  border-color: var(--color-primary-light);
  box-shadow: var(--shadow-md);
}

.theme-option.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(198, 160, 246, 0.12);
  background: var(--color-hover-bg);
}

.theme-option__title {
  font-size: 14px;
  line-height: 1.45;
  font-weight: 700;
  color: var(--color-text-primary);
}

.theme-option__meta {
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.mode-section {
  margin-top: 14px;
}

.mini-label {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.mode-option {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.mode-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.mode-option.active {
  border-color: var(--color-success);
  color: var(--color-text-primary);
  background: var(--color-hover-bg);
}

.section-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0 12px;
  border: none;
  background: transparent;
  box-shadow: none;
  color: var(--color-text-primary);
  text-align: left;
}

.section-toggle:hover {
  background: transparent;
  color: var(--color-text-primary);
  border-color: transparent;
}

.section-toggle__title {
  display: block;
  font-size: 16px;
  line-height: 1.3;
  font-weight: 700;
  color: var(--color-text-primary);
}

.section-toggle__desc {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-text-secondary);
}

.section-toggle__state {
  flex: none;
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-secondary);
}

.section-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  max-height: 1000px;
  opacity: 1;
  transition: max-height 0.25s ease, opacity 0.2s ease, transform 0.2s ease;
}

.section-body.is-collapsed {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
  pointer-events: none;
}

.setting-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
}

.setting-row--toggle {
  padding: 8px 0;
}

.setting-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.setting-name {
  font-size: 14px;
  line-height: 1.45;
  font-weight: 600;
  color: var(--color-text-primary);
}

.setting-help {
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

.setting-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.setting-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.setting-field--inline {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px 12px;
  align-items: center;
}

.setting-field__label {
  grid-column: 1 / -1;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.setting-field__help {
  grid-column: 1 / -1;
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text-secondary);
}

.setting-field__control {
  grid-column: 1 / -1;
}

.setting-field__control--narrow {
  width: 110px;
}

.form-input,
.form-select {
  width: 100%;
  min-height: 42px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 14px;
}

.form-input:focus,
.form-select:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(198, 160, 246, 0.12);
}

.input-toggle {
  display: inline-flex;
  align-items: center;
  width: 42px;
  height: 26px;
  position: relative;
  flex: none;
  margin-top: 2px;
}

.input-toggle input[type="checkbox"] {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.input-toggle .slider {
  position: absolute;
  inset: 0;
  cursor: pointer;
  background-color: var(--color-border);
  border-radius: 999px;
  transition: background 0.2s ease;
}

.input-toggle .slider::before {
  content: "";
  position: absolute;
  width: 18px;
  height: 18px;
  top: 4px;
  left: 4px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(76, 78, 120, 0.14);
  transition: transform 0.22s ease;
}

.input-toggle input[type="checkbox"]:checked + .slider {
  background-color: var(--color-primary);
}

.input-toggle input[type="checkbox"]:checked + .slider::before {
  transform: translateX(16px);
}

.footer-actions {
  display: flex;
  justify-content: flex-end;
}

.panel-btn {
  min-height: 40px;
  padding: 8px 18px;
  border-radius: 12px;
  border: 1px solid var(--color-primary);
  background: var(--color-primary);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  box-shadow: none;
}

.panel-btn:hover,
.panel-btn:focus-visible {
  background: linear-gradient(90deg, var(--color-primary-light), var(--color-primary));
  color: #fff;
  border-color: var(--color-primary-dark);
}

@media (max-width: 480px) {
  .control-panel {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 14px;
  }

  .theme-grid,
  .setting-grid,
  .mode-grid {
    grid-template-columns: 1fr;
  }

  .setting-field--inline {
    grid-template-columns: 1fr;
  }

  .panel-header {
    flex-direction: column;
    align-items: stretch;
  }

  .panel-close {
    width: 100%;
  }
}
</style>