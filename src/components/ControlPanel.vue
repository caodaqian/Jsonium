<script setup>
  import { computed, ref, watch } from 'vue';
import { AI_PROVIDERS, fetchOpenAICompatibleModels } from '../services/aiProcessor.js';
import notify from '../services/notify.js';
import { useJsonStore } from '../store/index.js';

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
    { value: 'auto', label: '跟随系统' },
    { value: 'light', label: '亮色 Light' },
    { value: 'dark', label: '暗色 Dark' }
  ];

  const themeValue = ref(store.themePreference.theme);
  const modeValue = ref(store.themePreference.mode);

  const appearanceSettingsOpen = ref(false);
  const editorSettingsOpen = ref(false);
  const aiSettingsOpen = ref(false);

  const themeLabelByValue = computed(() => themeOptions.find((option) => option.value === themeValue.value)?.label || '未选择');
  const modeLabelByValue = computed(() => modeOptions.find((option) => option.value === modeValue.value)?.label || '未选择');
  const fontLabel = computed(() => {
    const value = store.editorSettings.fontFamily;
    if (!value) return '系统默认';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  });
  const wrapLabel = computed(() => {
    if (!store.editorSettings.wrapEnabled) return '关闭';
    return store.editorSettings.wrapByWidth ? `按宽度 ${store.editorSettings.wrapThresholdPx}px` : `按列 ${store.editorSettings.wrapColumn}`;
  });
  const aiRetryLabel = computed(() => (store.aiConfig.parseRetry ? `开启 · ${store.aiConfig.parseRetryMax} 次` : '关闭'));
  const aiProviderOptions = [
    { value: AI_PROVIDERS.UTOOLS, label: 'uTools 内置 AI' },
    { value: AI_PROVIDERS.OPENAI_COMPATIBLE, label: 'OpenAI Compatible' }
  ];
  const openaiModelInputMode = ref(false);
  const defaultSystemPrompt = '你是名为 Jsoniun 的 JSON 助手，负责处理用户对于 json 数据的处理、比对、分析等任务。包括 jq/jsonpath 做相关的数据提取、转换，同时也需要在用户分析数据异动时，提供数据的差异分析、重点数据描述、以及对应的数据洞察';

  const aiProviderLabel = computed(() => {
    return aiProviderOptions.find((item) => item.value === store.aiConfig.provider)?.label || '未选择';
  });
  const aiConfigSummary = computed(() => {
    if (store.aiConfig.provider === AI_PROVIDERS.OPENAI_COMPATIBLE) {
      return `Provider ${aiProviderLabel.value} · 模型 ${store.aiConfig.model || '未设置'}`;
    }
    return `Provider ${aiProviderLabel.value} · 失败重试 ${aiRetryLabel.value}`;
  });
  const openaiModels = computed(() => store.aiComposer.openaiModels || []);
  const openaiModelLoading = computed(() => !!store.aiComposer.openaiModelLoading);
  const openaiModelError = computed(() => store.aiComposer.openaiModelError || '');
  const canUseOpenAIModelSelect = computed(() => openaiModels.value.length > 0 && !openaiModelInputMode.value);
  let settingsSaveTimer = null;

  function scheduleSettingsSave() {
    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(() => {
      try {
        if (typeof store.saveSettingsState === 'function') store.saveSettingsState();
      } catch (error) {
        console.warn('Failed to save settings state', error);
      }
    }, 300);
  }

  function ensureAIDefaults() {
    if (!store.aiConfig.provider) {
      store.setAIConfig({ provider: AI_PROVIDERS.UTOOLS });
    }
    if (store.aiConfig.systemPrompt === undefined || store.aiConfig.systemPrompt === null || store.aiConfig.systemPrompt === '') {
      store.setAIConfig({ systemPrompt: defaultSystemPrompt });
    }
    if (store.aiConfig.temperature === undefined || store.aiConfig.temperature === null) {
      store.setAIConfig({ temperature: '' });
    }
    if (store.aiConfig.headersJson === undefined || store.aiConfig.headersJson === null) {
      store.setAIConfig({ headersJson: '' });
    }
  }

  async function loadOpenAIModels() {
    if (store.aiConfig.provider !== AI_PROVIDERS.OPENAI_COMPATIBLE) return;
    store.setOpenAIModelLoading(true);
    store.setOpenAIModelError('');
    try {
      const res = await fetchOpenAICompatibleModels({
        baseUrl: store.aiConfig.baseUrl,
        apiKey: store.aiConfig.apiKey,
        headersJson: store.aiConfig.headersJson
      });
      if (res.success) {
        store.setOpenAIModels(res.data);
        if (!store.aiConfig.model) {
          store.setAIConfig({ model: res.data[0]?.id || '' });
        }
        openaiModelInputMode.value = false;
      } else {
        store.setOpenAIModels([]);
        store.setOpenAIModelError(res.error || '模型加载失败');
        openaiModelInputMode.value = true;
      }
    } catch (e) {
      store.setOpenAIModels([]);
      store.setOpenAIModelError(e.message || String(e));
      openaiModelInputMode.value = true;
    } finally {
      store.setOpenAIModelLoading(false);
    }
  }

  function toggleOpenAIModelInput() {
    openaiModelInputMode.value = !openaiModelInputMode.value;
  }

  function handleProviderChange() {
    if (store.aiConfig.provider === AI_PROVIDERS.OPENAI_COMPATIBLE) {
      loadOpenAIModels();
    }
  }

  watch(
    [themeValue, modeValue],
    ([theme, mode]) => {
      store.setThemePreference(theme, mode);
      const appWindow = globalThis.window;
      appWindow?.applyTheme?.();
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
      scheduleSettingsSave();
    },
    { deep: true }
  );

  watch(
    () => store.aiConfig,
    () => {
      scheduleSettingsSave();
    },
    { deep: true }
  );

  watch(
    () => [store.aiConfig.provider, store.aiConfig.baseUrl, store.aiConfig.apiKey, store.aiConfig.headersJson],
    ([provider, baseUrl]) => {
      if (provider !== AI_PROVIDERS.OPENAI_COMPATIBLE) return;
      if (!baseUrl || !String(baseUrl).trim()) {
        store.setOpenAIModels([]);
        store.setOpenAIModelError('请先填写 Base URL');
        openaiModelInputMode.value = true;
        return;
      }
      loadOpenAIModels();
    }
  );

  ensureAIDefaults();

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
    const appWindow = globalThis.window;
    if (appWindow?.utools) {
      try {
        const files = appWindow.utools.showOpenDialog({
          title: '选择文件',
          properties: ['openFile']
        });
        if (files && files[0]) {
          const content = appWindow.services.readFile(files[0]);
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
    const appWindow = globalThis.window;
    if (appWindow?.utools) {
      try {
        const outputPath = appWindow.services.writeTextFile(activeTab.content);
        if (outputPath) {
          appWindow.utools.shellShowItemInFolder(outputPath);
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

  function formatThemeSummary() {
    return `${themeLabelByValue.value} · ${modeLabelByValue.value}`;
  }

  function getDisclosureLabel(open) {
    return open ? '收起详情' : '查看详情';
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

      <button class="panel-close" type="button" @click="handleClose" aria-label="关闭设置" title="关闭设置">
        ✕
      </button>
    </div>

    <div class="panel-tabs" role="tablist" aria-label="面板切换">
      <button class="panel-tab" :class="{ active: activePanel === 'editor' }" type="button"
        @click="switchPanel('editor')">
        {{ getTabLabel('editor') }}
      </button>
    </div>

    <div class="panel-content">
      <section class="settings-section settings-section--appearance">
        <button class="section-toggle" type="button" :aria-expanded="appearanceSettingsOpen"
          aria-controls="appearance-settings" @click="appearanceSettingsOpen = !appearanceSettingsOpen">
          <span>
            <span class="section-toggle__title">界面外观</span>
            <span class="section-toggle__desc">当前 {{ formatThemeSummary() }}</span>
          </span>
          <span class="section-toggle__state">{{ getDisclosureLabel(appearanceSettingsOpen) }}</span>
        </button>

        <div id="appearance-settings" class="section-body" :class="{ 'is-collapsed': !appearanceSettingsOpen }">
          <div class="appearance-layout">
            <div class="theme-column">
              <div class="mini-label">主题风格</div>
              <div class="theme-grid" aria-label="主题风格">
                <label v-for="opt in themeOptions" :key="opt.value" class="theme-option"
                  :class="{ active: themeValue === opt.value }">
                  <input v-model="themeValue" type="radio" name="themeStyle" :value="opt.value" />
                  <span class="theme-option__title">{{ opt.label }}</span>
                  <span class="theme-option__meta">{{ opt.meta }}</span>
                </label>
              </div>
            </div>

            <div class="mode-column">
              <div class="mini-label">配色模式</div>
              <div class="mode-grid">
                <label v-for="opt in modeOptions" :key="opt.value" class="mode-option"
                  :class="{ active: modeValue === opt.value }">
                  <input v-model="modeValue" type="radio" name="themeMode" :value="opt.value" />
                  <span>{{ opt.label }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <button class="section-toggle" type="button" :aria-expanded="editorSettingsOpen" aria-controls="editor-settings"
          @click="editorSettingsOpen = !editorSettingsOpen">
          <span>
            <span class="section-toggle__title">编辑器设置</span>
            <span class="section-toggle__desc">字体 {{ fontLabel }} · 换行 {{ wrapLabel }}</span>
          </span>
          <span class="section-toggle__state">{{ getDisclosureLabel(editorSettingsOpen) }}</span>
        </button>

        <div id="editor-settings" class="section-body" :class="{ 'is-collapsed': !editorSettingsOpen }">
          <div class="setting-stack">
            <label class="setting-row setting-row--toggle">
              <span class="input-toggle">
                <input v-model="store.editorSettings.stickyEnabled" type="checkbox" aria-label="启用粘性节点" />
                <span class="slider" aria-hidden="true"></span>
              </span>
              <span class="setting-copy">
                <span class="setting-name">启用粘性节点（Sticky）</span>
                <span class="setting-help">在编辑器中显示折叠区域的粘性节点，便于定位深层结构。</span>
              </span>
            </label>
            <label class="setting-row setting-row--toggle">
              <span class="input-toggle">
                <input v-model="store.editorSettings.wrapEnabled" type="checkbox" aria-label="默认按编辑器宽度自动换行" />
                <span class="slider" aria-hidden="true"></span>
              </span>
              <span class="setting-copy">
                <span class="setting-name">默认按编辑器宽度自动换行</span>
                <span class="setting-help">长文本浏览时更易阅读。</span>
              </span>
            </label>

            <label class="setting-row setting-row--toggle">
              <span class="input-toggle">
                <input v-model="store.editorSettings.wrapByWidth" type="checkbox"
                  aria-label="换行策略：按宽度触发（勾选） / 按列数触发（不勾选）" />
                <span class="slider" aria-hidden="true"></span>
              </span>
              <span class="setting-copy">
                <span class="setting-name">换行策略：按宽度触发 / 按列数触发</span>
                <span class="setting-help">开启后会根据视口或固定列数自动换行。</span>
              </span>
            </label>
          </div>

          <div class="setting-grid">
            <label class="setting-field">
              <span class="setting-field__label">换行阈值（px）</span>
              <span class="setting-field__help">视口小于该值时按宽度换行。</span>
              <input v-model.number="store.editorSettings.wrapThresholdPx" type="number" min="200" step="50"
                class="form-input setting-field__control" />
            </label>

            <label class="setting-field">
              <span class="setting-field__label">固定换行列数</span>
              <span class="setting-field__help">按列数换行时使用的最大列宽。</span>
              <input v-model.number="store.editorSettings.wrapColumn" type="number" min="40" step="1"
                class="form-input setting-field__control" />
            </label>
          </div>

          <div class="setting-grid">
            <label class="setting-field">
              <span class="setting-field__label">字体</span>
              <span class="setting-field__help">默认使用系统字体，必要时可手动指定等宽字体。</span>
              <select v-model="store.editorSettings.fontFamily" class="form-select setting-field__control">
                <option value="">系统默认</option>
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
              </select>
            </label>

            <label class="setting-field">
              <span class="setting-field__label">字号 (px)</span>
              <span class="setting-field__help">调整编辑器字体大小</span>
              <input v-model.number="store.editorSettings.fontSize" type="number" min="8"
                class="form-input setting-field__control setting-field__control--narrow" />
            </label>
          </div>

          <label class="setting-row setting-row--toggle">
            <span class="input-toggle">
              <input v-model="store.editorSettings.preserveWhitespaceOnCopy" type="checkbox"
                aria-label="保留复制内容中的原始空白（空格/换行）" />
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
        <button class="section-toggle" type="button" :aria-expanded="aiSettingsOpen" aria-controls="ai-settings"
          @click="aiSettingsOpen = !aiSettingsOpen">
          <span>
            <span class="section-toggle__title">AI 解析设置</span>
            <span class="section-toggle__desc">{{ aiConfigSummary }}</span>
          </span>
          <span class="section-toggle__state">{{ getDisclosureLabel(aiSettingsOpen) }}</span>
        </button>

        <div id="ai-settings" class="section-body" :class="{ 'is-collapsed': !aiSettingsOpen }">
          <label class="setting-field setting-field--inline">
            <span class="setting-field__label">Provider</span>
            <span class="setting-field__help">选择模型提供商。</span>
            <select v-model="store.aiConfig.provider" class="form-select setting-field__control" @change="handleProviderChange">
              <option v-for="item in aiProviderOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>

          <template v-if="store.aiConfig.provider === AI_PROVIDERS.OPENAI_COMPATIBLE">
            <label class="setting-field setting-field--inline">
              <span class="setting-field__label">Base URL</span>
              <span class="setting-field__help">例如 https://api.openai.com/v1。</span>
              <input v-model="store.aiConfig.baseUrl" type="text" class="form-input setting-field__control" placeholder="https://your-compatible-endpoint/v1" />
            </label>

            <label class="setting-field setting-field--inline">
              <span class="setting-field__label">API Key</span>
              <span class="setting-field__help">仅保存在本地，用于请求鉴权。</span>
              <input v-model="store.aiConfig.apiKey" type="password" class="form-input setting-field__control" placeholder="sk-..." />
            </label>

            <div class="setting-field setting-field--inline">
              <span class="setting-field__label">Model</span>
              <span class="setting-field__help">默认尝试拉取 models 列表，失败时可手动输入。</span>
              <div style="display:flex;gap:8px;align-items:center;">
                <template v-if="canUseOpenAIModelSelect">
                  <select v-model="store.aiConfig.model" class="form-select setting-field__control">
                    <option v-for="m in openaiModels" :key="m.id" :value="m.id">{{ m.label || m.id }}</option>
                  </select>
                </template>
                <template v-else>
                  <input v-model="store.aiConfig.model" type="text" class="form-input setting-field__control" placeholder="例如 gpt-4o-mini" />
                </template>
                <button type="button" class="panel-tab" @click="toggleOpenAIModelInput">
                  {{ canUseOpenAIModelSelect ? '手动输入' : '使用下拉' }}
                </button>
                <button type="button" class="panel-tab" :disabled="openaiModelLoading" @click="loadOpenAIModels">
                  {{ openaiModelLoading ? '拉取中...' : '刷新模型' }}
                </button>
              </div>
              <div v-if="openaiModelError" class="setting-field__help" style="color: var(--color-danger, #c53a3a);">{{ openaiModelError }}</div>
            </div>

            <label class="setting-field setting-field--inline">
              <span class="setting-field__label">System Prompt</span>
              <span class="setting-field__help">默认会注入 Jsoniun 的 JSON 助手角色提示。</span>
              <textarea v-model="store.aiConfig.systemPrompt" rows="3" class="form-input setting-field__control" />
            </label>

            <label class="setting-field setting-field--inline">
              <span class="setting-field__label">Temperature</span>
              <span class="setting-field__help">留空则请求中不传。</span>
              <input v-model="store.aiConfig.temperature" type="text" class="form-input setting-field__control setting-field__control--narrow" placeholder="例如 0.2" />
            </label>

            <label class="setting-field setting-field--inline">
              <span class="setting-field__label">Headers JSON</span>
              <span class="setting-field__help">留空则仅发送默认请求头。</span>
              <textarea v-model="store.aiConfig.headersJson" rows="2" class="form-input setting-field__control" placeholder='例如 {"x-foo":"bar"}' />
            </label>
          </template>

          <label class="setting-row setting-row--toggle">
            <span class="input-toggle">
              <input v-model="store.aiConfig.parseRetry" type="checkbox" aria-label="自动在失败时重试仅返回 JSON（parseRetry）" />
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
            <input v-model.number="store.aiConfig.parseRetryMax" type="number" min="0" step="1"
              class="form-input setting-field__control setting-field__control--narrow" />
          </label>
        </div>
      </section>

    </div>
  </div>
</template>

<style scoped>
  .control-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    min-width: 0;
    max-width: none;
    box-sizing: border-box;
    padding: 18px;
    color: var(--color-text-primary);
    background: var(--color-bg-secondary);
    border-left: 1px solid var(--color-divider);
    border-right: 0;
    border-top: 0;
    border-bottom: 0;
    box-shadow: none;
    backdrop-filter: none;
  }

  :global(html.dark-mode) .control-panel {
    background: var(--color-bg-secondary);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 4px 4px 8px;
    border-bottom: 1px solid var(--color-divider);
  }

  .panel-header__copy {
    min-width: 0;
  }

  .panel-eyebrow {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }

  .panel-title {
    margin: 0;
    font-size: 16px;
    line-height: 1.25;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  .panel-description {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--color-text-secondary);
    max-width: 42ch;
  }

  .panel-close {
    flex: none;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-divider) 60%, transparent);
    background: color-mix(in srgb, var(--color-bg-primary) 88%, var(--color-bg-secondary));
    color: var(--color-text-tertiary);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 4px 10px rgba(0, 0, 0, 0.03);
    transition: transform 160ms ease, background-color 160ms ease, color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
  }

  .panel-close:hover,
  .panel-close:focus-visible {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--color-primary) 28%, var(--color-divider));
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-bg-primary) 72%, var(--color-primary) 10%);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.05);
  }

  .panel-tabs {
    display: flex;
    gap: 8px;
    padding: 0;
    border-radius: 4px;
    background: transparent;
    border: 1px solid var(--color-divider);
  }

  :global(html.dark-mode) .panel-tabs {
    background: rgba(255, 255, 255, 0.06);
  }

  .panel-tab {
    min-height: 32px;
    padding: 6px 10px;
    border-radius: 4px;
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
    color: var(--color-primary);
    border-color: var(--color-divider);
    box-shadow: none;
  }

  .panel-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .settings-section {
    padding: 16px;
    border-radius: 4px;
    border: 1px solid var(--color-divider);
    background: var(--color-bg-primary);
    box-shadow: none;
    backdrop-filter: none;
  }

  :global(html.dark-mode) .settings-section {
    background: rgba(255, 255, 255, 0.04);
  }

  .settings-section--footer {
    padding: 14px 16px;
  }

  .settings-section--appearance {
    background: var(--color-bg-primary);
  }

  .appearance-layout {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .theme-column,
  .mode-column {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-heading {
    margin-bottom: 14px;
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
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 10px;
  }

  .theme-option {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    min-height: 88px;
    padding: 12px 13px 11px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: var(--color-bg-secondary);
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
    box-shadow: none;
    background: color-mix(in srgb, var(--color-bg-primary) 88%, var(--color-primary-lighter));

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
    margin-top: 0;
  }

  .mini-label {
    margin-bottom: 8px;
    font-size: 13px;
    font-weight: 700;
    color: var(--color-text-primary);
  }

  .mode-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .mode-option {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    min-height: 42px;
    padding: 9px 14px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: var(--color-bg-secondary);
    color: var(--color-text-secondary);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    flex: 0 1 auto;
  }

  .mode-option input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .mode-option.active {
    border-color: var(--color-primary);
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-bg-primary) 88%, var(--color-primary-lighter));
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
    display: inline-flex;
    align-items: center;
    min-height: 30px;
    padding: 0 10px;
    border-radius: 4px;
    background: transparent;
    border: 1px solid transparent;
    font-size: 12px;
    font-weight: 700;
    color: var(--color-text-secondary);
  }

  .section-toggle__state:hover,
  .section-toggle__state:focus-visible,
  .overview-card__action:hover,
  .overview-card__action:focus-visible {
    background: var(--color-hover-bg);
    border-color: var(--color-border);
  }

  .section-body {
    display: flex;
    flex-direction: column;
    gap: 14px;
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
    padding: 12px 0;
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

  .setting-stack {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .setting-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
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
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    font-size: 14px;
  }

  .form-input:focus,
  .form-select:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary);
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
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    transition: transform 0.22s ease;
  }

  .input-toggle input[type="checkbox"]:checked+.slider {
    background-color: var(--color-primary);
  }

  .input-toggle input[type="checkbox"]:checked+.slider::before {
    transform: translateX(16px);
  }

  .footer-actions {
    display: flex;
    justify-content: flex-end;
  }

  .panel-btn {
    min-height: 40px;
    padding: 8px 18px;
    border-radius: 4px;
    border: 1px solid var(--color-primary);
    background: var(--color-primary);
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    box-shadow: none;
  }

  .panel-btn:hover,
  .panel-btn:focus-visible {
    background: var(--color-primary-dark);
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

    .appearance-layout,
    .theme-grid,
    .setting-grid,
    .mode-grid {
      grid-template-columns: 1fr;
    }

    .setting-field--inline {
      grid-template-columns: 1fr;
    }

    .panel-header {
      flex-direction: row;
      align-items: flex-start;
    }

    .panel-close {
      margin-top: 2px;
    }
  }

  @media (max-width: 980px) {
    .appearance-layout {
      grid-template-columns: 1fr;
    }

    .mode-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>