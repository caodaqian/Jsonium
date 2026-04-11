#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

// Usage: node scripts/perf/recordHeap.js [url] [outDir]
const url = process.argv[2] || 'http://localhost:4000';
const outDir = process.argv[3] || 'perf-output';
const cycles = parseInt(process.env.PERF_CYCLES || '1', 10);
const tabsPerCycle = parseInt(process.env.PERF_TABS || '200', 10);
const sizeKB = parseInt(process.env.PERF_TAB_SIZE_KB || '0', 10);

async function ensureDir(d) {
	await fs.promises.mkdir(d, { recursive: true });
}

async function takeHeapSnapshot(page, filename) {
	const client = await page.target().createCDPSession();
	await client.send('HeapProfiler.enable');
	const chunks = [];
	client.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => chunks.push(chunk));
	await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
	await client.send('HeapProfiler.disable');
	fs.writeFileSync(filename, chunks.join(''), 'utf8');
}

(async () => {
	console.log('Launching browser...');
	await ensureDir(outDir);
	const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
	const page = await browser.newPage();
	console.log('Navigating to', url);
	await page.goto(url, { waitUntil: 'networkidle2', timeout: 0 });
	console.log('Waiting for app UI');
	await page.waitForSelector('.tab-new', { timeout: 60000 });

	const canUseStore = await page.evaluate(() => !!(window.__jsonium_addTabs));
	console.log('dev store helper available:', canUseStore);

	for (let c = 0; c < cycles; c++) {
		console.log(`Cycle ${c + 1}/${cycles}: creating ${tabsPerCycle} tabs (sizeKB=${sizeKB})`);
		if (canUseStore) {
			await page.evaluate((n, sizeKB) => window.__jsonium_addTabs(n, sizeKB), tabsPerCycle, sizeKB);
		} else {
			for (let i = 0; i < tabsPerCycle; i++) {
				await page.click('.tab-new');
				if (i % 20 === 0) await page.waitForTimeout(20);
			}
		}

		// let UI settle
		await page.waitForTimeout(500);

		const timestamp = Date.now();
		const outFile = path.join(outDir, `heap-${timestamp}-cycle${c + 1}.heapsnapshot`);
		console.log('Taking heap snapshot ->', outFile);
		await takeHeapSnapshot(page, outFile);

		// collect some runtime metrics
		try {
			const client2 = await page.target().createCDPSession();
			const metrics = await client2.send('Performance.getMetrics');
			fs.writeFileSync(path.join(outDir, `metrics-${timestamp}-cycle${c + 1}.json`), JSON.stringify(metrics, null, 2), 'utf8');
		} catch (e) {
			console.warn('collecting metrics failed', e && e.message);
		}

		// optional cleanup via exposed helper
		const canClose = await page.evaluate(() => !!(window.__jsonium_closeAllTabs));
		if (canClose) {
			await page.evaluate(() => window.__jsonium_closeAllTabs());
		}
		await page.waitForTimeout(200);
	}

	await browser.close();
	console.log('Done. Snapshots/metrics saved to', outDir);
	process.exit(0);
})().catch((err) => {
	console.error('Perf harness error:', err);
	process.exit(2);
});
