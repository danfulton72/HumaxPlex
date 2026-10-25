// Dev builds only: long-poll the devserver for key presses / snippets to run,
// so the app can be driven and inspected from the Mac.
import { DEV_HOST } from '../config.js';
import { inject } from '../input.js';
import { log, error } from '../util/log.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(cmd) {
  if (cmd.keys) {
    for (const k of cmd.keys) {
      inject(k);
      await sleep(cmd.gap || 150);
    }
  }
  if (cmd.eval) {
    try {
      let result = (0, eval)(cmd.eval);
      if (result && typeof result.then === 'function') result = await result;
      log('eval →', result);
    } catch (e) {
      error('eval failed', e);
    }
  }
}

export async function startDevRemote() {
  for (;;) {
    try {
      const res = await fetch('http://' + DEV_HOST + '/cmd');
      const cmds = await res.json();
      for (const c of cmds) await run(c);
    } catch (e) {
      await sleep(3000);
    }
  }
}

// __bench(['right', ...], gapMs) → frame stats while those keys are replayed.
window.__bench = async function (keys, gap) {
  const deltas = [];
  let last = performance.now();
  let running = true;
  const tick = now => { deltas.push(now - last); last = now; if (running) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  for (const k of keys) { inject(k); await sleep(gap || 200); }
  await sleep(600);
  running = false;
  const total = deltas.reduce((a, b) => a + b, 0);
  deltas.sort((a, b) => a - b);
  return 'fps=' + Math.round(deltas.length * 1000 / total) + ' p50=' + deltas[deltas.length >> 1].toFixed(0) +
    ' p95=' + deltas[Math.floor(deltas.length * 0.95)].toFixed(0) + ' max=' + deltas[deltas.length - 1].toFixed(0);
};

// __css('selector { ... }') injects a style override for A/B experiments.
window.__css = function (text) {
  let el = document.getElementById('dev-css');
  if (!el) { el = document.createElement('style'); el.id = 'dev-css'; document.head.appendChild(el); }
  el.textContent = text;
  return 'css set';
};
