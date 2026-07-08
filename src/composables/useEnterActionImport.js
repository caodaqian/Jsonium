import { nextTick } from 'vue';
import { detectAndConvert, FORMAT_TYPES } from '../services/formatDetector.js';

export function useEnterActionImport(store, editorRef, activePanel) {
	const ensureInitialTab = () => {
		try {
			const currentTabs = Array.isArray(store.tabs)
				? store.tabs
				: (store.tabs && Array.isArray(store.tabs.value) ? store.tabs.value : []);
			if (!Array.isArray(currentTabs) || currentTabs.length === 0) {
				store.addTab('{}', '', FORMAT_TYPES.JSON);
			}
		} catch (_) {
			try { store.addTab('{}', '', FORMAT_TYPES.JSON); } catch (_) { }
		}
	};

	const restoreTabsOrCreateInitial = async () => {
		try {
			if (typeof store.loadTabsState !== 'function') {
				ensureInitialTab();
				return;
			}

			const restored = await store.loadTabsState();
			if (restored && typeof store.cleanupOldTabs === 'function') {
				try { store.cleanupOldTabs(1); } catch (_) { }
			}
			ensureInitialTab();
		} catch (_) {
			ensureInitialTab();
		}
	};

	const importEnterAction = async (action) => {
		const text = action?.text;
		if (!text) {
			return;
		}

		const result = await detectAndConvert(text);
		if (!result.success) {
			return;
		}

		store.addTab(result.data, '导入内容', result.originalFormat);
		activePanel.value = 'editor';

		await nextTick();
		await nextTick();

		if (editorRef.value && typeof editorRef.value.format === 'function') {
			editorRef.value.format();
		}
	};

	return {
		ensureInitialTab,
		restoreTabsOrCreateInitial,
		importEnterAction
	};
}
