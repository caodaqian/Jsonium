import { describe, expect, it, vi } from 'vitest';
import {
	EVENT_PREFIX,
	INSTANCE_PREFIX,
	TAB_PREFIX,
	createWindowSyncStorage,
	isLargeSyncContent
} from '../services/windowSync.js';

function createFakeDb(initialDocs = []) {
	const docs = new Map(initialDocs.map((doc) => [doc._id, { ...doc }]));
	let rev = 1;
	return {
		docs,
		get: vi.fn((id) => docs.get(id) ? { ...docs.get(id) } : null),
		put: vi.fn((doc) => {
			if (!doc || !doc._id) return { error: true, message: 'missing id' };
			const next = { ...doc, _rev: String(rev++) };
			docs.set(doc._id, next);
			return { ok: true, id: doc._id, rev: next._rev };
		}),
		remove: vi.fn((docOrId) => {
			const id = typeof docOrId === 'string' ? docOrId : docOrId?._id;
			if (!id) return { error: true, message: 'missing id' };
			docs.delete(id);
			return { ok: true, id };
		}),
		allDocs: vi.fn((prefix) => {
			const all = [...docs.values()].map((doc) => ({ ...doc }));
			if (!prefix) return all;
			return all.filter((doc) => doc._id.startsWith(prefix));
		})
	};
}

describe('windowSync storage', () => {
	it('writes tab docs without placing large content in the event doc', () => {
		const db = createFakeDb();
		const storage = createWindowSyncStorage({ db, now: () => 1000 });
		const tab = {
			id: 'tab-1',
			name: 'data.json',
			content: '{"ok":true}',
			format: 'json',
			favorited: false,
			createdAt: '2026-07-07T00:00:00.000Z',
			lastAccessed: '2026-07-07T00:00:00.000Z'
		};

		const result = storage.writeTab(tab, { sourceId: 'instance-a', version: 3 });

		expect(result.ok).toBe(true);
		const tabDoc = db.docs.get(`${TAB_PREFIX}tab-1`);
		expect(tabDoc.content).toBe('{"ok":true}');
		expect(tabDoc.version).toBe(3);
		expect(tabDoc.sourceId).toBe('instance-a');
		const events = [...db.docs.values()].filter((doc) => doc._id.startsWith(EVENT_PREFIX));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ type: 'tab.changed', tabId: 'tab-1', version: 3, sourceId: 'instance-a' });
		expect(events[0].content).toBeUndefined();
	});

	it('skips realtime tab writes when content is over the sync size limit', () => {
		const db = createFakeDb();
		const storage = createWindowSyncStorage({ db, maxContentBytes: 10, now: () => 1000 });

		const result = storage.writeTab({ id: 'big', name: 'big', content: 'x'.repeat(11), format: 'json' }, { sourceId: 'instance-a' });

		expect(result.ok).toBe(false);
		expect(result.reason).toBe('content-too-large');
		expect(db.allDocs(TAB_PREFIX)).toHaveLength(0);
		expect(db.allDocs(EVENT_PREFIX)).toHaveLength(0);
	});

	it('reads events sorted by timestamp and ignores events from the same instance', () => {
		const db = createFakeDb([
			{ _id: `${EVENT_PREFIX}300-b`, type: 'tab.changed', tabId: 'b', ts: 300, sourceId: 'other' },
			{ _id: `${EVENT_PREFIX}100-a`, type: 'tab.changed', tabId: 'a', ts: 100, sourceId: 'self' },
			{ _id: `${EVENT_PREFIX}200-c`, type: 'tab.changed', tabId: 'c', ts: 200, sourceId: 'other' }
		]);
		const storage = createWindowSyncStorage({ db });

		const events = storage.readEvents({ sinceTs: 150, excludeSourceId: 'self' });

		expect(events.map((event) => event.tabId)).toEqual(['c', 'b']);
	});

	it('prunes old events, limits total event count, stale tombstones and old heartbeats', () => {
		const db = createFakeDb([
			{ _id: `${EVENT_PREFIX}1`, ts: 1, sourceId: 'a' },
			{ _id: `${EVENT_PREFIX}2`, ts: 2, sourceId: 'a' },
			{ _id: `${EVENT_PREFIX}3`, ts: 3, sourceId: 'a' },
			{ _id: `${TAB_PREFIX}deleted-old`, tabId: 'deleted-old', deleted: true, deletedAt: 100 },
			{ _id: `${TAB_PREFIX}deleted-new`, tabId: 'deleted-new', deleted: true, deletedAt: 900 },
			{ _id: `${INSTANCE_PREFIX}old`, updatedAt: 100 },
			{ _id: `${INSTANCE_PREFIX}new`, updatedAt: 950 }
		]);
		const storage = createWindowSyncStorage({
			db,
			now: () => 1000,
			eventTtlMs: 998,
			maxEvents: 1,
			tombstoneTtlMs: 500,
			instanceTtlMs: 500
		});

		const removed = storage.prune();

		expect(removed).toEqual(expect.objectContaining({ events: 2, tombstones: 1, instances: 1 }));
		expect(db.docs.has(`${EVENT_PREFIX}1`)).toBe(false);
		expect(db.docs.has(`${EVENT_PREFIX}2`)).toBe(false);
		expect(db.docs.has(`${EVENT_PREFIX}3`)).toBe(true);
		expect(db.docs.has(`${TAB_PREFIX}deleted-old`)).toBe(false);
		expect(db.docs.has(`${TAB_PREFIX}deleted-new`)).toBe(true);
		expect(db.docs.has(`${INSTANCE_PREFIX}old`)).toBe(false);
		expect(db.docs.has(`${INSTANCE_PREFIX}new`)).toBe(true);
	});

	it('detects content byte size using UTF-8 length', () => {
		expect(isLargeSyncContent('12345', 5)).toBe(false);
		expect(isLargeSyncContent('123456', 5)).toBe(true);
		expect(isLargeSyncContent('中文', 5)).toBe(true);
	});
});
