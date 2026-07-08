import { describe, expect, it, vi } from 'vitest';
import {
	applyUtoolsWindowSettings,
	calculateExpendHeight,
	DEFAULT_UTOOLS_WINDOW_SETTINGS,
	normalizeUtoolsWindowSettings,
	UTOOLS_WINDOW_SIZE_PRESETS
} from '../services/windowSettings.js';

describe('windowSettings', () => {
	it('normalizes friendly preset settings and maps presets to percentages', () => {
		expect(UTOOLS_WINDOW_SIZE_PRESETS.medium.heightPercent).toBe(64);
		expect(UTOOLS_WINDOW_SIZE_PRESETS.large.heightPercent).toBe(78);
		expect(UTOOLS_WINDOW_SIZE_PRESETS.extraLarge.heightPercent).toBe(92);

		expect(normalizeUtoolsWindowSettings({ sizePreset: 'extraLarge' })).toEqual({
			sizePreset: 'extraLarge',
			heightPercent: 92
		});
	});

	it('falls back invalid presets and clamps custom height percent', () => {
		expect(normalizeUtoolsWindowSettings({ sizePreset: 'huge', heightPercent: 140 })).toEqual({
			sizePreset: DEFAULT_UTOOLS_WINDOW_SETTINGS.sizePreset,
			heightPercent: 95
		});
		expect(normalizeUtoolsWindowSettings({ sizePreset: 'custom', heightPercent: 20 })).toEqual({
			sizePreset: 'custom',
			heightPercent: 50
		});
	});

	it('calculates expend height from display work area without exposing px in settings', () => {
		const height = calculateExpendHeight(
			{ sizePreset: 'large', heightPercent: 78 },
			{ workAreaHeight: 1000 }
		);

		expect(height).toBe(780);
	});

	it('applies height through uTools setExpendHeight when available', () => {
		const setExpendHeight = vi.fn(() => true);
		const result = applyUtoolsWindowSettings(
			{ sizePreset: 'medium', heightPercent: 64 },
			{
				utools: { setExpendHeight },
				screen: { availHeight: 1000 },
				innerHeight: 800
			}
		);

		expect(result).toEqual({ success: true, appliedHeight: 640, reason: 'applied' });
		expect(setExpendHeight).toHaveBeenCalledWith(640);
	});

	it('uses cursor display work area before screen fallback', () => {
		const setExpendHeight = vi.fn(() => true);
		const getCursorScreenPoint = vi.fn(() => ({ x: 100, y: 200 }));
		const getDisplayNearestPoint = vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1600, height: 900 } }));

		const result = applyUtoolsWindowSettings(
			{ sizePreset: 'extraLarge', heightPercent: 92 },
			{
				utools: { setExpendHeight, getCursorScreenPoint, getDisplayNearestPoint },
				screen: { availHeight: 1200 },
				innerHeight: 700
			}
		);

		expect(result.appliedHeight).toBe(828);
		expect(getDisplayNearestPoint).toHaveBeenCalledWith({ x: 100, y: 200 });
		expect(setExpendHeight).toHaveBeenCalledWith(828);
	});

	it('returns a no-op result outside uTools instead of throwing', () => {
		expect(applyUtoolsWindowSettings({ sizePreset: 'large', heightPercent: 78 }, { innerHeight: 800 })).toEqual({
			success: false,
			appliedHeight: null,
			reason: 'utools-unavailable'
		});
	});
});
