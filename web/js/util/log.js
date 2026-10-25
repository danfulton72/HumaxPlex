import { DEV, DEV_HOST } from '../config.js';
// Logging. In dev builds every line is also batched to the devserver on the Mac,
// since the TV gives us no usable console.
const queue = [];
let timer = 0;

function stringify(args) {
  return args.map(a => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
    return String(a);
  }).join(' ');
}

function flush() {
  timer = 0;
  if (!queue.length) return;
  const body = JSON.stringify(queue.splice(0));
  try {
    fetch('http://' + DEV_HOST + '/log', { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  } catch (e) { /* devserver not running */ }
}

function emit(level, args) {
  if (!DEV || !DEV_HOST) return;
  queue.push({ t: Date.now(), level, msg: stringify(args) });
  if (!timer) timer = setTimeout(flush, 400);
}

export const log = (...a) => { console.log(...a); emit('log', a); };
export const warn = (...a) => { console.warn(...a); emit('warn', a); };
export const error = (...a) => { console.error(...a); emit('error', a); };
export const perf = (...a) => emit('perf', a);

if (DEV) {
  window.addEventListener('error', e => error('uncaught', e.message, (e.filename || '') + ':' + e.lineno, e.error || ''));
  window.addEventListener('unhandledrejection', e => error('unhandled rejection', e.reason));
}
