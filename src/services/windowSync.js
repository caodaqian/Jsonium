export const SYNC_PREFIX = 'jsonium/sync/';
export const TAB_PREFIX = `${SYNC_PREFIX}tab/`;
export const EVENT_PREFIX = `${SYNC_PREFIX}event/`;
export const INSTANCE_PREFIX = `${SYNC_PREFIX}instance/`;

export const DEFAULT_MAX_CONTENT_BYTES = 900 * 1024;
export const DEFAULT_EVENT_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_EVENTS = 500;
export const DEFAULT_TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_INSTANCE_TTL_MS = 5 * 60 * 1000;

let globalSequence = 0;

const normalizeDocs = (result) => {
	if (Array.isArray(result)) return result.filter(Boolean);
	if (Array.isArray(result?.rows)) {
		return result.rows
			.map((row) => row.doc || row.value || row)
			.filter((doc) => doc && doc._id);
	}
	return [];
};

const byteLength = (value) => {
	const text = String(value ?? '');
	if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
	return text.length;
};

const readDocsByPrefix = (db, prefix) => {
	if (!db?.allDocs) return [];
	const docs = normalizeDocs(db.allDocs(prefix));
	return docs.filter((doc) => doc._id?.startsWith(prefix));
};

const putDoc = (db, doc) => {
	if (!db?.put || !doc?._id) return { ok: false, error: 'db-unavailable' };
	const current = db.get?.(doc._id);
	const nextDoc = current?._rev ? { ...doc, _rev: current._rev } : doc;
	let result = db.put(nextDoc);
	if (result?.error && db.get) {
		const latest = db.get(doc._id);
		if (latest?._rev) result = db.put({ ...doc, _rev: latest._rev });
	}
	return result?.ok ? result : { ok: false, error: result?.message || result?.error || 'put-failed' };
};

const removeDoc = (db, doc) => {
	if (!db?.remove || !doc?._id) return false;
	const current = db.get?.(doc._id) || doc;
	const result = db.remove(current);
	return Boolean(result?.ok || result === true);
};

const createEventDoc = ({ type, tabId, sourceId, version, ts, seq }) => ({
	_id: `${EVENT_PREFIX}${ts}-${sourceId}-${seq}`,
	type,
	tabId,
	version,
	ts,
	sourceId
});

const serializeTabDoc = (tab, { sourceId, version, updatedAt, deleted = false }) => ({
	_id: `${TAB_PREFIX}${tab.id}`,
	tabId: tab.id,
	name: tab.name,
	content: tab.content,
	format: tab.format,
	isModified: tab.isModified ?? false,
	favorited: tab.favorited ?? false,
	createdAt: tab.createdAt,
	lastAccessed: tab.lastAccessed,
	version,
	updatedAt,
	sourceId,
	deleted
});

const toIsoValue = (value) => value instanceof Date ? value.toISOString() : (value ?? null);

const getStoreTabs = (store) => {
	if (Array.isArray(store?.tabs)) return store.tabs;
	if (Array.isArray(store?.tabs?.value)) return store.tabs.value;
	return [];
};

const setStoreTabs = (store, nextTabs) => {
	if (Array.isArray(store?.tabs)) {
		store.tabs = nextTabs;
		return;
	}
	if (store?.tabs && Array.isArray(store.tabs.value)) {
		store.tabs.value = nextTabs;
	}
};

const getActiveTabId = (store) => store?.activeTabId?.value ?? store?.activeTabId;

const setActiveTabId = (store, tabId) => {
	if (store?.activeTabId && typeof store.activeTabId === 'object' && 'value' in store.activeTabId) {
		store.activeTabId.value = tabId;
		return;
	}
	if (store) store.activeTabId = tabId;
};

const toSyncTab = (doc) => ({
	id: doc.tabId,
	name: doc.name,
	content: doc.content,
	format: doc.format,
	isModified: !!doc.isModified,
	favorited: !!doc.favorited,
	createdAt: doc.createdAt ? new Date(doc.createdAt) : new Date(doc.updatedAt || Date.now()),
	lastAccessed: doc.lastAccessed ? new Date(doc.lastAccessed) : (doc.createdAt ? new Date(doc.createdAt) : new Date(doc.updatedAt || Date.now())),
	__syncVersion: doc.version,
	__syncSourceId: doc.sourceId
});

const tabSignature = (tab) => JSON.stringify({
	id: tab.id,
	name: tab.name,
	content: tab.content,
	format: tab.format,
	isModified: !!tab.isModified,
	favorited: !!tab.favorited,
	createdAt: toIsoValue(tab.createdAt)
});

export const createInstanceId = () => {
	const random = Math.random().toString(36).slice(2, 10);
	return `jsonium-${Date.now().toString(36)}-${random}`;
};

export const isLargeSyncContent = (content, limitBytes = DEFAULT_MAX_CONTENT_BYTES) => byteLength(content) > limitBytes;

export const createWindowSyncStorage = ({
	db,
	now = () => Date.now(),
	maxContentBytes = DEFAULT_MAX_CONTENT_BYTES,
	eventTtlMs = DEFAULT_EVENT_TTL_MS,
	maxEvents = DEFAULT_MAX_EVENTS,
	tombstoneTtlMs = DEFAULT_TOMBSTONE_TTL_MS,
	instanceTtlMs = DEFAULT_INSTANCE_TTL_MS
} = {}) => {
	let sequence = 0;

	const appendEvent = ({ type, tabId, sourceId, version, ts = now() }) => {
		sequence += 1;
		globalSequence += 1;
		const event = createEventDoc({ type, tabId, sourceId, version, ts, seq: `${sequence}-${globalSequence}` });
		const result = putDoc(db, event);
		return result.ok ? { ok: true, event } : result;
	};

	const writeTab = (tab, { sourceId, version = now(), updatedAt = now() } = {}) => {
		if (!tab?.id) return { ok: false, reason: 'missing-tab-id' };
		if (isLargeSyncContent(tab.content, maxContentBytes)) return { ok: false, reason: 'content-too-large' };
		const tabDoc = serializeTabDoc(tab, { sourceId, version, updatedAt });
		const writeResult = putDoc(db, tabDoc);
		if (!writeResult.ok) return writeResult;
		const eventResult = appendEvent({ type: 'tab.changed', tabId: tab.id, sourceId, version, ts: updatedAt });
		return eventResult.ok ? { ok: true, tabDoc, event: eventResult.event } : eventResult;
	};

	const markTabDeleted = (tabId, { sourceId, version = now(), deletedAt = now() } = {}) => {
		if (!tabId) return { ok: false, reason: 'missing-tab-id' };
		const tabDoc = {
			_id: `${TAB_PREFIX}${tabId}`,
			tabId,
			deleted: true,
			deletedAt,
			updatedAt: deletedAt,
			version,
			sourceId
		};
		const writeResult = putDoc(db, tabDoc);
		if (!writeResult.ok) return writeResult;
		const eventResult = appendEvent({ type: 'tab.deleted', tabId, sourceId, version, ts: deletedAt });
		return eventResult.ok ? { ok: true, tabDoc, event: eventResult.event } : eventResult;
	};

	const readEvents = ({ sinceTs = 0, excludeSourceId } = {}) => readDocsByPrefix(db, EVENT_PREFIX)
		.filter((event) => Number(event.ts || 0) > sinceTs)
		.filter((event) => !excludeSourceId || event.sourceId !== excludeSourceId)
		.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

	const readTabs = () => readDocsByPrefix(db, TAB_PREFIX)
		.sort((a, b) => String(a.tabId || '').localeCompare(String(b.tabId || '')));

	const readTab = (tabId) => {
		if (!tabId || !db?.get) return null;
		return db.get(`${TAB_PREFIX}${tabId}`) || null;
	};

	const writeHeartbeat = (sourceId) => putDoc(db, {
		_id: `${INSTANCE_PREFIX}${sourceId}`,
		sourceId,
		updatedAt: now()
	});

	const prune = () => {
		const currentTime = now();
		const removed = { events: 0, tombstones: 0, instances: 0 };
		const events = readDocsByPrefix(db, EVENT_PREFIX).sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
		const eventCutoff = currentTime - eventTtlMs;
		const expiredEventIds = new Set(events.filter((event) => Number(event.ts || 0) < eventCutoff).map((event) => event._id));
		const remainingEvents = events.filter((event) => !expiredEventIds.has(event._id));
		remainingEvents.slice(0, Math.max(0, remainingEvents.length - maxEvents)).forEach((event) => expiredEventIds.add(event._id));
		expiredEventIds.forEach((id) => {
			if (removeDoc(db, { _id: id })) removed.events += 1;
		});

		const tombstoneCutoff = currentTime - tombstoneTtlMs;
		readDocsByPrefix(db, TAB_PREFIX)
			.filter((doc) => doc.deleted && Number(doc.deletedAt || doc.updatedAt || 0) < tombstoneCutoff)
			.forEach((doc) => {
				if (removeDoc(db, doc)) removed.tombstones += 1;
			});

		const instanceCutoff = currentTime - instanceTtlMs;
		readDocsByPrefix(db, INSTANCE_PREFIX)
			.filter((doc) => Number(doc.updatedAt || 0) < instanceCutoff)
			.forEach((doc) => {
				if (removeDoc(db, doc)) removed.instances += 1;
			});

		return removed;
	};

	return {
		appendEvent,
		markTabDeleted,
		prune,
		readEvents,
		readTab,
		readTabs,
		writeHeartbeat,
		writeTab
	};
};

export const startWindowSync = (store, {
	db,
	instanceId = createInstanceId(),
	now = () => Date.now(),
	autoStart = true,
	pollIntervalMs = 1000,
	heartbeatIntervalMs = 30 * 1000,
	pruneIntervalMs = 5 * 60 * 1000,
	storage = createWindowSyncStorage({ db, now })
} = {}) => {
	const signatures = new Map();
	let initialized = false;
	let lastEventTs = 0;
	let applyingRemote = false;
	const timers = [];

	const rememberTab = (tab) => {
		signatures.set(String(tab.id), tabSignature(tab));
	};

	const applyRemoteTabDoc = (doc) => {
		if (!doc?.tabId || doc.sourceId === instanceId) return false;
		const tabs = getStoreTabs(store);
		const tabId = String(doc.tabId);
		const index = tabs.findIndex((tab) => String(tab.id) === tabId);
		const existing = index >= 0 ? tabs[index] : null;
		const existingVersion = Number(existing?.__syncVersion || 0);
		const remoteVersion = Number(doc.version || doc.updatedAt || 0);
		if (existing && existingVersion > remoteVersion) return false;

		if (doc.deleted) {
			if (index < 0) return false;
			const nextTabs = tabs.filter((tab) => String(tab.id) !== tabId);
			setStoreTabs(store, nextTabs);
			signatures.delete(tabId);
			if (String(getActiveTabId(store)) === tabId) {
				setActiveTabId(store, nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].id : null);
			}
			return true;
		}

		const remoteTab = toSyncTab(doc);
		if (index >= 0) {
			Object.assign(tabs[index], remoteTab);
			rememberTab(tabs[index]);
		} else {
			tabs.push(remoteTab);
			rememberTab(remoteTab);
		}
		return true;
	};

	const publishLocalTabs = () => {
		if (applyingRemote) return { changed: 0, deleted: 0 };
		const tabs = getStoreTabs(store);
		const currentIds = new Set(tabs.map((tab) => String(tab.id)));
		let changed = 0;
		let deleted = 0;

		tabs.forEach((tab) => {
			if (!tab?.id) return;
			const key = String(tab.id);
			const signature = tabSignature(tab);
			if (signatures.get(key) === signature) return;
			const version = now();
			const result = storage.writeTab(tab, { sourceId: instanceId, version, updatedAt: version });
			if (result.ok) {
				tab.__syncVersion = version;
				tab.__syncSourceId = instanceId;
				signatures.set(key, signature);
				changed += 1;
			}
		});

		if (initialized) {
			[...signatures.keys()].forEach((tabId) => {
				if (currentIds.has(tabId)) return;
				const version = now();
				const result = storage.markTabDeleted(tabId, { sourceId: instanceId, version, deletedAt: version });
				if (result.ok) {
					signatures.delete(tabId);
					deleted += 1;
				}
			});
		}
		initialized = true;
		return { changed, deleted };
	};

	const pollOnce = () => {
		const events = storage.readEvents({ sinceTs: lastEventTs, excludeSourceId: instanceId });
		if (events.length === 0) return { applied: 0 };
		let applied = 0;
		applyingRemote = true;
		try {
			events.forEach((event) => {
				lastEventTs = Math.max(lastEventTs, Number(event.ts || 0));
				const doc = storage.readTab(event.tabId);
				if (doc && applyRemoteTabDoc(doc)) applied += 1;
			});
		} finally {
			applyingRemote = false;
		}
		return { applied };
	};

	const stop = () => {
		timers.splice(0).forEach((timer) => clearInterval(timer));
	};

	if (autoStart && db) {
		try { storage.writeHeartbeat(instanceId); } catch (_) { /* ignore */ }
		timers.push(setInterval(() => { try { pollOnce(); } catch (_) { /* ignore */ } }, pollIntervalMs));
		timers.push(setInterval(() => { try { storage.writeHeartbeat(instanceId); } catch (_) { /* ignore */ } }, heartbeatIntervalMs));
		timers.push(setInterval(() => { try { storage.prune(); } catch (_) { /* ignore */ } }, pruneIntervalMs));
		try {
			if (typeof window !== 'undefined' && window.utools && typeof window.utools.onDbPull === 'function') {
				window.utools.onDbPull((docs) => {
					const hasSyncDocs = Array.isArray(docs) && docs.some((doc) => doc?._id?.startsWith(SYNC_PREFIX));
					if (hasSyncDocs) pollOnce();
				});
			}
		} catch (_) { /* ignore */ }
	}

	return {
		applyRemoteTabDoc,
		instanceId,
		pollOnce,
		publishLocalTabs,
		stop
	};
};
