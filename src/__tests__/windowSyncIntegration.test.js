import { describe, expect, it, vi } from 'vitest';
import { EVENT_PREFIX, TAB_PREFIX, startWindowSync } from '../services/windowSync.js';

function createFakeDb(initialDocs = []) {
	const docs = new Map(initialDocs.map((doc) => [doc._id, { ...doc }]));
	let rev = 1;
	return {
		docs,
		get: vi.fn((id) => docs.get(id) ? { ...docs.get(id) } : null),
		put: vi.fn((doc) => {
			const next = { ...doc, _rev: String(rev++) };
			docs.set(doc._id, next);
			return { ok: true, id: doc._id, rev: next._rev };
		}),
		remove: vi.fn((docOrId) => {
			const id = typeof docOrId === 'string' ? docOrId : docOrId?._id;
			docs.delete(id);
			return { ok: true, id };
		}),
		allDocs: vi.fn((prefix) => [...docs.values()].filter((doc) => doc._id.startsWith(prefix)).map((doc) => ({ ...doc })))
	};
}

const makeTab = (id, content = '{}') => ({
	id,
	name: `tab-${id}`,
	content,
	format: 'json',
	isModified: false,
	favorited: false,
	createdAt: new Date('2026-07-07T00:00:00.000Z'),
	lastAccessed: new Date('2026-07-07T00:00:00.000Z')
});

describe('window sync integration', () => {
	it('publishes changed tabs but ignores active tab only changes', () => {
		const db = createFakeDb();
		let currentTime = 1000;
		const store = { tabs: [makeTab('a'), makeTab('b')], activeTabId: 'a' };
		const sync = startWindowSync(store, { db, instanceId: 'self', now: () => currentTime, autoStart: false });

		sync.publishLocalTabs();
		expect(db.allDocs(EVENT_PREFIX)).toHaveLength(2);

		currentTime = 2000;
		store.activeTabId = 'b';
		store.tabs[1].lastAccessed = new Date('2026-07-07T00:01:00.000Z');
		sync.publishLocalTabs();

		expect(db.allDocs(EVENT_PREFIX)).toHaveLength(2);
	});

	it('applies remote tab changes without changing the local active tab', () => {
		const db = createFakeDb([
			{
				_id: `${TAB_PREFIX}remote`,
				tabId: 'remote',
				name: 'remote.json',
				content: '{"remote":true}',
				format: 'json',
				version: 1500,
				updatedAt: 1500,
				sourceId: 'other'
			},
			{ _id: `${EVENT_PREFIX}1500-other-1`, type: 'tab.changed', tabId: 'remote', ts: 1500, version: 1500, sourceId: 'other' }
		]);
		const store = { tabs: [makeTab('local')], activeTabId: 'local' };
		const sync = startWindowSync(store, { db, instanceId: 'self', now: () => 2000, autoStart: false });

		sync.pollOnce();

		expect(store.tabs.map((tab) => tab.id)).toEqual(['local', 'remote']);
		expect(store.tabs[1].content).toBe('{"remote":true}');
		expect(store.activeTabId).toBe('local');
	});

	it('applies remote delete events without removing unrelated local tabs', () => {
		const db = createFakeDb([
			{ _id: `${TAB_PREFIX}remote`, tabId: 'remote', deleted: true, deletedAt: 1500, updatedAt: 1500, version: 1500, sourceId: 'other' },
			{ _id: `${EVENT_PREFIX}1500-other-1`, type: 'tab.deleted', tabId: 'remote', ts: 1500, version: 1500, sourceId: 'other' }
		]);
		const store = { tabs: [makeTab('local'), makeTab('remote')], activeTabId: 'local' };
		const sync = startWindowSync(store, { db, instanceId: 'self', now: () => 2000, autoStart: false });

		sync.pollOnce();

		expect(store.tabs.map((tab) => tab.id)).toEqual(['local']);
		expect(store.activeTabId).toBe('local');
	});
});
