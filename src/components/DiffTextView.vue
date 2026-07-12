<script setup>
import { diffWordsWithSpace } from 'diff';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { buildLineDiffs, buildLineDiffsAsync } from '../services/diffEngine.js';
import { WORKER_OFFLOAD_CHARS } from '../services/editorFormatting.js';
import { installMonacoEnvironment } from '../services/monacoEnvironment.js';
import { configureJsonDiagnostics, ensureJsonLanguage, loadMonacoEditor } from '../services/monacoLoader.js';
import { defineAndSetMonacoTheme, scheduleThemeRefresh } from '../services/monacoTheme.js';
import { useJsonStore } from '../store/index.js';
let monaco = null;

const props = defineProps({
	left: { type: String, default: '' },
	right: { type: String, default: '' },
	language: { type: String, default: 'json' },
	singleColumn: { type: Boolean, default: false },
	options: { type: Object, default: () => ({}) }
});

const editorContainer = ref(null);
const store = useJsonStore();
let diffEditor = null;
let leftModel = null;
let rightModel = null;
const monacoAvailable = ref(false);
const monacoLoadError = ref('');
const monacoLoading = ref(true);
let themeAppliedHandler = null;
let themeRefreshRaf = null;

// When foldRanges is called before Monaco is ready, cache the ranges and
// apply them once Monaco becomes available.
const pendingFoldRanges = ref([]);

function getCurrentThemeMode() {
	try {
		const effectiveTheme = store.getEffectiveTheme ? store.getEffectiveTheme() : null;
		return effectiveTheme?.mode === 'dark' ? 'dark' : 'light';
	} catch (e) {
		return 'light';
	}
}

function applyCurrentTheme() {
	defineAndSetMonacoTheme(monaco, getCurrentThemeMode());
}

function installThemeRefreshListener() {
	if (themeAppliedHandler || typeof window === 'undefined') return;
	themeAppliedHandler = () => {
		themeRefreshRaf = scheduleThemeRefresh(themeRefreshRaf, () => {
			themeRefreshRaf = null;
			applyCurrentTheme();
		});
	};
	try {
		window.addEventListener('jsonium-theme-applied', themeAppliedHandler);
	} catch (e) {}
}

onMounted(async () => {
	try {
		if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITEST) {
			monaco = null;
			initDiffEditor();
			return;
		}
		if (typeof window === 'undefined') {
			monaco = null;
			initDiffEditor();
			return;
		}

		installMonacoEnvironment('DiffTextView', 'diff-text-view');

		try {
			monaco = await loadMonacoEditor();
			await ensureJsonLanguage(monaco);
			configureJsonDiagnostics(monaco);
		} catch (e) {
			monaco = null;
		}
	} catch (e) {
		monaco = null;
	}

	async function _waitForGlobalMonaco(timeoutMs = 2000, interval = 50) {
		const start = Date.now();
		if (monaco && monaco.editor) return monaco;
		if (typeof window !== 'undefined' && window.monaco && window.monaco.editor) {
			monaco = window.monaco;
			return monaco;
		}
		return new Promise((resolve) => {
			const t = setInterval(() => {
				if (typeof window !== 'undefined' && window.monaco && window.monaco.editor) {
					monaco = window.monaco;
					clearInterval(t);
					resolve(monaco);
				} else if (Date.now() - start > timeoutMs) {
					clearInterval(t);
					resolve(monaco);
				}
			}, interval);
		});
	}

	async function loadMonacoWithAttempts() {
		monacoLoading.value = true;
		monacoLoadError.value = '';
		try {
			if (monaco && monaco.editor) {
				// already have it
			} else if (typeof window !== 'undefined' && window.monaco && window.monaco.editor) {
				monaco = window.monaco;
			} else {
				let attempts = 0;
				const maxAttempts = 5;
				while (attempts < maxAttempts) {
					await _waitForGlobalMonaco(1000, 50);
					if (monaco && monaco.editor) break;
					attempts++;
				}
			}
		} catch (e) {
			// swallow
		}

		await nextTick();
		try {
			initDiffEditor();
			if (!monacoAvailable.value) {
				monacoLoadError.value = 'Monaco 编辑器加载失败，请确保 monaco-editor 已正确安装并可用。';
			}
		} catch (e) {
			monacoLoadError.value = '初始化 Monaco 编辑器出错: ' + (e && e.message ? e.message : String(e));
		}
		monacoLoading.value = false;
	}

	await loadMonacoWithAttempts();
});

async function retryLoadMonaco() {
	await loadMonacoWithAttempts();
}

onBeforeUnmount(() => {
	try { diffEditor?.dispose && diffEditor.dispose(); } catch (e) {}
	try { leftModel?.dispose && leftModel.dispose(); } catch (e) {}
	try { rightModel?.dispose && rightModel.dispose(); } catch (e) {}
	try {
		if (themeAppliedHandler && typeof window !== 'undefined') {
			window.removeEventListener('jsonium-theme-applied', themeAppliedHandler);
		}
	} catch (e) {}
	try {
		if (themeRefreshRaf) {
			if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
				window.cancelAnimationFrame(themeRefreshRaf);
			} else {
				clearTimeout(themeRefreshRaf);
			}
		}
	} catch (e) {}
	themeAppliedHandler = null;
	themeRefreshRaf = null;
});

function initDiffEditor() {
	if (!editorContainer.value) return;
	monacoAvailable.value = false;
	try {
		if (!monaco || !monaco.editor) {
			monacoAvailable.value = false;
			return;
		}

		const useSideBySide = !props.singleColumn;
		diffEditor = monaco.editor.createDiffEditor(editorContainer.value, {
			enableSplitViewResizing: true,
			renderSideBySide: useSideBySide,
			renderSideBySideInlineBreakpoint: useSideBySide ? 0 : Number.MAX_SAFE_INTEGER,
			useInlineViewWhenSpaceIsLimited: !useSideBySide,
			automaticLayout: true,
			folding: true,
			foldingStrategy: 'auto',
			showFoldingControls: 'always',
			...props.options,
			renderSideBySide: useSideBySide,
			renderSideBySideInlineBreakpoint: useSideBySide ? 0 : Number.MAX_SAFE_INTEGER,
			useInlineViewWhenSpaceIsLimited: !useSideBySide
		});

		leftModel = monaco.editor.createModel(props.left || '', props.language);
		rightModel = monaco.editor.createModel(props.right || '', props.language);

		diffEditor.setModel({ original: leftModel, modified: rightModel });

		monacoAvailable.value = true;

		try {
			const replay = () => {
				try {
					if (pendingFoldRanges.value && pendingFoldRanges.value && pendingFoldRanges.value.length) {
						for (const r of pendingFoldRanges.value) {
							try { exportsApplyFold(r); } catch (e) {}
						}
						pendingFoldRanges.value = [];
					}
				} catch (e) {}
			};
			setTimeout(replay, 50);
		} catch (e) {}

		try {
			if (leftModel && rightModel && monaco && monaco.editor && typeof monaco.editor.setModelLanguage === 'function') {
				monaco.editor.setModelLanguage(leftModel, props.language);
				monaco.editor.setModelLanguage(rightModel, props.language);
				try {
					applyCurrentTheme();
					if (typeof monaco.editor.tokenize === 'function') {
						try { monaco.editor.tokenize(leftModel.getValue(), props.language); } catch (_) {}
						try { monaco.editor.tokenize(rightModel.getValue(), props.language); } catch (_) {}
					}
				} catch (_) { /* ignore */ }
			}
		} catch (_) {}

		installThemeRefreshListener();

		try {
			const orig = diffEditor.getOriginalEditor();
			const mod = diffEditor.getModifiedEditor();
			if (orig && typeof orig.updateOptions === 'function') {
				orig.updateOptions({
					folding: true,
					foldingStrategy: 'auto',
					showFoldingControls: 'always',
					stickyScroll: {
						enabled: true,
						maxLineCount: 8,
						defaultModel: 'foldingProviderModel'
					}
				});
			}
			if (mod && typeof mod.updateOptions === 'function') {
				mod.updateOptions({
					folding: true,
					foldingStrategy: 'auto',
					showFoldingControls: 'always',
					stickyScroll: {
						enabled: true,
						maxLineCount: 8,
						defaultModel: 'foldingProviderModel'
					}
				});
			}
			setTimeout(() => { try { applyDiffDecorations(); } catch (_) {} }, 50);
		} catch (e) { /* ignore */ }
	} catch (e) {
		monacoAvailable.value = false;
		console.warn('[DiffTextView] initDiffEditor failed', e);
	}
}

let currentOrigDecorations = [];
let currentModDecorations = [];

function applyDiffDecorations() {
	try {
		if (!monacoAvailable.value || !diffEditor || !leftModel || !rightModel || !monaco) return;

		const origEditor = diffEditor.getOriginalEditor();
		const modEditor = diffEditor.getModifiedEditor();
		if (!origEditor || !modEditor) return;

		const leftText = leftModel.getValue().split(/\r?\n/);
		const rightText = rightModel.getValue().split(/\r?\n/);

		const leftStr = leftText.join('\n');
		const rightStr = rightText.join('\n');
		const useWorker = (leftStr.length > (WORKER_OFFLOAD_CHARS || 0)) || (rightStr.length > (WORKER_OFFLOAD_CHARS || 0));

		if (useWorker && typeof buildLineDiffsAsync === 'function') {
			buildLineDiffsAsync(leftStr, rightStr).then((diffs) => {
				try { _applyDiffsToEditors(diffs, origEditor, modEditor); } catch (e) { try { const fallback = buildLineDiffs(leftText, rightText); _applyDiffsToEditors(fallback, origEditor, modEditor); } catch (_) {} }
			}).catch(() => { try { const fallback = buildLineDiffs(leftText, rightText); _applyDiffsToEditors(fallback, origEditor, modEditor); } catch (_) {} });
			return;
		}

		const diffs = buildLineDiffs(leftText, rightText);

		const origDecs = [];
		const modDecs = [];
		const origInlineDecs = [];
		const modInlineDecs = [];

		for (let i = 0; i < diffs.length; i++) {
			const d = diffs[i];

			if (d.type === 'removed') {
				const line = d.leftLine || 1;
				origDecs.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'line-removed' } });

				const next = diffs[i + 1];
				if (next && next.type === 'added' && typeof d.left === 'string' && typeof next.right === 'string') {
					const leftStr = d.left;
					const rightStr = next.right;
					const parts = diffWordsWithSpace(leftStr, rightStr);

					let leftPos = 0;
					let rightPos = 0;
					for (const p of parts) {
						const text = String(p.value);
						if (p.added) {
							const start = rightPos + 1;
							const end = rightPos + Math.max(1, text.length);
							modInlineDecs.push({ range: new monaco.Range(next.rightLine || 1, start, next.rightLine || 1, end), options: { inlineClassName: 'inline-added' } });
							rightPos += text.length;
						} else if (p.removed) {
							const start = leftPos + 1;
							const end = leftPos + Math.max(1, text.length);
							origInlineDecs.push({ range: new monaco.Range(d.leftLine || 1, start, d.leftLine || 1, end), options: { inlineClassName: 'inline-removed' } });
							leftPos += text.length;
						} else {
							leftPos += text.length;
							rightPos += text.length;
						}
					}
					i++;
				}
			} else if (d.type === 'added') {
				const prev = diffs[i - 1];
				if (!(prev && prev.type === 'removed')) {
					const line = d.rightLine || 1;
					modDecs.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'line-added' } });
				}
			}
		}

		try { currentOrigDecorations = origEditor.deltaDecorations(currentOrigDecorations, origDecs.concat(origInlineDecs)); } catch (e) { currentOrigDecorations = []; }
		try { currentModDecorations = modEditor.deltaDecorations(currentModDecorations, modDecs.concat(modInlineDecs)); } catch (e) { currentModDecorations = []; }
	} catch (e) {
		// ignore
	}
}

function _applyDiffsToEditors(diffs, origEditor, modEditor) {
	const origDecs = [];
	const modDecs = [];
	const origInlineDecs = [];
	const modInlineDecs = [];

	for (let i = 0; i < diffs.length; i++) {
		const d = diffs[i];
		if (d.type === 'removed') {
			const line = d.leftLine || 1;
			origDecs.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'line-removed' } });
			const next = diffs[i + 1];
			if (next && next.type === 'added' && typeof d.left === 'string' && typeof next.right === 'string') {
				const leftStr = d.left;
				const rightStr = next.right;
				const parts = diffWordsWithSpace(leftStr, rightStr);
				let leftPos = 0;
				let rightPos = 0;
				for (const p of parts) {
					const text = String(p.value);
					if (p.added) {
						const start = rightPos + 1;
						const end = rightPos + Math.max(1, text.length);
						modInlineDecs.push({ range: new monaco.Range(next.rightLine || 1, start, next.rightLine || 1, end), options: { inlineClassName: 'inline-added' } });
						rightPos += text.length;
					} else if (p.removed) {
						const start = leftPos + 1;
						const end = leftPos + Math.max(1, text.length);
						origInlineDecs.push({ range: new monaco.Range(d.leftLine || 1, start, d.leftLine || 1, end), options: { inlineClassName: 'inline-removed' } });
						leftPos += text.length;
					} else {
						leftPos += text.length;
						rightPos += text.length;
					}
				}
				i++;
			}
		} else if (d.type === 'added') {
			const prev = diffs[i - 1];
			if (!(prev && prev.type === 'removed')) {
				const line = d.rightLine || 1;
				modDecs.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'line-added' } });
			}
		}
	}

	try { currentOrigDecorations = origEditor.deltaDecorations(currentOrigDecorations, origDecs.concat(origInlineDecs)); } catch (e) { currentOrigDecorations = []; }
	try { currentModDecorations = modEditor.deltaDecorations(currentModDecorations, modDecs.concat(modInlineDecs)); } catch (e) { currentModDecorations = []; }
}

watch(() => props.left, (v) => { if (!leftModel) return; const cur = leftModel.getValue(); if (cur !== v) leftModel.setValue(v); applyDiffDecorations(); });
watch(() => props.right, (v) => { if (!rightModel) return; const cur = rightModel.getValue(); if (cur !== v) rightModel.setValue(v); applyDiffDecorations(); });

defineExpose({
	getDiffEditor: () => diffEditor,
	revealOriginalLine: (line) => { if (!diffEditor || !monaco) return; try { const ed = diffEditor.getOriginalEditor(); if (!ed) return; try { if (typeof ed.revealPositionInCenter === 'function') ed.revealPositionInCenter({ lineNumber: line, column: 1 }); else if (typeof ed.revealLineInCenter === 'function') ed.revealLineInCenter(line); if (typeof monaco.Selection === 'function' && typeof ed.setSelection === 'function') ed.setSelection(new monaco.Selection(line, 1, line, 1)); } catch (e) {} } catch (e) {} },
	revealModifiedLine: (line) => { if (!diffEditor || !monaco) return; try { const ed = diffEditor.getModifiedEditor(); if (!ed) return; try { if (typeof ed.revealPositionInCenter === 'function') ed.revealPositionInCenter({ lineNumber: line, column: 1 }); else if (typeof ed.revealLineInCenter === 'function') ed.revealLineInCenter(line); if (typeof monaco.Selection === 'function' && typeof ed.setSelection === 'function') ed.setSelection(new monaco.Selection(line, 1, line, 1)); } catch (e) {} } catch (e) {} },
	foldRanges: (ranges) => { if (!diffEditor || !monaco) { try { pendingFoldRanges.value = pendingFoldRanges.value || []; pendingFoldRanges.value.push(ranges); } catch (e) {} return; } try { exportsApplyFold(ranges); } catch (e) {} },
	clearFold: () => { if (!diffEditor) return; try { const orig = diffEditor.getOriginalEditor(); const mod = diffEditor.getModifiedEditor(); try { orig.setHiddenAreas([]); } catch (e) {} try { mod.setHiddenAreas([]); } catch (e) {} } catch (e) {} }
});

function exportsApplyFold(ranges) {
	if (!diffEditor || !monaco) return;
	try {
		const orig = diffEditor.getOriginalEditor();
		const mod = diffEditor.getModifiedEditor();
		if (Array.isArray(ranges)) {
			const r = ranges.map(([s, e]) => new monaco.Range(s, 1, e, 1));
			if (orig && typeof orig.setHiddenAreas === 'function') try { orig.setHiddenAreas(r); } catch (e) {}
			if (mod && typeof mod.setHiddenAreas === 'function') try { mod.setHiddenAreas(r); } catch (e) {}
		} else if (ranges && typeof ranges === 'object') {
			const leftRanges = Array.isArray(ranges.left) ? ranges.left.map(([s, e]) => new monaco.Range(s, 1, e, 1)) : [];
			const rightRanges = Array.isArray(ranges.right) ? ranges.right.map(([s, e]) => new monaco.Range(s, 1, e, 1)) : [];
			if (orig && typeof orig.setHiddenAreas === 'function') try { orig.setHiddenAreas(leftRanges); } catch (e) {}
			if (mod && typeof mod.setHiddenAreas === 'function') try { mod.setHiddenAreas(rightRanges); } catch (e) {}
		}
	} catch (e) {}
}
</script>

<template>
	<div class="diff-text-wrapper">
		<div ref="editorContainer" class="diff-editor-container" />

		<div v-if="monacoLoading" class="overlay monaco-loading">
			<div class="loading-panel">
				<div class="loading-indicator" />
				<div class="loading-text">
					正在加载 Monaco 编辑器，请稍候……
				</div>
			</div>
		</div>

		<div v-if="!monacoLoading && !monacoAvailable" class="overlay monaco-error-panel">
			<div class="error-header">
				无法加载 Monaco 编辑器
			</div>
			<div class="error-message">
				{{ monacoLoadError || 'Monaco 编辑器不可用。' }}
			</div>
			<div class="error-actions">
				<button class="retry-button" :disabled="monacoLoading" @click="retryLoadMonaco">
					重试加载 Monaco
				</button>
			</div>
			<div class="error-hint">
				Json 语法高亮与折叠功能需要 Monaco 编辑器。请确保 monaco-editor 已正确安装或刷新页面。
			</div>
		</div>
	</div>
</template>

<style scoped>
.diff-text-wrapper { width: 100%; height: 100%; background: var(--color-bg-primary); }

  .diff-editor-container {
    width: 100%;
    height: 100%;
    background: var(--color-bg-secondary);
    border-radius: 4px;
    overflow: hidden;
  }

 
.line-added { background: rgba(16,185,129,0.10) !important; border-left: 4px solid rgba(16,185,129,0.8); }
.line-removed { background: rgba(239,68,68,0.06) !important; border-left: 4px solid rgba(239,68,68,0.9); }
.inline-added { background: rgba(16,185,129,0.20); color: #064e3b; padding: 0 2px; border-radius: 2px; }
.inline-removed { background: rgba(239,68,68,0.12); color: #7f1d1d; text-decoration: line-through; padding: 0 2px; border-radius: 2px; }
</style>

<style scoped>
.monaco-loading { width:100%; height:100%; display:flex; align-items:center; justify-content:center; }
.loading-panel { display:flex; flex-direction:column; align-items:center; gap:8px; }
.loading-indicator { width:28px; height:28px; border-radius:50%; border:3px solid rgba(255,255,255,0.08); border-top-color:var(--color-accent, #6b7280); animation:spin 1s linear infinite; }
.loading-text { color:var(--color-text-tertiary); font-size:13px; }
@keyframes spin { to { transform: rotate(360deg); } }
.monaco-error-panel { padding:16px; display:flex; flex-direction:column; gap:8px; align-items:flex-start; }
.error-header { font-weight:700; color:var(--color-danger, #f87171); }
.error-message { color:var(--color-text-primary); }
.error-actions { margin-top:6px; }
.retry-button { background:var(--color-accent, #4f46e5); color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; }
.retry-button:disabled { opacity:0.6; cursor:not-allowed; }
.error-hint { color:var(--color-text-tertiary); font-size:12px; margin-top:8px; }
</style>
