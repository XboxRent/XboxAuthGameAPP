export async function tapButton(gamepad, button, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  gamepad.pressButton(0, button);
  try {
    await wait(180);
  } finally {
    gamepad.releaseButton(0, button);
  }
  await wait(350);
}

export async function runTwoTapTest(gamepad, buttons, wait) {
  await tapButton(gamepad, buttons.DpadRight, wait);
  await tapButton(gamepad, buttons.DpadLeft, wait);
  return {
    sent: ['DpadRight', 'DpadLeft'],
    note: 'Both buttons released after each tap'
  };
}
