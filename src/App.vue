<script setup>
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import Hello from './Hello/index.vue';
  import JsonProcessor from './components/JsonProcessor.vue';
  import Toast from './components/Toast.vue';
  // import Settings from './components/Settings.vue';
  import { useJsonStore } from './store';

  // 新增主题资源
  import './main.css';
  import './theme/theme-catppuccin.css';
  import './theme/theme-vue.css';

  const route = ref('process');
  const enterAction = ref({});
  /* const settingsVisible = ref(false); // 移除右上角设置弹窗入口 */

  let _mq = null;
  let _themeUpdateListener = null;

  const store = useJsonStore();

  const themeState = ref({
    theme: 'catppuccin',
    mode: 'auto', // auto|dark|light
  });

  function syncHtmlThemeClass(theme, mode) {
    // theme: 'catppuccin' | 'vue'; mode: 'light'|'dark'
    // 清理所有主题 class
    const html = document.documentElement;
    html.classList.remove('catppuccin', 'vue', 'light-mode', 'dark-mode');
    html.classList.add(theme, mode === 'dark' ? 'dark-mode' : 'light-mode');
  }

  // 推送当前设置页需要的值
  function getThemeBinding() {
    const pref = store.getThemePreference();
    return {
      theme: pref.theme || 'catppuccin',
      mode: pref.mode || 'auto',
    };
  }

  // 主题变更响应
  function applyTheme() {
    const { theme, mode } = store.getEffectiveTheme();
    themeState.value = { theme, mode };
    syncHtmlThemeClass(theme, mode);
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('jsonium-theme-applied', { detail: { theme, mode } }));
      }
    } catch (_) { }
  }


  const isLikelyStructuredText = (text) => {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (/^(\{[\s\S]*\}|\[[\s\S]*\])$/.test(trimmed)) return true;
    if (trimmed.length >= 20 && /^(['"`][\s\S]+['"`])$/.test(trimmed)) return true;
    if (trimmed.length >= 20 && /^(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(trimmed)) return true;
    return false;
  };

  const shouldReadClipboard = (action) => {
    try {
      if ((action?.code || '') !== 'process') return false;
      if ((action?.type || '') === 'files') return false;
      const text = typeof action?.text === 'string' ? action.text : '';
      if (text.trim()) return false;
      const payload = typeof action?.payload === 'string' ? action.payload : '';
      return !isLikelyStructuredText(payload);
    } catch (e) {
      return false;
    }
  };

  const readClipboardText = async () => {
    try {
      if (typeof window !== 'undefined' && window.services && typeof window.services.readClipboardText === 'function') {
        return window.services.readClipboardText() || '';
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        return await navigator.clipboard.readText();
      }
    } catch (e) {
      // ignore
    }
    return '';
  };

  const handlePluginEnter = async (action = {}) => {
    const nextAction = { ...action };
    if (shouldReadClipboard(action)) {
      const clipboardText = await readClipboardText();
      if (clipboardText) {
        nextAction.text = clipboardText;
      }
    }
    if (typeof nextAction.text !== 'string') {
      nextAction.text = typeof action.payload === 'string' ? action.payload : '';
    }
    enterAction.value = nextAction;
  };
  onMounted(() => {
    // 1. 初次同步主题
    applyTheme();
    try {
      if (typeof window !== 'undefined') {
        window.applyTheme = applyTheme;
      }
    } catch (_) { }

    // 2. 监听系统主题变化、uTools 主题全局变更
    _themeUpdateListener = () => { if (store.getThemePreference().mode === 'auto') applyTheme(); };
    try {
      if (typeof window !== 'undefined') {
        _mq = window.matchMedia('(prefers-color-scheme: dark)');
        try { _mq.addEventListener('change', _themeUpdateListener); } catch (e) { }
        if (window.utools && window.utools.onPluginEnter) {
          window.utools.onPluginEnter(async (action) => {
            applyTheme();
            await handlePluginEnter(action);
          });
        }
      }
    } catch (_) { }

    // 3. 设置路由、指令等事件监听
    // ...保留原逻辑
  });

  watch(() => store.themePreference, () => {
    applyTheme();
  }, { deep: true });

  const isDarkMode = ref(false); // 兼容老参数供子组件

  onBeforeUnmount(() => {
    try { if (_mq && typeof _mq.removeEventListener === 'function' && _themeUpdateListener) _mq.removeEventListener('change', _themeUpdateListener); } catch (e) { }
    _themeUpdateListener = null;
    try {
      if (typeof window !== 'undefined' && window.applyTheme === applyTheme) {
        window.applyTheme = null;
      }
    } catch (_) { }
  });
</script>

<template>
  <div class="app-container">
    <!-- 设置按钮，右上角圆形已移除，入口聚合到侧栏 Appearance -->
    <!--
    <button
      class="settings-btn"
      title="界面设置"
      @click="settingsVisible = true"
      aria-label="打开设置"
    >
      <svg width="21" height="21" fill="none" viewBox="0 0 21 21">
        <circle cx="10.5" cy="10.5" r="9" stroke="var(--color-primary)" stroke-width="2"/>
        <path stroke="var(--color-primary)" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 7.437v3.063l1.75 1.313"/>
      </svg>
    </button>
    <Settings
      :visible="settingsVisible"
      :current-theme="themeState.theme"
      :current-mode="themeState.mode"
      @themeChange="handleThemeChange"
      @close="handleSettingsClose"
    />
    -->

    <!-- Hello 欢迎页面（调试用） -->
    <template v-if="route === 'hello'">
      <Hello :enterAction="enterAction" :isDarkMode="themeState.mode === 'dark'" />
    </template>
    <!-- JSON 处理器（主界面） -->
    <template v-else>
      <JsonProcessor :enterAction="enterAction" :isDarkMode="themeState.mode === 'dark'" />
    </template>
    <Toast />
  </div>
</template>

<style scoped>
  .app-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background-color: var(--color-bg-primary);
    color: var(--color-text-primary);
    transition: background-color 0.3s ease, color 0.3s ease;
    position: relative;
  }
</style>