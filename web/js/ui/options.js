// Shared options list ("hold OK" / Menu) and toast messages.
//
// showOptions({ title, subtitle, items: [{ label, run, checked, note }] })
// opens a modal list over the current screen. While it is open the router
// sends every key here first (see router.js), so screens need no extra state.
import { h } from '../util/dom.js';

let overlay = null;
let state = null;

function root() {
  return document.getElementById('app') || document.body;
}

function build() {
  overlay = h('div', 'hx-dialog ep-options', root());
  const box = h('div', 'hx-dlg hx-menu', overlay);
  overlay._eyebrow = h('div', 'hx-dlg-eyebrow', box);
  overlay._title = h('h2', 'hx-dlg-title ep-options-title', box);
  overlay._sub = h('div', 'hx-dlg-sub', box);
  overlay._list = h('div', 'hx-menu-list', box);
  h('div', 'hx-dlg-hint', box).textContent = '▲▼ choose · OK select · Back close';
}

function render() {
  if (!overlay) build();
  if (!overlay.parentNode) root().appendChild(overlay);
  overlay.style.display = '';
  overlay._eyebrow.textContent = state.eyebrow || 'OPTIONS';
  overlay._title.textContent = state.title || '';
  overlay._title.style.display = state.title ? '' : 'none';
  overlay._sub.textContent = state.subtitle || '';
  overlay._sub.style.display = state.subtitle ? '' : 'none';
  overlay._list.textContent = '';
  const first = Math.max(0, Math.min(state.index - 3, state.items.length - 7));
  state.items.slice(first, first + 7).forEach((it, i) => {
    const row = h('div', 'hx-btn hx-menu-item' + (first + i === state.index ? ' focus' : ''), overlay._list);
    row.textContent = (it.checked ? '✓  ' : '') + it.label;
    if (it.note) h('span', 'ep-options-note', row).textContent = it.note;
  });
}

export function showOptions(opts) {
  const items = (opts.items || []).filter(Boolean);
  if (!items.length) return;
  state = Object.assign({}, opts, { items, index: Math.max(0, items.findIndex(i => i.checked)) });
  if (opts.focus != null) state.index = opts.focus;
  render();
}

export function optionsOpen() {
  return !!state;
}

export function closeOptions() {
  state = null;
  if (overlay) overlay.style.display = 'none';
}

export function optionsKey(action) {
  if (!state) return false;
  switch (action) {
    case 'up': state.index = Math.max(0, state.index - 1); render(); return true;
    case 'down': state.index = Math.min(state.items.length - 1, state.index + 1); render(); return true;
    case 'enter': {
      const it = state.items[state.index];
      closeOptions();
      if (it && it.run) it.run();
      return true;
    }
    case 'back': case 'menu': closeOptions(); return true;
    default: return true;
  }
}

// Short message at the bottom of the screen that clears itself.
let toastEl = null, toastTimer = 0;
export function toast(text, ms = 3000) {
  if (!toastEl) toastEl = h('div', 'ep-toast', root());
  if (!toastEl.parentNode) root().appendChild(toastEl);
  toastEl.textContent = text;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
}
