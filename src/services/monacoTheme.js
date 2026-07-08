export function getJsoniumThemeVars(mode = 'light') {
	try {
		const computedStyle = typeof window !== 'undefined'
			? window.getComputedStyle(document.documentElement)
			: null;

		return {
			bg: computedStyle?.getPropertyValue('--color-bg-primary')?.trim() || getFallbackBackground(mode),
			fg: computedStyle?.getPropertyValue('--color-text-primary')?.trim() || getFallbackForeground(mode)
		};
	} catch (_) {
		return {
			bg: getFallbackBackground(mode),
			fg: getFallbackForeground(mode)
		};
	}
}

export function defineAndSetMonacoTheme(monaco, mode = 'light', options = {}) {
	if (!monaco?.editor) return;

	const { bg, fg } = getJsoniumThemeVars(mode);
	const themeName = mode === 'light' ? 'jsonium-light' : 'jsonium-dark';
	const colors = {
		'editor.background': bg,
		'editor.foreground': fg,
		...(options.editorHighlights ? getEditorHighlightColors(mode) : {})
	};

	try {
		monaco.editor.defineTheme(themeName, {
			base: mode === 'light' ? 'vs' : 'vs-dark',
			inherit: true,
			rules: [],
			colors
		});
		monaco.editor.setTheme(themeName);
	} catch (_) {
		try { monaco.editor.setTheme(mode === 'light' ? 'vs' : 'vs-dark'); } catch (_) { }
	}
}

export function scheduleThemeRefresh(currentRaf, applyTheme) {
	try {
		if (currentRaf && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
			window.cancelAnimationFrame(currentRaf);
		}
	} catch (_) { }

	try {
		if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
			return window.requestAnimationFrame(() => applyTheme());
		}
	} catch (_) { }

	return setTimeout(() => applyTheme(), 0);
}

function getFallbackBackground(mode) {
	return mode === 'dark' ? '#24273a' : '#eff1f5';
}

function getFallbackForeground(mode) {
	return mode === 'dark' ? '#cad3f5' : '#4c4f69';
}

function getEditorHighlightColors(mode) {
	if (mode === 'light') {
		return {
			'editor.lineHighlightBackground': '#e3eaff',
			'editor.selectionBackground': '#c6a0f645'
		};
	}

	return {
		'editor.lineHighlightBackground': '#363a4f',
		'editor.selectionBackground': '#a6da9540'
	};
}
