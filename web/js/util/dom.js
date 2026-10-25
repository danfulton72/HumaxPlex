export function h(tag, className, parent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (parent) parent.appendChild(el);
  return el;
}

// Skip DOM writes when nothing changed; text and style writes are what
// invalidate paint on recycled nodes.
export function setText(el, value) {
  value = value == null ? '' : String(value);
  if (el._text !== value) {
    el._text = value;
    el.textContent = value;
  }
}

export function setTransform(el, value) {
  if (el._tf !== value) {
    el._tf = value;
    el.style.transform = value;
  }
}

export function show(el, visible) {
  const v = visible ? '' : 'none';
  if (el._disp !== v) {
    el._disp = v;
    el.style.display = v;
  }
}

export function toggleClass(el, name, on) {
  if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on);
}
