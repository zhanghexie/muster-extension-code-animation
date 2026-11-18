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
window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
window.requestAnimationFrame = () => 1;
window.cancelAnimationFrame = () => {};
window.Motion = { draw() {}, drawPreview(canvas) { canvas.dataset.motionDrawn = '1'; } };

const catalog = {
  series: [{ id: 'AG', count: 3 }],
  entries: [
    { id: 'M2', name: '纸感手写笔记', series: 'AG', category: 'M', description: '纸面', fit: '讲方法', tags: ['纸感'], hasStill: false },
    { id: 'A1', name: '字雨', series: 'AG', category: 'A', description: '文字', fit: '压力', tags: ['字雨'], hasStill: false },
    { id: 'M3', name: '生成失败回退', series: 'AG', category: 'M', description: '回退', fit: '测试', tags: ['回退'], hasStill: false }
  ]
};
const library = { version: 0, picks: [], works: [] };
const fetched = [];
let blobSequence = 0;
window.fetch = async url => {
  const href = String(url);
  fetched.push(href);
  if (href.endsWith('/manifest.json')) {
    return { ok: true, json: async () => ({ version: 1, entries: [
      { id: 'M2', src: 'generated-previews/M2.svg', previewType: 'motion' },
      { id: 'A1', src: 'generated-previews/A1.svg', previewType: 'static' },
      { id: 'M3', src: 'generated-previews/M3.svg', previewType: 'static' }
    ] }) };
  }
  if (href.endsWith('/M3.svg')) return { ok: false, status: 404 };
  return { ok: true, blob: async () => new window.Blob(['<svg/>'], { type: 'application/octet-stream' }) };
};
window.URL.createObjectURL = () => `blob:preview-${++blobSequence}`;
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
await new Promise(resolve => setTimeout(resolve, 30));
assert.equal(window.document.querySelectorAll('#stylesGrid .tile').length, 3);
assert.ok(fetched.some(url => url.endsWith('/assets/generated-previews/manifest.json')));
assert.ok(window.document.querySelector('[data-style="M2"] .motion-preview'));
assert.ok(window.document.querySelector('[data-style="A1"] .cover img')?.src.endsWith('/assets/generated-previews/A1.svg'));
const failedImage = window.document.querySelector('[data-style="M3"] .cover img');
failedImage?.dispatchEvent(new window.Event('error'));
assert.ok(window.document.querySelector('[data-style="M3"] .cover .generated-preview'));
const generatedChip = [...window.document.querySelectorAll('#media button')].find(button => button.textContent.includes('生成预览'));
generatedChip?.click();
assert.equal(window.document.querySelectorAll('#stylesGrid .tile').length, 3);

window.document.querySelector('[data-style="M2"] .tileOpen').click();
await new Promise(resolve => setTimeout(resolve, 30));
assert.ok(window.document.querySelector('#dialog .motion-preview'));
assert.equal(window.document.querySelector('#dialog .motion-preview')?.dataset.motionDrawn, '1');
assert.ok([...window.document.querySelectorAll('#dialog button')].some(button => button.textContent.includes('重播')));

window.document.querySelector('#dialog').close();
window.document.querySelector('[data-style="A1"] .tileOpen').click();
await new Promise(resolve => setTimeout(resolve, 30));
const image = window.document.querySelector('#dialog .bigImage');
assert.equal(image?.src, 'blob:preview-1');
const previewFetches = () => fetched.filter(url => url.endsWith('/assets/generated-previews/A1.svg'));
assert.equal(previewFetches().length, 1);

window.document.querySelector('#dialog').close();
window.document.querySelector('[data-style="A1"] .tileOpen').click();
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(window.document.querySelector('#dialog .bigImage')?.src, 'blob:preview-1');
assert.equal(previewFetches().length, 1, 'repeat detail opens reuse the object URL cache');

console.log('code-animation-preview-panel: ok');
