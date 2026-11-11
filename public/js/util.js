// DOM helpers. All user text goes through textContent (never innerHTML).
export function el(tag, attrs = {}, ...children) {
  const isSvg = ['svg', 'path', 'g', 'rect', 'circle', 'text', 'image', 'polyline', 'line', 'defs', 'pattern', 'clipPath', 'ellipse', 'polygon', 'use'].includes(tag);
  const node = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') isSvg ? node.setAttribute('class', v) : (node.className = v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) node.style.setProperty(sk, sv); else node.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
/** append, skipping null/false children */
export const add = (parent, ...kids) => { parent.append(...kids.flat().filter((k) => k != null && k !== false)); return parent; };
export const clear = (node) => { while (node.firstChild) node.firstChild.remove(); return node; };

let toastTimer;
export function toast(msg, kind = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), kind === 'error' ? 3800 : 2600);
}

export function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch { return null; }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
