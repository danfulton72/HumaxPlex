// Screen stack. Screens below the top stay in the DOM but hidden, so going
// back is instant and keeps its scroll/focus state.
//
// A screen is { el, onKey(action) -> bool?, onShow?(), onHide?(), destroy?() }.
import { setHandler } from './input.js';
import { exitApp } from './platform/tizen.js';

const stack = [];
let root = null;
let globalKey = null;

export function init(container, onGlobalKey) {
  root = container;
  globalKey = onGlobalKey;
  setHandler(action => {
    const top = stack[stack.length - 1];
    if (top && top.onKey && top.onKey(action) === true) return;
    if (globalKey && globalKey(action) === true) return;
    if (action === 'back') back();
  });
}

function hide(screen) {
  screen.el.classList.add('hidden');
  if (screen.onHide) screen.onHide();
}

function reveal(screen) {
  screen.el.classList.remove('hidden');
  if (screen.onShow) screen.onShow();
}

export function push(screen) {
  const top = stack[stack.length - 1];
  if (top) hide(top);
  stack.push(screen);
  root.appendChild(screen.el);
  reveal(screen);
}

export function replace(screen) {
  const top = stack.pop();
  if (top) destroy(top);
  push(screen);
}

// Clear everything and start over from one screen (sign in/out, server switch).
export function reset(screen) {
  while (stack.length) destroy(stack.pop());
  push(screen);
}

function destroy(screen) {
  if (screen.onHide) screen.onHide();
  if (screen.destroy) screen.destroy();
  if (screen.el.parentNode) screen.el.parentNode.removeChild(screen.el);
}

export function back() {
  if (stack.length <= 1) {
    exitApp();
    return;
  }
  destroy(stack.pop());
  reveal(stack[stack.length - 1]);
}

export function top() {
  return stack[stack.length - 1];
}
