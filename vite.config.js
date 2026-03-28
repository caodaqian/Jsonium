import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 动态按需加载 vite-plugin-monaco-editor，避免同步导入在不同环境下解析失败
export default defineConfig(async () => {
  let monacoPlugin = null;
  try {
    const mod = await import('vite-plugin-monaco-editor');
    monacoPlugin = (mod && (mod.default || mod)) || null;
  } catch (err) {
    // 打印警告以便调试，但不阻塞 dev 启动
    // 这可以帮助在没有安装插件的环境下快速定位问题
    // eslint-disable-next-line no-console
    console.warn('[vite.config] vite-plugin-monaco-editor import failed:', err && err.message ? err.message : err);
    monacoPlugin = null;
  }

  const plugins = [vue()];
  if (typeof monacoPlugin === 'function') {
    try {
      // 显式传入 languages: ['json']，并保留空间传递试验性选项（插件可能忽略不支持的字段）
      // 目标：确保 vite-plugin-monaco-editor 在打包/开发时包含 JSON 语言及其 worker 处理逻辑
      plugins.push(monacoPlugin({
        languages: ['json'],
        filename: 'static/js/[name].[hash].worker.js',
        globalAPI: true
      }));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[vite.config] failed to initialize monaco plugin:', e && e.message ? e.message : e);
    }
  }

  return {
    plugins,
    base: './',
    server: {
      port: 4000
    }
  };
})
