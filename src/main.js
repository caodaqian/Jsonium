import { createApp, watch } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './main.css';
import { useJsonStore } from './store';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);

// 初始化 store 并恢复/持久化 tabs 状态
const store = useJsonStore();

// 尝试加载上次保存的 tabs 状态（异步安全）
store.loadTabsState && store.loadTabsState();

// 防抖保存函数
let _saveTimer = null;
const scheduleSave = () => {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { store.saveTabsState && store.saveTabsState(); } catch (_) {}
  }, 300);
};

// 若运行在 uTools 环境，直接使用其事件管理确保在宿主触发时及时加载/保存
if (typeof window !== 'undefined' && window.utools) {
  try {
    if (typeof window.utools.onPluginEnter === 'function') {
      window.utools.onPluginEnter(async () => {
        try { await store.loadTabsState && store.loadTabsState(); } catch (_) {}
      });
    }
    if (typeof window.utools.onPluginOut === 'function') {
      window.utools.onPluginOut(() => {
        try { store.saveTabsState && store.saveTabsState(); } catch (_) {}
      });
    }
  } catch (_) { /* ignore */ }
}

 // 监听 tab 列表与激活 tab 变化并保存（深度监听）
watch(
  [store.tabs, store.activeTabId],
  scheduleSave,
  { deep: true }
);

// 在页面/窗口卸载时强制保存一次
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try { store.saveTabsState && store.saveTabsState(); } catch (_) {}
  });
}

app.mount('#app');
