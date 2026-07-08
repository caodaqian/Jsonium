export async function loadMonacoEditor() {
	try { await import('monaco-editor/min/vs/editor/editor.main.css'); } catch (_) { }

	try {
		const module = await import('monaco-editor/esm/vs/editor/editor.api');
		try { await import('monaco-editor/esm/vs/editor/contrib/stickyScroll/browser/stickyScrollContribution'); } catch (_) { }
		return setGlobalMonaco(normalizeMonacoModule(module));
	} catch (_) {
		try {
			const fallbackModule = await import('monaco-editor');
			return setGlobalMonaco(normalizeMonacoModule(fallbackModule));
		} catch (_) {
			return getGlobalMonaco();
		}
	}
}

export async function ensureJsonLanguage(monaco) {
	try {
		if (!monaco?.languages) {
			return;
		}

		if (typeof monaco.languages.getLanguages === 'function') {
			const hasJson = monaco.languages.getLanguages().some((language) => language?.id === 'json');
			if (hasJson) {
				return;
			}
		}

		await import('monaco-editor/esm/vs/language/json/monaco.contribution');
	} catch (_) { }
}

export function configureJsonDiagnostics(monaco) {
	try {
		const jsonDefaults = monaco?.languages?.json?.jsonDefaults;
		if (!jsonDefaults || typeof jsonDefaults.setDiagnosticsOptions !== 'function') {
			return;
		}

		jsonDefaults.setDiagnosticsOptions({
			validate: true,
			enableSchemaRequest: false,
			allowComments: true,
			schemas: []
		});
	} catch (_) { }
}

function normalizeMonacoModule(module) {
	if (module?.default?.editor) return module.default;
	if (module?.editor) return module;
	return getGlobalMonaco();
}

function setGlobalMonaco(monaco) {
	try {
		if (monaco && typeof window !== 'undefined' && !window.monaco) {
			window.monaco = monaco;
		}
	} catch (_) { }
	return monaco || null;
}

function getGlobalMonaco() {
	try {
		return typeof window !== 'undefined' ? (window.monaco || null) : null;
	} catch (_) {
		return null;
	}
}
