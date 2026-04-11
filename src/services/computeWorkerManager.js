// Lightweight manager for a shared compute WebWorker used to offload heavy text/diff work.
let _worker = null;
let _nextId = 1;
const _pending = new Map();

function _initWorker() {
	if (_worker) return _worker;
	try {
		// Preferred: ESM module worker (Vite will bundle this correctly)
		_worker = new Worker(new URL('../workers/computeWorker.js', import.meta.url), { type: 'module' });
	} catch (e) {
		// If ESM worker creation fails, surface the error so callers can fallback
		throw e;
	}

	_worker.onmessage = (ev) => {
		const msg = ev.data || {};
		const id = msg.id;
		if (!_pending.has(id)) return;
		const { resolve, reject } = _pending.get(id);
		_pending.delete(id);
		if (msg.error) reject(new Error(msg.error));
		else resolve(msg.result);
	};

	_worker.onerror = (err) => {
		// Reject all pending promises on fatal worker error
		for (const [id, p] of _pending.entries()) {
			try { p.reject(err); } catch (_) { }
			_pending.delete(id);
		}
	};

	return _worker;
}

export function runWorkerTask(action, payload, opts = {}) {
	return new Promise((resolve, reject) => {
		let worker;
		try {
			worker = _initWorker();
		} catch (e) {
			return reject(e);
		}

		const id = _nextId++;
		_pending.set(id, { resolve, reject });
		try {
			worker.postMessage({ id, action, payload });
		} catch (e) {
			_pending.delete(id);
			return reject(e);
		}

		if (typeof opts.timeout === 'number' && opts.timeout > 0) {
			setTimeout(() => {
				if (_pending.has(id)) {
					_pending.get(id).reject(new Error('worker-timeout'));
					_pending.delete(id);
				}
			}, opts.timeout);
		}
	});
}

export function disposeWorker() {
	try {
		if (_worker) {
			try { _worker.terminate(); } catch (_) { }
			_worker = null;
		}
	} finally {
		for (const [id, p] of _pending.entries()) {
			try { p.reject(new Error('worker-disposed')); } catch (_) { }
			_pending.delete(id);
		}
	}
}
