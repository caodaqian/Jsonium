<script setup>
  import { onMounted, ref } from 'vue';
  import Hello from './Hello/index.vue';
  import JsonProcessor from './components/JsonProcessor.vue';
  import Toast from './components/Toast.vue';
  import { useJsonStore } from './store';

  const route = ref('process')
  const enterAction = ref({})
  const isDarkMode = ref(false)

  const store = useJsonStore();

  // 判断是否应该读取剪切板：仅允许特定触发类型/标签
  function shouldReadClipboard(action) {
    try {
      console.log('Evaluating clipboard read for action:', action);
      const t = action.type || '';
      const code = action.code || '';
      if (code === 'process' && t === "regex") {
        return true;
      }
    } catch (e) {
      // 任何异常都视为不允许读取
    }
    return false;
  }

  onMounted(() => {
    // 检测系统主题偏好
    detectThemePreference()

    // 监听系统主题变化
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', (e) => {
      isDarkMode.value = e.matches
      applyTheme(e.matches)
    })

    // UTools API 事件监听
    if (window.utools) {
      window.utools.onPluginEnter(async (action) => {
        // 将 read 和 write 指令统一转向 process
        const code = action.code || 'process'
        if (code === 'hello') {
          route.value = 'hello'
        } else {
          route.value = 'process'
        }

        // 尝试从持久化加载上次 tabs 状态（若可用）
        try { await store.loadTabsState && store.loadTabsState(); } catch (_) {}

        // 尝试通过 preload 服务调整窗口最小宽度（容错）
        try {
          const minW = (store.getEditorSettings && store.getEditorSettings().minWindowWidth) || 1200;
          if (window.services && typeof window.services.trySetMinWindowWidth === 'function') {
            try {
              const ok = await window.services.trySetMinWindowWidth(minW);
              if (ok) {
                const last = { width: minW, height: window.outerHeight || window.innerHeight || 800 };
                try { store.updateEditorSettings && store.updateEditorSettings({ lastWindowSize: last }); } catch (_) {}
                try { window.services.setLastWindowSize && window.services.setLastWindowSize(last); } catch (_) {}
                try { store.saveSettingsState && store.saveSettingsState(); } catch (_) {}
              }
            } catch (_) { /* ignore */ }
          }
        } catch (_) { /* ignore */ }

        // 如果 action 没有 text，仅在白名单触发类型下尝试读取系统剪贴板并填充（优先 window.services.readClipboard，其次 navigator.clipboard）
        if (!action.text && shouldReadClipboard(action)) {
          let clipText = ''
          try {
            if (window.services && typeof window.services.readClipboard === 'function') {
              const res = window.services.readClipboard()
              clipText = res instanceof Promise ? await res : res
            } else if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
              clipText = await navigator.clipboard.readText()
            }
          } catch (e) {
            clipText = ''
          }
          // 仅在剪贴板有内容且满足最小长度约束时注入为 action.text（与 plugin.json minLength 保持一致）
          if (clipText && clipText.length >= 20) {
            action.text = clipText
          }
        }

        enterAction.value = action

        // 检测 utools 的主题偏好
        if (action.theme) {
          isDarkMode.value = action.theme === 'dark'
          applyTheme(isDarkMode.value)
        }
      })

      // 在插件被退出/切换出宿主时保存一次（utools 事件）
      try {
        if (typeof window.utools.onPluginOut === 'function') {
          window.utools.onPluginOut(() => {
            try { store.saveTabsState && store.saveTabsState(); } catch (_) {}
          })
        }
      } catch (_) {}
    }
  })

  // 检测主题偏好
  function detectThemePreference() {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    isDarkMode.value = prefersDark
    applyTheme(prefersDark)
  }

  // 应用主题
  function applyTheme(dark) {
    const html = document.documentElement
    if (dark) {
      html.classList.add('dark-mode')
      html.classList.remove('light-mode')
    } else {
      html.classList.add('light-mode')
      html.classList.remove('dark-mode')
    }
  }

  // 切换主题
  function toggleTheme() {
    isDarkMode.value = !isDarkMode.value
    applyTheme(isDarkMode.value)
  }
</script>

<template>
  <div class="app-container">
    <!-- Hello 欢迎页面（调试用） -->
    <template v-if="route === 'hello'">
      <Hello :enterAction="enterAction" @toggle-theme="toggleTheme" :isDarkMode="isDarkMode" />
    </template>

    <!-- JSON 处理器（主界面） -->
    <template v-else>
      <JsonProcessor :enterAction="enterAction" @toggle-theme="toggleTheme" :isDarkMode="isDarkMode" />
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
  }
</style>