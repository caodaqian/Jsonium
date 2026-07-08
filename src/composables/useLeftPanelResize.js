import { computed, onUnmounted, ref } from 'vue';

export function useLeftPanelResize(isNarrow, options = {}) {
	const defaultWidth = options.defaultWidth ?? 340;
	const minWidth = options.minWidth ?? 280;
	const maxWidth = options.maxWidth ?? 420;
	const leftPanelWidth = ref(defaultWidth);
	const isLeftResizing = ref(false);

	const clampLeftPanelWidth = (width) => {
		const numeric = Number(width);
		if (!Number.isFinite(numeric)) return defaultWidth;
		return Math.max(minWidth, Math.min(maxWidth, numeric));
	};

	const controlPanelStyle = computed(() => {
		if (isNarrow.value) {
			return null;
		}

		const width = clampLeftPanelWidth(leftPanelWidth.value);
		return {
			width: `${width}px`,
			minWidth: `${minWidth}px`,
			maxWidth: `${maxWidth}px`,
			flex: `0 0 ${width}px`
		};
	});

	const clearLeftResizeSelection = () => {
		isLeftResizing.value = false;
		try {
			if (typeof document !== 'undefined' && document.body) {
				document.body.style.userSelect = '';
				document.body.style.cursor = '';
			}
		} catch (_) { }
	};

	const startLeftPanelResize = (event) => {
		if (isNarrow.value || event.button !== 0) {
			return;
		}

		event.preventDefault();
		const startX = event.clientX;
		const startWidth = clampLeftPanelWidth(leftPanelWidth.value);

		const onMove = (moveEvent) => {
			const next = startWidth + (moveEvent.clientX - startX);
			leftPanelWidth.value = clampLeftPanelWidth(next);
		};

		const stop = () => {
			try {
				if (typeof window !== 'undefined') {
					window.removeEventListener('mousemove', onMove);
					window.removeEventListener('mouseup', stop);
				}
			} catch (_) { }
			clearLeftResizeSelection();
		};

		isLeftResizing.value = true;
		try {
			if (typeof document !== 'undefined' && document.body) {
				document.body.style.userSelect = 'none';
				document.body.style.cursor = 'col-resize';
			}
		} catch (_) { }

		if (typeof window !== 'undefined') {
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', stop);
		}
	};

	const resetLeftPanelWidth = () => {
		leftPanelWidth.value = defaultWidth;
	};

	onUnmounted(clearLeftResizeSelection);

	return {
		controlPanelStyle,
		isLeftResizing,
		startLeftPanelResize,
		resetLeftPanelWidth,
		clearLeftResizeSelection
	};
}
