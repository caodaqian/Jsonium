import { createPinia } from 'pinia';
import { createApp, watch } from 'vue';
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
// 加载统一设置状态（主题/编辑器/AI）
store.loadSettingsState && store.loadSettingsState();

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
        try { store.loadSettingsState && store.loadSettingsState(); } catch (_) { }
      });
    }
    if (typeof window.utools.onPluginOut === 'function') {
      window.utools.onPluginOut(() => {
        try { store.saveTabsState && store.saveTabsState(); } catch (_) {}
        try { store.saveSettingsState && store.saveSettingsState(); } catch (_) { }
      });
    }
  } catch (_) { /* ignore */ }
}

// 监听 tab 列表与激活 tab 变化并保存（深度监听）
watch(
  [() => store.tabs, () => store.activeTabId],
  scheduleSave,
  { deep: true }
);

// 在页面/窗口卸载时强制保存一次
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try { store.saveTabsState && store.saveTabsState(); } catch (_) {}
    try { store.saveSettingsState && store.saveSettingsState(); } catch (_) { }
  });
}

// Development-only helpers for perf testing: expose lightweight APIs to create/close tabs
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  try {
    window.__jsonium_store = store;
    window.__jsonium_addTabs = (count = 100, sizeKB = 0) => {
      try {
        for (let i = 0; i < count; i++) {
          const content = sizeKB > 0 ? JSON.stringify({ data: 'x'.repeat(sizeKB * 1024) }) : '{}';
          store.addTab(content, `perf-${Date.now()}-${i}`, 'json');
        }
      } catch (e) { /* ignore */ }
    };
    window.__jsonium_closeAllTabs = (opts = { keepFavorited: false }) => {
      try { store.closeAllTabs(opts); } catch (e) { /* ignore */ }
    };
  } catch (e) { /* ignore */ }
}

// Global Worker wrapper for diagnostics: capture worker error events into a serializable global array
if (typeof window !== 'undefined' && typeof window.Worker === 'function') {
  try {
    const OriginalWorker = window.Worker;
    try { window.__OriginalWorker = OriginalWorker; } catch (_) { }
    const WorkerWrapper = function (scriptUrl, options) {
      const w = new OriginalWorker(scriptUrl, options);
      try {
        if (w && typeof w.addEventListener === 'function') {
          w.addEventListener('error', (ev) => {
            try {
              const msg = (ev && ev.message ? ev.message : '') + ' ' + (ev && ev.filename ? (ev.filename + ':' + (ev.lineno || 0) + ':' + (ev.colno || 0)) : '');
              const errMsg = (ev && ev.error && ev.error.message) ? (' error:' + ev.error.message) : '';
              const detail = msg + errMsg;
              try { console.error('[WorkerWrapper] worker error event', detail); } catch (_) { }
              try { window.__jsonium_worker_errors = window.__jsonium_worker_errors || []; window.__jsonium_worker_errors.push({ ts: Date.now(), label: 'global', script: String(scriptUrl), detail }); } catch (_) { }
            } catch (_) { }
          });
          w.addEventListener('messageerror', (ev) => { try { console.error('[WorkerWrapper] worker messageerror', String(ev)); } catch (_) { } });
        }
      } catch (_) { }
      return w;
    };
    try { WorkerWrapper.prototype = OriginalWorker.prototype; } catch (_) { }
    try { window.Worker = WorkerWrapper; } catch (_) { }
  } catch (_) { }
}

app.mount('#app');
