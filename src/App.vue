<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Hello from './Hello/index.vue';
import JsonProcessor from './components/JsonProcessor.vue';
import Toast from './components/Toast.vue';
import { useJsonStore } from './store';

// 新增主题资源
import './main.css';
import './theme/theme-catppuccin.css';
import './theme/theme-vue.css';

const route = ref('process');
const enterAction = ref({});

let _mq = null;
let _themeUpdateListener = null;

const store = useJsonStore();

const themeState = ref({
	theme: 'catppuccin',
	mode: 'auto', // auto|dark|light
});

function syncHtmlThemeClass(theme, mode) {
	const html = globalThis.document?.documentElement;
	if (!html) return;
	html.classList.remove('catppuccin', 'vue', 'light-mode', 'dark-mode');
	html.classList.add(theme, mode === 'dark' ? 'dark-mode' : 'light-mode');
}

function dispatchJsoniumEvent(name, detail) {
	if (!globalThis.window || typeof globalThis.window.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') {
		return;
	}

	globalThis.window.dispatchEvent(new globalThis.CustomEvent(name, { detail }));
}

// 主题变更响应
function applyTheme() {
	const { theme, mode } = store.getEffectiveTheme();
	themeState.value = { theme, mode };
	syncHtmlThemeClass(theme, mode);
	dispatchJsoniumEvent('jsonium-theme-applied', { theme, mode });
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
	if ((action?.code || '') !== 'process') return false;
	if ((action?.type || '') === 'files') return false;
	const text = typeof action?.text === 'string' ? action.text : '';
	if (text.trim()) return false;
	const payload = typeof action?.payload === 'string' ? action.payload : '';
	return !isLikelyStructuredText(payload);
};

const readClipboardText = async () => {
	try {
		const services = globalThis.window?.services;
		if (typeof services?.readClipboardText === 'function') {
			return services.readClipboardText() || '';
		}

		const clipboard = globalThis.navigator?.clipboard;
		if (typeof clipboard?.readText === 'function') {
			return await clipboard.readText();
		}
	} catch (error) {
		console.warn('读取剪贴板失败:', error);
	}
	return '';
};

const getActionFilePath = (action) => {
	const payload = action?.payload;
	const file = Array.isArray(payload) ? payload[0] : payload;
	if (typeof file === 'string') return file;
	if (file && typeof file.path === 'string') return file.path;
	return '';
};

const readActionFileText = async (action) => {
	const filePath = getActionFilePath(action);
	const readFile = globalThis.window?.services?.readFile;
	if (!filePath || typeof readFile !== 'function') {
		return '';
	}

	try {
		return await readFile(filePath) || '';
	} catch (error) {
		console.warn('读取入口文件失败:', error);
		return '';
	}
};

const handlePluginEnter = async (action = {}) => {
	const nextAction = { ...action };
	if ((action?.code || '') === 'process' && (action?.type || '') === 'files') {
		const fileText = await readActionFileText(action);
		if (fileText) {
			nextAction.text = fileText;
		}
	} else if (shouldReadClipboard(action)) {
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
	if (globalThis.window) {
		globalThis.window.applyTheme = applyTheme;
	}

	// 2. 监听系统主题变化、uTools 主题全局变更
	_themeUpdateListener = () => { if (store.getThemePreference().mode === 'auto') applyTheme(); };
	const appWindow = globalThis.window;
	if (appWindow) {
		_mq = appWindow.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
		if (_mq && typeof _mq.addEventListener === 'function') {
			_mq.addEventListener('change', _themeUpdateListener);
		}

		if (typeof appWindow.utools?.onPluginEnter === 'function') {
			appWindow.utools.onPluginEnter(async (action) => {
				applyTheme();
				await handlePluginEnter(action);
				nextTick(() => dispatchJsoniumEvent('jsonium-plugin-enter'));
			});
		}
	}

	// 3. 设置路由、指令等事件监听
	// ...保留原逻辑
});

watch(() => store.themePreference, () => {
	applyTheme();
}, { deep: true });

onBeforeUnmount(() => {
	if (_mq && typeof _mq.removeEventListener === 'function' && _themeUpdateListener) {
		_mq.removeEventListener('change', _themeUpdateListener);
	}
	_themeUpdateListener = null;
	if (globalThis.window?.applyTheme === applyTheme) {
		globalThis.window.applyTheme = null;
	}
});
</script>

<template>
	<div class="app-container">
		<!-- Hello 欢迎页面（调试用） -->
		<template v-if="route === 'hello'">
			<Hello :enter-action="enterAction" :is-dark-mode="themeState.mode === 'dark'" />
		</template>
		<!-- JSON 处理器（主界面） -->
		<template v-else>
			<JsonProcessor :enter-action="enterAction" :is-dark-mode="themeState.mode === 'dark'" />
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