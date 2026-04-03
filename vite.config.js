import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
// 使用静态导入确保开发时 vite-plugin-monaco-editor 在启动阶段被解析并注册，方便插件生成 worker 文件
// 如果你的环境不允许静态导入（例如在某些 CI/特殊环境下），可以改回动态导入的写法。
import monacoEditor from 'vite-plugin-monaco-editor'

const monacoPlugin = (monacoEditor && (monacoEditor.default || monacoEditor)) || null;

export default defineConfig(() => {
  const plugins = [vue()];
  if (typeof monacoPlugin === 'function') {
    try {
      // 显式传入 languages: ['json']，并保留空间传递试验性选项
      plugins.push(monacoPlugin({
        languages: ['json'],
        filename: 'static/js/[name].[hash].worker.js',
        globalAPI: true
      }));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[vite.config] failed to initialize monaco plugin:', e && e.message ? e.message : e);
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn('[vite.config] vite-plugin-monaco-editor is not available synchronously; ensure it is installed.');
  }

  return {
    plugins,
    base: './',
    server: {
      port: 4000
    }
  };
})
