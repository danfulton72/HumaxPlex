// A browser-like global environment (jsdom) so the real web/js modules can be
// imported and driven from Node. Call setupDom() before importing app code.
import { JSDOM } from 'jsdom';

export function setupDom() {
  // Guide dates are local-time; pin the zone so BST/GMT edge cases are stable.
  process.env.TZ = 'Europe/London';
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
  const w = dom.window;
  for (const k of ['window', 'document', 'localStorage', 'navigator', 'CustomEvent', 'Event', 'DOMParser', 'HTMLElement', 'Image']) {
    Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k], configurable: true, writable: true });
  }
  // jsdom has no canvas; the backdrop's gradient painting just needs a 2D
  // context that accepts calls.
  w.HTMLCanvasElement.prototype.getContext = function () {
    const noop = () => {};
    return new Proxy({
      createImageData: (cw, ch) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
      getImageData: (x, y, cw, ch) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
    }, { get: (t, k) => (k in t ? t[k] : noop), set: () => true });
  };
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
  globalThis.requestAnimationFrame = cb => setTimeout(cb, 16);
  w.requestAnimationFrame = globalThis.requestAnimationFrame;
  return w;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
