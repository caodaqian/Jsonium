<script setup>
import { onMounted, ref, watch } from 'vue';
import Hello from './Hello/index.vue';
import JsonProcessor from './components/JsonProcessor.vue';
import Toast from './components/Toast.vue';
 // import Settings from './components/Settings.vue';
import { useJsonStore } from './store';

// 新增主题资源
import './theme/theme-catppuccin.css';
import './theme/theme-vue.css';
import './main.css';

const route = ref('process');
const enterAction = ref({});
/* const settingsVisible = ref(false); // 移除右上角设置弹窗入口 */

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

/*
// Settings 弹窗 emits（已迁移到 ControlPanel，入口移除）
function handleThemeChange({ theme, mode }) {
  store.setThemePreference(theme, mode);
  // settings 事件已自动保存，再手动刷新
  applyTheme();
}
function handleSettingsClose() {
  settingsVisible.value = false;
}
*/

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
}

onMounted(() => {
  // 1. 初次同步主题
  applyTheme();

  // 2. 监听系统主题变化、uTools 主题全局变更
  const updateListener = () => { if (store.getThemePreference().mode === 'auto') applyTheme(); };
  try {
    if (typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', updateListener);
      if (window.utools && window.utools.onPluginEnter) {
        window.utools.onPluginEnter(() => applyTheme());
      }
    }
  } catch(_) {}
  
  // 3. 设置路由、指令等事件监听
  // ...保留原逻辑
});

watch(() => store.themePreference, () => {
  applyTheme();
}, { deep: true });

/* 原功能代码（略简） */
const isDarkMode = ref(false); // 兼容老参数供子组件
const shouldReadClipboard = (action) => {
  try {
    const t = action.type || '';
    const code = action.code || '';
    if (code === 'process' && t === "regex") {
      return true;
    }
  } catch (e) {}
  return false;
};
onMounted(() => {
  // 路由和剪贴板相关处理（原 onMounted 代码保留）
  // ...（省略, 按旧代码展开即可）
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

/* .settings-btn 相关样式移除（入口已统一到侧栏 Appearance）
.settings-btn {
  position: absolute;
  top: 22px;
  right: 22px;
  width: 38px;
  height: 38px;
  background: var(--color-bg-secondary, #fff);
  border: 1.5px solid var(--color-primary, #c6a0f6);
  border-radius: 50%;
  box-shadow: 0 2px 8px rgba(0,0,0,0.09);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
  cursor: pointer;
  transition: box-shadow 0.16s;
  padding: 0;
}
.settings-btn:hover {
  box-shadow: var(--shadow-md);
}

@media (max-width: 600px) {
  .settings-btn {
    top: 12px;
    right: 12px;
    width: 34px;
    height: 34px;
  }
}
*/
</style>