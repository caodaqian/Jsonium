const WORKER_PATHS = {
	json: '/node_modules/monaco-editor/esm/vs/language/json/json.worker.js',
	editor: '/node_modules/monaco-editor/esm/vs/editor/editor.worker.js'
};

export function installMonacoEnvironment(sourceLabel = 'Monaco', errorRecordLabel = sourceLabel.toLowerCase()) {
	if (typeof window === 'undefined') {
		return;
	}

	try {
		const existingEnv = window.MonacoEnvironment || {};
		const savedGetWorker = existingEnv.getWorker;
		const savedGetWorkerUrl = existingEnv.getWorkerUrl;

		window.MonacoEnvironment = existingEnv;
		window.MonacoEnvironment.getWorker = (moduleId, label) => {
			try {
				if (typeof savedGetWorkerUrl === 'function') {
					try {
						return new Worker(savedGetWorkerUrl(moduleId, label));
					} catch (_) {
						// fall through
					}
				}
				if (typeof savedGetWorker === 'function') {
					try {
						return savedGetWorker(moduleId, label);
					} catch (_) {
						// fall through
					}
				}
			} catch (_) {
				// fall through
			}

			const workerPath = label === 'json' ? WORKER_PATHS.json : WORKER_PATHS.editor;

			try {
				return createModuleWorker(workerPath, sourceLabel, errorRecordLabel);
			} catch (moduleError) {
				logWorkerError(sourceLabel, 'module worker creation error', moduleError);
			}

			try {
				return createBlobModuleWorker(workerPath, sourceLabel, errorRecordLabel);
			} catch (blobError) {
				logWorkerError(sourceLabel, 'blob module worker creation error', blobError);
			}

			try {
				return createImportScriptsWorker(workerPath, sourceLabel, errorRecordLabel);
			} catch (scriptError) {
				logWorkerError(sourceLabel, 'importScripts worker creation error', scriptError);
				throw scriptError;
			}
		};
	} catch (_) {
		// ignore injection failures
	}
}

function createModuleWorker(path, sourceLabel, errorRecordLabel) {
	const worker = new Worker(path, { type: 'module' });
	attachWorkerErrorHandlers(worker, sourceLabel, errorRecordLabel);
	return worker;
}

function createBlobModuleWorker(path, sourceLabel, errorRecordLabel) {
	const url = makeUrl(path);
	const blob = new Blob([`import("${url}");`], { type: 'application/javascript' });
	const blobUrl = URL.createObjectURL(blob);

	try {
		const worker = new Worker(blobUrl, { type: 'module' });
		attachWorkerErrorHandlers(worker, sourceLabel, errorRecordLabel);
		return worker;
	} finally {
		try { URL.revokeObjectURL(blobUrl); } catch (_) { }
	}
}

function createImportScriptsWorker(path, sourceLabel, errorRecordLabel) {
	const url = makeUrl(path);
	const blob = new Blob([`self.importScripts("${url}");`], { type: 'application/javascript' });
	const blobUrl = URL.createObjectURL(blob);

	try {
		const worker = new Worker(blobUrl);
		attachWorkerErrorHandlers(worker, sourceLabel, errorRecordLabel);
		return worker;
	} finally {
		try { URL.revokeObjectURL(blobUrl); } catch (_) { }
	}
}

function makeUrl(path) {
	try {
		if (typeof location !== 'undefined' && typeof path === 'string' && path.startsWith('/')) {
			return new URL(path, location.origin).toString();
		}
	} catch (_) { }
	return path;
}

function attachWorkerErrorHandlers(worker, sourceLabel, errorRecordLabel) {
	if (!worker || typeof worker.addEventListener !== 'function') {
		return;
	}

	worker.addEventListener('error', (event) => {
		const detail = getWorkerErrorDetail(event);
		logWorkerMessage(sourceLabel, 'worker error event', detail);
		recordWorkerError(errorRecordLabel, detail);
	});

	worker.addEventListener('messageerror', (event) => {
		logWorkerMessage(sourceLabel, 'worker messageerror', event);
	});
}

function getWorkerErrorDetail(event) {
	const message = event?.message || '';
	const locationText = event?.filename ? ` ${event.filename}:${event.lineno || 0}:${event.colno || 0}` : '';
	const errorText = event?.error?.message ? ` error:${event.error.message}` : '';
	return `${message}${locationText}${errorText}`.trim();
}

function logWorkerError(sourceLabel, label, error) {
	logWorkerMessage(sourceLabel, label, error?.message || error);
}

function logWorkerMessage(sourceLabel, label, value) {
	try {
		console.error(`[${sourceLabel}] ${label}`, value);
	} catch (_) { }
}

function recordWorkerError(errorRecordLabel, detail) {
	try {
		if (typeof window === 'undefined') return;
		window.__jsonium_worker_errors = window.__jsonium_worker_errors || [];
		window.__jsonium_worker_errors.push({
			ts: Date.now(),
			label: errorRecordLabel,
			detail
		});
	} catch (_) { }
}
