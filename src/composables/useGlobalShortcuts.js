import { onUnmounted } from 'vue';

export function useGlobalShortcuts(handlers = {}) {
	const onKeydown = (event) => {
		try {
			if ((event.key || '') === 'Escape') {
				if (handlers.onEscape?.(event)) {
					return;
				}
			}

			const isCommand = event.metaKey || event.ctrlKey;
			if (!isCommand) return;

			const key = (event.key || '').toLowerCase();
			if (key === 'w' && shouldHandleCloseTabShortcut()) {
				event.preventDefault();
				handlers.onCloseTab?.(event);
			} else if (key === 'n') {
				event.preventDefault();
				handlers.onNewTab?.(event);
			}
		} catch (_) { }
	};

	if (typeof window !== 'undefined' && window.addEventListener) {
		window.addEventListener('keydown', onKeydown);
	}

	onUnmounted(() => {
		try { window.removeEventListener('keydown', onKeydown); } catch (_) { }
	});
}

function shouldHandleCloseTabShortcut() {
	const active = typeof document !== 'undefined' ? document.activeElement : null;
	const editorEl = typeof document !== 'undefined' ? document.querySelector('.editor-container') : null;
	const tabbarEl = typeof document !== 'undefined' ? document.querySelector('.tab-bar') : null;
	const inEditor = editorEl && active && (editorEl.contains(active) || active === editorEl);
	const inTabbar = tabbarEl && active && (tabbarEl.contains(active) || active === tabbarEl);
	const isTextInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
	return inEditor || inTabbar || !isTextInput;
}
