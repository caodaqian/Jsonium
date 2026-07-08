export async function copyText(text, options = {}) {
	if (text === null || text === undefined) {
		return false;
	}

	const payload = normalizeClipboardText(text, options);

	if (copyWithUtools(payload)) {
		return true;
	}

	if (await copyWithNavigator(payload)) {
		return true;
	}

	return copyWithTextarea(payload);
}

function normalizeClipboardText(text, options) {
	const preserveWhitespace = options.preserveWhitespace !== false;
	const payload = String(text);
	return preserveWhitespace ? payload : payload.replace(/\s+/g, '');
}

function copyWithUtools(payload) {
	try {
		const copyText = typeof window !== 'undefined' ? window.utools?.copyText : null;
		if (typeof copyText !== 'function') {
			return false;
		}
		copyText(payload);
		return true;
	} catch (_) {
		return false;
	}
}

async function copyWithNavigator(payload) {
	try {
		if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
			return false;
		}
		await navigator.clipboard.writeText(payload);
		return true;
	} catch (_) {
		return false;
	}
}

function copyWithTextarea(payload) {
	try {
		if (typeof document === 'undefined' || !document.body) {
			return false;
		}

		const textarea = document.createElement('textarea');
		textarea.value = payload;
		textarea.setAttribute('readonly', '');
		textarea.style.position = 'fixed';
		textarea.style.left = '-9999px';
		document.body.appendChild(textarea);
		textarea.select();
		const ok = document.execCommand('copy');
		document.body.removeChild(textarea);
		return ok !== false;
	} catch (_) {
		return false;
	}
}
