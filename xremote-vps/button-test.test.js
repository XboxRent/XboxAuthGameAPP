import test from 'node:test';
import assert from 'node:assert/strict';
import { runTwoTapTest } from './button-test.js';

test('two-button test presses right then left and releases each button', async () => {
  const events = [];
  const gamepad = {
    pressButton: (index, button) => events.push(['press', index, button]),
    releaseButton: (index, button) => events.push(['release', index, button])
  };
  const result = await runTwoTapTest(gamepad, { DpadRight: 2048, DpadLeft: 1024 }, async () => {});
  assert.deepEqual(events, [
    ['press', 0, 2048], ['release', 0, 2048],
    ['press', 0, 1024], ['release', 0, 1024]
  ]);
  assert.deepEqual(result.sent, ['DpadRight', 'DpadLeft']);
});

test('button is released even if hold wait fails', async () => {
  const events = [];
  const gamepad = {
    pressButton: (_index, button) => events.push(['press', button]),
    releaseButton: (_index, button) => events.push(['release', button])
  };
  await assert.rejects(() => runTwoTapTest(gamepad, { DpadRight: 2048, DpadLeft: 1024 }, async ms => {
    if (ms === 180) throw new Error('simulated wait failure');
  }), /simulated wait failure/);
  assert.deepEqual(events, [['press', 2048], ['release', 2048]]);
});
