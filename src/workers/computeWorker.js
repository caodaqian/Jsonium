// Worker module performing heavy text diff/format computations.
import { approximateChangeRatio, ensureTrailingNewline, normalizeLineEndings } from '../utils/textUtils.js';

function _createRangeNumeric(startLine, startCol, endLine, endCol) {
	return {
		startLineNumber: startLine,
		startColumn: startCol,
		endLineNumber: endLine,
		endColumn: endCol
	};
}

function computeMinimalEditsWorker(oldText, newText) {
	if (oldText === newText) return [];

	const oldNorm = normalizeLineEndings(oldText, 'auto');
	const newNorm = normalizeLineEndings(newText, 'auto');

	const oldHasTrailing = /\r?\n$/.test(oldNorm);
	const newHasTrailing = /\r?\n$/.test(newNorm);
	const oldFinal = oldHasTrailing ? oldNorm : ensureTrailingNewline(oldNorm, false);
	const newFinal = newHasTrailing ? newNorm : ensureTrailingNewline(newNorm, false);

	const oldLines = oldFinal.split(/\r\n|\n/);
	const newLines = newFinal.split(/\r\n|\n/);

	const changeRatio = approximateChangeRatio(oldFinal, newFinal);
	const FULL_REPLACE_THRESHOLD = 0.6;

	if (changeRatio >= FULL_REPLACE_THRESHOLD) {
		const endLine = oldLines.length || 1;
		const endCol = (oldLines[oldLines.length - 1] ? oldLines[oldLines.length - 1].length + 1 : 1);
		const range = _createRangeNumeric(1, 1, endLine, endCol);
		return [{ range, text: newFinal }];
	}

	let prefixLen = 0;
	const minLen = Math.min(oldLines.length, newLines.length);
	while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) {
		prefixLen++;
	}

	let suffixLen = 0;
	while (
		suffixLen < (minLen - prefixLen) &&
		oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
	) {
		suffixLen++;
	}

	const oldDiffStart = prefixLen;
	const oldDiffEnd = oldLines.length - suffixLen;
	const newDiffStart = prefixLen;
	const newDiffEnd = newLines.length - suffixLen;

	if (oldDiffStart >= oldDiffEnd && newDiffStart >= newDiffEnd) {
		return [];
	}

	const replacementLines = newLines.slice(newDiffStart, newDiffEnd);
	const replacementText = replacementLines.join('\n');

	const edits = [];

	if (oldDiffStart >= oldDiffEnd) {
		if (oldDiffStart > 0) {
			const prevLineLen = oldLines[oldDiffStart - 1].length;
			const range = _createRangeNumeric(oldDiffStart, prevLineLen + 1, oldDiffStart, prevLineLen + 1);
			edits.push({ range, text: '\n' + replacementText });
		} else {
			const range = _createRangeNumeric(1, 1, 1, 1);
			edits.push({ range, text: replacementText + '\n' });
		}
	} else if (newDiffStart >= newDiffEnd) {
		const endLine = oldDiffEnd;
		const endCol = oldLines[oldDiffEnd - 1] ? oldLines[oldDiffEnd - 1].length + 1 : 1;

		if (oldDiffStart > 0) {
			const prevLineLen = oldLines[oldDiffStart - 1].length;
			const range = _createRangeNumeric(oldDiffStart, prevLineLen + 1, endLine, endCol);
			edits.push({ range, text: '' });
		} else if (oldDiffEnd < oldLines.length) {
			const range = _createRangeNumeric(1, 1, oldDiffEnd + 1, 1);
			edits.push({ range, text: '' });
		} else {
			const range = _createRangeNumeric(1, 1, endLine, endCol);
			edits.push({ range, text: '' });
		}
	} else {
		const startLine = oldDiffStart + 1;
		const endLine = oldDiffEnd;
		const endCol = oldLines[oldDiffEnd - 1] ? oldLines[oldDiffEnd - 1].length + 1 : 1;
		const range = _createRangeNumeric(startLine, 1, endLine, endCol);
		edits.push({ range, text: replacementText });
	}

	return edits;
}

function buildLineDiffsWorker(leftText, rightText) {
	const leftLines = typeof leftText === 'string' ? leftText.split(/\r\n|\n/) : (leftText || []);
	const rightLines = typeof rightText === 'string' ? rightText.split(/\r\n|\n/) : (rightText || []);
	const leftLen = leftLines.length;
	const rightLen = rightLines.length;
	const dp = Array.from({ length: leftLen + 1 }, () => new Array(rightLen + 1).fill(0));

	for (let i = leftLen - 1; i >= 0; i--) {
		for (let j = rightLen - 1; j >= 0; j--) {
			if (leftLines[i] === rightLines[j]) {
				dp[i][j] = dp[i + 1][j + 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
			}
		}
	}

	const diffLines = [];
	let i = 0;
	let j = 0;
	while (i < leftLen && j < rightLen) {
		if (leftLines[i] === rightLines[j]) {
			diffLines.push({ left: leftLines[i], right: rightLines[j], leftLine: i + 1, rightLine: j + 1, type: 'unchanged' });
			i++; j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			diffLines.push({ left: leftLines[i], right: '', leftLine: i + 1, type: 'removed' });
			i++;
		} else {
			diffLines.push({ left: '', right: rightLines[j], rightLine: j + 1, type: 'added' });
			j++;
		}
	}

	while (i < leftLen) {
		diffLines.push({ left: leftLines[i], right: '', leftLine: i + 1, type: 'removed' });
		i++;
	}

	while (j < rightLen) {
		diffLines.push({ left: '', right: rightLines[j], rightLine: j + 1, type: 'added' });
		j++;
	}

	return diffLines;
}

self.addEventListener('message', (ev) => {
	const msg = ev.data || {};
	const id = msg.id;
	const action = msg.action;
	const payload = msg.payload || {};
	try {
		if (action === 'computeMinimalEdits') {
			const res = computeMinimalEditsWorker(payload.oldText || '', payload.newText || '');
			postMessage({ id, result: res });
		} else if (action === 'buildLineDiffs') {
			const res = buildLineDiffsWorker(payload.leftText || '', payload.rightText || '');
			postMessage({ id, result: res });
		} else {
			postMessage({ id, error: 'unknown-action' });
		}
	} catch (e) {
		postMessage({ id, error: e && e.message ? e.message : String(e) });
	}
});
