#!/usr/bin/env node
/**
 * Simple heap snapshot diff tool.
 * Usage: node scripts/perf/diffHeaps.js <snapshotA.heapsnapshot> <snapshotB.heapsnapshot> [outDir]
 * Produces perf-output/heap-diff-report.json and .csv with top growth items.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function readSnapshot(file) {
	const raw = fs.readFileSync(file, 'utf8');
	return JSON.parse(raw);
}

function analyze(snapshot) {
	const meta = snapshot.snapshot && snapshot.snapshot.meta;
	const nodes = snapshot.nodes || [];
	const strings = snapshot.strings || [];
	const fields = (meta && meta.node_fields) || [];
	const typesMeta = (meta && meta.node_types) || [];
	const fieldCount = fields.length || 0;

	const nameIdx = fields.indexOf('name');
	const typeIdx = fields.indexOf('type');
	const selfSizeIdx = fields.indexOf('self_size');

	const byName = new Map();
	const byType = new Map();
	let totalNodes = 0;
	let totalSize = 0;

	for (let i = 0; i + fieldCount - 1 < nodes.length; i += fieldCount) {
		totalNodes++;
		const typeVal = (typeIdx >= 0) ? nodes[i + typeIdx] : 0;
		const nameVal = (nameIdx >= 0) ? nodes[i + nameIdx] : 0;
		const selfSize = (selfSizeIdx >= 0) ? nodes[i + selfSizeIdx] : 0;
		const name = strings[nameVal] || String(nameVal);
		const typeName = (typesMeta && typesMeta[typeIdx] && typesMeta[typeIdx][typeVal]) ? typesMeta[typeIdx][typeVal] : String(typeVal);

		totalSize += Number(selfSize || 0);

		const key = `${typeName}:${name}`;
		const prev = byName.get(key) || { count: 0, selfSize: 0 };
		prev.count += 1;
		prev.selfSize += Number(selfSize || 0);
		byName.set(key, prev);

		const prevT = byType.get(typeName) || { count: 0, selfSize: 0 };
		prevT.count += 1;
		prevT.selfSize += Number(selfSize || 0);
		byType.set(typeName, prevT);
	}

	return { totalNodes, totalSize, byName, byType };
}

function mapToArray(map) {
	const arr = [];
	for (const [k, v] of map.entries()) arr.push({ key: k, count: v.count, selfSize: v.selfSize });
	return arr;
}

function main() {
	const args = process.argv.slice(2);
	if (args.length < 2) {
		console.error('Usage: diffHeaps.js <snapshotA.heapsnapshot> <snapshotB.heapsnapshot> [outDir]');
		process.exit(2);
	}
	const aPath = path.resolve(args[0]);
	const bPath = path.resolve(args[1]);
	const outDir = path.resolve(args[2] || path.dirname(aPath) || 'perf-output');
	if (!fs.existsSync(aPath) || !fs.existsSync(bPath)) {
		console.error('Snapshot files not found');
		process.exit(2);
	}

	const a = readSnapshot(aPath);
	const b = readSnapshot(bPath);

	console.log('Analyzing snapshots (may take a moment)...');
	const aa = analyze(a);
	const bb = analyze(b);

	const allKeys = new Set([...aa.byName.keys(), ...bb.byName.keys()]);
	const diffs = [];
	for (const k of allKeys) {
		const av = aa.byName.get(k) || { count: 0, selfSize: 0 };
		const bv = bb.byName.get(k) || { count: 0, selfSize: 0 };
		const delta = (bv.selfSize || 0) - (av.selfSize || 0);
		if (delta !== 0) diffs.push({ key: k, before: av.selfSize || 0, after: bv.selfSize || 0, delta, beforeCount: av.count || 0, afterCount: bv.count || 0 });
	}

	diffs.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

	// ensure outDir
	try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) { }
	const outJson = path.join(outDir, `heap-diff-report-${Date.now()}.json`);
	const outCsv = path.join(outDir, `heap-diff-report-${Date.now()}.csv`);

	fs.writeFileSync(outJson, JSON.stringify({ summary: { a: { totalNodes: aa.totalNodes, totalSize: aa.totalSize }, b: { totalNodes: bb.totalNodes, totalSize: bb.totalSize } }, diffs }, null, 2));

	const csvLines = ['key,before,after,delta,beforeCount,afterCount'];
	for (const d of diffs) csvLines.push(`${JSON.stringify(d.key)},${d.before},${d.after},${d.delta},${d.beforeCount},${d.afterCount}`);
	fs.writeFileSync(outCsv, csvLines.join('\n'));

	console.log('Wrote:', outJson);
	console.log('Wrote:', outCsv);
	console.log('Top changes:');
	diffs.slice(0, 30).forEach((d, i) => {
		console.log(`${i + 1}. ${d.key}  delta=${d.delta}  before=${d.before} after=${d.after}  counts=${d.beforeCount}->${d.afterCount}`);
	});
}

const entryPoint = fileURLToPath(import.meta.url);
if (process.argv[1] === entryPoint) main();
