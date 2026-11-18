import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(import.meta.dirname, '..');
const html = await readFile(path.join(root, 'code-animation/panel/panel.html'), 'utf8');
const source = await readFile(path.join(root, 'code-animation/panel/app.js'), 'utf8');
const dom = new JSDOM(html, { url: 'http://code-animation.test/panel/panel.html', runScripts: 'outside-only' });
const { window } = dom;

window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
window.requestAnimationFrame = () => 1;
window.cancelAnimationFrame = () => {};
window.IntersectionObserver = class {
  constructor(callback) { this.callback = callback; }
  observe(target) { this.callback([{ target, isIntersecting: true }]); }
  unobserve() {}
  disconnect() {}
};

const drawCalls = [];
window.Motion = {
  drawPreview(canvas, options) { drawCalls.push({ canvas, options }); }
};

const catalog = {
  series: [{ id: 'M', count: 2 }],
  entries: [
    { id: 'M2', name: '纸感手写笔记', series: 'M', category: '讲解类', description: '纸面上的动效', fit: '步骤', tags: ['纸'], image: '', hasStill: false },
    { id: 'C1', name: '水墨晕开', series: 'AG', category: 'C 线与墨', description: '晕开', fit: '回忆', tags: ['水墨'], image: 'stills/C1.webp', hasStill: true }
  ]
};
const library = { version: 0, picks: [], works: [] };
const fetched = [];
window.fetch = async url => {
  const href = String(url);
  fetched.push(href);
  if (href.endsWith('/manifest.json')) {
    return { ok: true, json: async () => ({ version: 1, entries: [{ id: 'M2', src: 'generated-previews/M2.svg', previewType: 'motion' }, { id: 'C1', src: 'generated-previews/C1.svg', previewType: 'static' }] }) };
  }
  return { ok: true, blob: async () => new window.Blob(['<svg/>'], { type: 'image/svg+xml' }) };
};
window.ma = {
  ready: Promise.resolve(),
  agent: { domain: {
    query: async name => name === 'catalog' ? catalog : structuredClone(library),
    command: async () => ({ ok: true })
  } },
  on: () => () => {},
  ui: { confirm: async () => true },
  files: { pick: async () => [] },
  media: {},
  tasks: {},
  exports: {}
};

window.eval(source);
await new Promise(resolve => setTimeout(resolve, 25));

const motionCard = window.document.querySelector('[data-style="M2"]');
assert.ok(motionCard, 'motion style card is rendered');
const motionCanvas = motionCard.querySelector('canvas.motion-preview');
assert.ok(motionCanvas, 'missing still uses a canvas preview');
assert.equal(motionCanvas.dataset.motionDuration, '1.8');
assert.equal(drawCalls[0]?.options.id, 'M2');
assert.equal(fetched.filter(url => url.endsWith('/assets/generated-previews/M2.svg')).length, 0, 'canvas preview does not fetch the static SVG');

const motionFilter = [...window.document.querySelectorAll('#media button')].find(button => button.textContent.includes('可播样片'));
assert.ok(motionFilter, 'motion filter is available');
motionFilter.click();
assert.equal(window.document.querySelectorAll('#stylesGrid .tile').length, 1, 'motion filter includes manifest motion entries');

window.document.querySelector('[data-style="M2"] .tileOpen').click();
const detailCanvas = window.document.querySelector('#dialog canvas.motion-preview');
assert.ok(detailCanvas, 'details view uses the same motion canvas');
const beforeReplay = drawCalls.length;
window.document.querySelector('#dialog .dialogActions button').click();
assert.ok(drawCalls.length > beforeReplay, 'replay action redraws the first frame');

console.log('code-animation-motion-preview: ok');
