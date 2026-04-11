import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

async function run(url = 'http://localhost:4004') {
	const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	const logs = [];
	page.on('console', (m) => {
		try { logs.push({ type: 'console', text: m.text(), loc: m.location ? m.location() : null }); } catch (_) { }
	});
	page.on('pageerror', (err) => { logs.push({ type: 'pageerror', text: err.message, stack: err.stack }); });
	page.on('requestfailed', (req) => { logs.push({ type: 'requestfailed', url: req.url(), err: req.failure && req.failure().errorText }); });

	try {
		await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
	} catch (e) {
		console.error('Navigation error', e && e.message);
	}

	// wait a bit for client-side app to initialize
	await page.waitForTimeout(2000);

	const state = await page.evaluate(() => {
		try {
			const hasMonaco = typeof window !== 'undefined' && !!window.monaco;
			const monacoEnv = typeof window !== 'undefined' && !!window.MonacoEnvironment;
			const editors = Array.from(document.querySelectorAll('.monaco-editor, .editor-container, .diff-editor'))
				.map(el => ({ tag: el.tagName, class: el.className }));
			const devStore = typeof window !== 'undefined' ? (window.__jsonium_store ? true : false) : false;
			const workerErrors = typeof window !== 'undefined' ? (window.__jsonium_worker_errors || []) : [];
			return { hasMonaco, monacoEnv, editors, devStore, workerErrors };
		} catch (e) {
			return { error: (e && e.message) || String(e) };
		}
	});

	// attempt to open Diff view via dev store helper if available
	try {
		await page.evaluate(() => {
			try {
				if (window.__jsonium_store && typeof window.__jsonium_store.showDiffSidebar === 'function') {
					window.__jsonium_store.showDiffSidebar('{}');
				}
			} catch (e) { /* ignore */ }
		});
		await page.waitForTimeout(800);
	} catch (_) { }

	// capture screenshot
	const outDir = path.resolve(process.cwd(), 'perf-output');
	try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) { }
	const shotPath = path.join(outDir, `check-monaco-${Date.now()}.png`);
	try { await page.screenshot({ path: shotPath, fullPage: true }); } catch (_) { }

	// write logs
	const outLog = path.join(outDir, `check-monaco-${Date.now()}.json`);
	fs.writeFileSync(outLog, JSON.stringify({ timestamp: Date.now(), state, logs }, null, 2));

	console.log('State:', state);
	console.log('Logs written to:', outLog);
	console.log('Screenshot:', shotPath);

	await browser.close();
}

const url = process.argv[2] || 'http://localhost:4004';
run(url).catch((e) => { console.error('Error', e); process.exit(2); });
