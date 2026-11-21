import { Client, Buttons } from '@yowari/xremote';

const stateEl = document.querySelector('#state');
const logEl = document.querySelector('#log');
let socket, client = null, gamepad = null, streamStarted = false;
function log(message) { const line = new Date().toISOString() + ' ' + message; logEl.textContent = (line + '\n' + logEl.textContent).slice(0, 12000); }
function status(message, extra = {}) { stateEl.textContent = message; log(message); if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type:'event', message, ...extra })); }
function reply(id, result, error) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id, result, error: error?.message })); }
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
async function tap(button) {
  if (!gamepad || !streamStarted) throw new Error('Xbox stream is not connected');
  gamepad.pressButton(0, button);
  await new Promise(resolve => setTimeout(resolve, 180));
  gamepad.releaseButton(0, button);
  await new Promise(resolve => setTimeout(resolve, 350));
}
async function testPresses() {
  // Harmless navigation-only inputs; no confirm/purchase button.
  await tap(Buttons.DpadRight);
  await tap(Buttons.DpadLeft);
  return { sent: ['DpadRight', 'DpadLeft'], durationMs: 710, note: 'Both buttons released after each tap' };
}
async function disconnect() {
  try { if (gamepad) { for (const b of [Buttons.DpadRight, Buttons.DpadLeft, Buttons.A, Buttons.B, Buttons.Nexus, Buttons.Menu, Buttons.View]) gamepad.releaseButton(0, b); } }
  finally { if (client) client.stopStream(); client = null; gamepad = null; streamStarted = false; status('Xbox stream disconnected', { connected: false }); }
  return { connected: false };
}
async function handle(msg) {
  try {
    let result;
    if (msg.type === 'connect') result = await connect(msg);
    else if (msg.type === 'testPresses') result = await testPresses();
    else if (msg.type === 'disconnect') result = await disconnect();
    else throw new Error('Unknown worker command');
    reply(msg.id, result);
  } catch (error) { status('Worker error: ' + error.message, { error: error.message }); reply(msg.id, null, error); }
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