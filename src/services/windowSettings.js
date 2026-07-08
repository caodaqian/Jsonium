export const UTOOLS_WINDOW_SIZE_PRESETS = {
	medium: { label: '中', heightPercent: 64 },
	large: { label: '大', heightPercent: 78 },
	extraLarge: { label: '超大', heightPercent: 92 }
};

export const DEFAULT_UTOOLS_WINDOW_SETTINGS = {
	sizePreset: 'large',
	heightPercent: UTOOLS_WINDOW_SIZE_PRESETS.large.heightPercent
};

const MIN_HEIGHT_PERCENT = 50;
const MAX_HEIGHT_PERCENT = 95;
const MIN_EXPEND_HEIGHT = 360;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toFiniteNumber = (value) => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : null;
};

export const normalizeUtoolsWindowSettings = (settings = {}) => {
	const sizePreset = Object.prototype.hasOwnProperty.call(UTOOLS_WINDOW_SIZE_PRESETS, settings?.sizePreset) || settings?.sizePreset === 'custom'
		? settings.sizePreset
		: DEFAULT_UTOOLS_WINDOW_SETTINGS.sizePreset;
	const presetPercent = UTOOLS_WINDOW_SIZE_PRESETS[sizePreset]?.heightPercent ?? DEFAULT_UTOOLS_WINDOW_SETTINGS.heightPercent;
	const numericPercent = toFiniteNumber(settings?.heightPercent);
	const heightPercent = clamp(
		Math.round(numericPercent ?? presetPercent),
		MIN_HEIGHT_PERCENT,
		MAX_HEIGHT_PERCENT
	);

	return { sizePreset, heightPercent };
};

export const getCurrentDisplayWorkArea = (utools, windowObject = {}) => {
	try {
		if (utools && typeof utools.getCursorScreenPoint === 'function' && typeof utools.getDisplayNearestPoint === 'function') {
			const point = utools.getCursorScreenPoint();
			const display = utools.getDisplayNearestPoint(point);
			const workArea = display?.workArea || display?.workAreaSize || display?.bounds;
			if (workArea && Number.isFinite(Number(workArea.height))) {
				return { height: Number(workArea.height) };
			}
		}
	} catch (_) {
		// fall through to browser fallbacks
	}

	const screenHeight = toFiniteNumber(windowObject?.screen?.availHeight);
	if (screenHeight) return { height: screenHeight };

	const innerHeight = toFiniteNumber(windowObject?.innerHeight);
	if (innerHeight) return { height: innerHeight };

	return { height: 800 };
};

export const calculateExpendHeight = (settings = {}, context = {}) => {
	const normalized = normalizeUtoolsWindowSettings(settings);
	const contextHeight = toFiniteNumber(context?.workAreaHeight);
	const workAreaHeight = contextHeight || getCurrentDisplayWorkArea(context?.utools, context?.windowObject || context).height;
	const availableHeight = Math.max(1, Math.round(workAreaHeight));
	const rawHeight = Math.round(availableHeight * normalized.heightPercent / 100);
	const minHeight = Math.min(MIN_EXPEND_HEIGHT, availableHeight);

	return clamp(rawHeight, minHeight, availableHeight);
};

export const applyUtoolsWindowSettings = (settings = {}, runtime = globalThis.window) => {
	const utools = runtime?.utools;
	if (!utools || typeof utools.setExpendHeight !== 'function') {
		return { success: false, appliedHeight: null, reason: 'utools-unavailable' };
	}

	const appliedHeight = calculateExpendHeight(settings, { ...runtime, utools });

	try {
		const result = utools.setExpendHeight(appliedHeight);
		if (result === false) {
			return { success: false, appliedHeight, reason: 'apply-failed' };
		}
		return { success: true, appliedHeight, reason: 'applied' };
	} catch (_) {
		return { success: false, appliedHeight, reason: 'apply-failed' };
	}
};
