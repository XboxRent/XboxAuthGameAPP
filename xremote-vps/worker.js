import { Client, Buttons } from '@yowari/xremote';
import { runTwoTapTest } from './button-test.js';

const stateEl = document.querySelector('#state');
const logEl = document.querySelector('#log');
let socket, client = null, gamepad = null, streamStarted = false;
let activeScenarioController = null;
const buttonNames = ['Nexus','Menu','View','A','B','X','Y','DpadUp','DpadDown','DpadLeft','DpadRight','LeftShoulder','RightShoulder','LeftThumb','RightThumb'];
function log(message) {
  const line = new Date().toISOString() + ' ' + message;
  logEl.textContent = (line + '\n' + logEl.textContent).slice(0, 12000);
}
function status(message, extra = {}) {
  stateEl.textContent = message;
  log(message);
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:'event', message, ...extra }));
}
function reply(id, result, error) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id, result, error: error?.message }));
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('Scenario stopped'));
  const timer = setTimeout(done, ms);
  function done() { signal?.removeEventListener('abort', abort); resolve(); }
  function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Scenario stopped')); }
  signal?.addEventListener('abort', abort, { once:true });
});
function releaseAll() {
  if (!gamepad) return;
  for (const name of buttonNames) {
    try { gamepad.releaseButton(0, Buttons[name]); } catch {}
  }
}
async function connect({ oauthToken, serverId }) {
  if (streamStarted) return { connected: true, reused: true };
  status('Signing in to Xbox…');
  client = new Client();
  await client.login(oauthToken);
  const consoles = await client.getConsoles();
  const list = consoles?.results || [];
  if (!list.length) throw new Error('No consoles returned for this Xbox account');
  const selected = serverId ? list.find(c => c.serverId === serverId) : list[0];
  if (!selected) throw new Error('Configured XBOX_SERVER_ID was not found in this account');
  status('Creating Remote Play session…');
  const session = await client.createSession(selected.serverId);
  status('Starting WebRTC stream…');
  await client.startStream(session.sessionId);
  gamepad = client.getGamepadManager();
  streamStarted = true;
  status('Xbox stream connected', { connected: true });
  return { connected: true, consoleName: selected.name || 'Xbox console' };
}
async function testPresses() {
  if (!gamepad || !streamStarted) throw new Error('Xbox stream is not connected');
  return runTwoTapTest(gamepad, Buttons);
}
async function runScenario(steps) {
  if (!gamepad || !streamStarted) throw new Error('Xbox stream is not connected');
  if (activeScenarioController) throw new Error('A scenario is already running');
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 80) throw new Error('Invalid scenario length');
  const controller = new AbortController();
  activeScenarioController = controller;
  const sent = [];
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step || !buttonNames.includes(step.button)) throw new Error('Unsupported button in step ' + (i + 1));
      const holdMs = Number(step.holdMs ?? 140);
      const waitMs = Number(step.waitMs ?? 350);
      if (!Number.isInteger(holdMs) || holdMs < 40 || holdMs > 2000 || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > 10000) {
        throw new Error('Invalid timing in step ' + (i + 1));
      }
      if (controller.signal.aborted) throw new Error('Scenario stopped');
      const button = Buttons[step.button];
      status('Scenario: step ' + (i + 1) + '/' + steps.length + ' — ' + step.button);
      gamepad.pressButton(0, button);
      try { await sleep(holdMs, controller.signal); }
      finally { gamepad.releaseButton(0, button); }
      sent.push(step.button);
      if (waitMs) await sleep(waitMs, controller.signal);
    }
    status('Scenario completed', { scenarioCompleted:true });
    return { completed:true, count:sent.length, sent };
  } finally {
    releaseAll();
    activeScenarioController = null;
  }
}
async function stopScenario() {
  if (activeScenarioController) {
    activeScenarioController.abort();
    releaseAll();
    status('Scenario stop requested');
  }
  return { stopped:true };
}
async function disconnect() {
  if (activeScenarioController) activeScenarioController.abort();
  releaseAll();
  try { if (client) client.stopStream(); }
  finally { client = null; gamepad = null; streamStarted = false; status('Xbox stream disconnected', { connected:false }); }
  return { connected:false };
}
async function handle(msg) {
  try {
    let result;
    if (msg.type === 'connect') result = await connect(msg);
    else if (msg.type === 'testPresses') result = await testPresses();
    else if (msg.type === 'runScenario') result = await runScenario(msg.steps);
    else if (msg.type === 'stopScenario') result = await stopScenario();
    else if (msg.type === 'disconnect') result = await disconnect();
    else throw new Error('Unknown worker command');
    reply(msg.id, result);
  } catch (error) {
    status('Worker error: ' + error.message, { error:error.message });
    reply(msg.id, null, error);
  }
}
function openSocket() {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${scheme}//${location.host}/worker-socket?key=${encodeURIComponent(window.WORKER_KEY)}`);
  socket.onopen = () => status('Worker connected to API');
  socket.onmessage = event => { try { handle(JSON.parse(event.data)); } catch (e) { status('Invalid command: ' + e.message); } };
  socket.onclose = () => { status('API connection lost'); setTimeout(openSocket, 2500); };
  socket.onerror = () => status('WebSocket connection error');
}
openSocket();
