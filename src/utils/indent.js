import { useJsonStore } from '../store/index.js';

export function getStringifyIndent() {
	try {
		// prefer persisted settings in localStorage for contexts where Pinia may not be initialized
		if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
			try {
				const raw = localStorage.getItem('json_settings_v1');
				if (raw) {
					const parsed = JSON.parse(raw);
					const es = parsed && parsed.editorSettings ? parsed.editorSettings : null;
					if (es) {
						if (es.useTab) return '\t';
						if (typeof es.tabSize === 'number') return es.tabSize;
						if (es.tabSize) return Number(es.tabSize) || 2;
					}
				}
			} catch (_) { }
		}

		// fallback to store if available
		try {
			const store = useJsonStore();
			const s = (store && store.getEditorSettings) ? store.getEditorSettings() : (store && store.editorSettings) ? store.editorSettings : null;
			if (s) {
				if (s.useTab) return '\t';
				return s.tabSize || 2;
			}
		} catch (_) { }
	} catch (_) { }
	return 2;
}

export default getStringifyIndent;

export function getTabSize() {
	try {
		if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
			try {
				const raw = localStorage.getItem('json_settings_v1');
				if (raw) {
					const parsed = JSON.parse(raw);
					const es = parsed && parsed.editorSettings ? parsed.editorSettings : null;
					if (es) {
						if (typeof es.tabSize === 'number') return es.tabSize;
						if (es.tabSize) return Number(es.tabSize) || 2;
					}
				}
			} catch (_) { }
		}
		try {
			const store = useJsonStore();
			const s = (store && store.getEditorSettings) ? store.getEditorSettings() : (store && store.editorSettings) ? store.editorSettings : null;
			if (s) return s.tabSize || 2;
		} catch (_) { }
	} catch (_) { }
	return 2;
}
