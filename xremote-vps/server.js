import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY;
const WORKER_KEY = process.env.WORKER_KEY;
const OAUTH_TOKEN = process.env.XREMOTE_OAUTH_TOKEN;
const ALLOWED_BUTTONS = new Set(['Nexus','Menu','View','A','B','X','Y','DpadUp','DpadDown','DpadLeft','DpadRight','LeftShoulder','RightShoulder','LeftThumb','RightThumb']);
const SERVER_ID = process.env.XBOX_SERVER_ID || '';
if (!API_KEY || !WORKER_KEY || !OAUTH_TOKEN) {
  console.error('Missing API_KEY, WORKER_KEY or XREMOTE_OAUTH_TOKEN. Copy .env.example to .env and configure secrets.');
  process.exit(1);
}
const app = express();
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
let worker = null;
let workerReady = false;
let xboxConnected = false;
let lastError = null;
let lastEvent = 'Server started';
let scenarioRunning = false;
const pending = new Map();

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function auth(req, res, next) {
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!safeEqual(supplied, API_KEY)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function sendWorker(type, payload = {}, timeoutMs = 90000) {
  if (!worker || worker.readyState !== 1) throw new Error('Browser worker is not connected');
  const id = randomBytes(12).toString('hex');
  worker.send(JSON.stringify({ id, type, ...payload }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Worker response timeout')); }, timeoutMs);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
  });
}
app.get('/health', (_req, res) => res.json({ ok: true, service: 'xremote-vps', workerReady }));
app.get('/api/status', auth, (_req, res) => res.json({ workerReady, xboxConnected, lastError, lastEvent }));
app.post('/api/connect', auth, async (_req, res) => {
  try { const result = await sendWorker('connect', { oauthToken: OAUTH_TOKEN, serverId: SERVER_ID }); xboxConnected = true; lastError = null; lastEvent = 'Xbox stream connected'; res.json({ ok: true, result }); }
  catch (e) { xboxConnected = false; lastError = e.message; res.status(502).json({ error: e.message }); }
});
app.post('/api/test-presses', auth, async (_req, res) => {
  if (!xboxConnected) return res.status(409).json({ error: 'Connect Xbox first' });
  try { const result = await sendWorker('testPresses'); lastEvent = 'Two-button test completed'; res.json({ ok: true, result }); }
  catch (e) { lastError = e.message; res.status(502).json({ error: e.message }); }
});
app.post('/api/run-scenario', auth, async (req, res) => {
  if (!xboxConnected) return res.status(409).json({ error: 'Connect Xbox first' });
  if (scenarioRunning) return res.status(409).json({ error: 'A scenario is already running' });
  const steps = req.body?.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 80) {
    return res.status(400).json({ error: 'steps must contain between 1 and 80 button actions' });
  }
  let totalMs = 0;
  for (const step of steps) {
    if (!step || !ALLOWED_BUTTONS.has(step.button)) return res.status(400).json({ error: 'Unsupported button in scenario' });
    const holdMs = Number(step.holdMs ?? 140);
    const waitMs = Number(step.waitMs ?? 350);
    if (!Number.isInteger(holdMs) || holdMs < 40 || holdMs > 2000 || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > 10000) {
      return res.status(400).json({ error: 'holdMs must be 40..2000 and waitMs 0..10000' });
    }
    totalMs += holdMs + waitMs;
  }
  if (totalMs > 180000) return res.status(400).json({ error: 'Scenario duration cannot exceed 3 minutes' });
  scenarioRunning = true;
  lastEvent = 'Scenario started';
  try {
    const result = await sendWorker('runScenario', { steps }, Math.max(90000, totalMs + 30000));
    lastEvent = 'Scenario completed';
    res.json({ ok: true, result });
  } catch (e) {
    lastError = e.message;
    lastEvent = 'Scenario failed or stopped';
    res.status(502).json({ error: e.message });
  } finally { scenarioRunning = false; }
});
app.post('/api/stop-scenario', auth, async (_req, res) => {
  try {
    const result = await sendWorker('stopScenario');
    lastEvent = 'Scenario stop requested';
    res.json({ ok: true, result });
  } catch (e) { lastError = e.message; res.status(502).json({ error: e.message }); }
});
app.post('/api/disconnect', auth, async (_req, res) => {
  try { const result = await sendWorker('disconnect'); xboxConnected = false; lastEvent = 'Disconnected'; res.json({ ok: true, result }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/worker', async (_req, res) => {
  const html = await readFile(path.join(__dirname, 'dist', 'worker.html'), 'utf8');
  res.type('html').send(html.replace('__WORKER_KEY__', WORKER_KEY));
});
app.use(express.static(path.join(__dirname, 'dist'), { index: false }));
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/worker-socket' || !safeEqual(url.searchParams.get('key'), WORKER_KEY)) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
});
wss.on('connection', ws => {
  if (worker && worker.readyState === 1) worker.close();
  worker = ws; workerReady = true; lastEvent = 'Browser worker online';
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'event') { lastEvent = String(msg.message || 'Worker event').slice(0, 240); if (msg.error) lastError = String(msg.error).slice(0, 500); if (msg.connected === false) xboxConnected = false; return; }
    const p = pending.get(msg.id); if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(String(msg.error))); else p.resolve(msg.result ?? { ok: true });
  });
  ws.on('close', () => { if (worker === ws) { worker = null; workerReady = false; xboxConnected = false; lastEvent = 'Browser worker disconnected'; for (const [id,p] of pending) { p.reject(new Error('Worker disconnected')); pending.delete(id); } } });
});
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`XRemote API listening on :${PORT}`);
  try {
    const browser = await chromium.launch({
      headless: process.env.BROWSER_HEADLESS !== 'false',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
    });
    const page = await browser.newPage();
    page.on('console', message => { if (message.type() === 'error') console.error('[worker browser]', message.text()); });
    page.on('pageerror', error => { lastError = error.message; console.error('[worker browser]', error); });
    await page.goto(`http://127.0.0.1:${PORT}/worker`, { waitUntil: 'domcontentloaded' });
    console.log('Managed Chromium worker page launched');
    page.on('close', () => { workerReady = false; xboxConnected = false; lastEvent = 'Worker browser page closed'; });
  } catch (error) {
    lastError = 'Could not launch managed Chromium: ' + error.message;
    console.error(lastError);
  }
});