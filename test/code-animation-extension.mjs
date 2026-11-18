import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDomainRuntime } from '../code-animation/domain.mjs';

const values = new Map();
const broker = async (method, args) => {
  if (method === 'data.read') return values.has(args[0]) ? { content: values.get(args[0]) } : null;
  if (method === 'data.write') { values.set(args[0], args[1]); return { ok: true }; }
  if (method === 'media.retain') return { assetId: args[0] };
  throw new Error('Unexpected broker method: ' + method);
};
const runtime = createDomainRuntime({ broker, identity: { extensionId: 'code-animation', extensionInstanceId: 'test', workspaceId: 'ws' }, packageRoot: path.resolve('code-animation') });
const catalog = await runtime.query('catalog', {});
assert.equal(catalog.entries.length, 341);
assert.equal(catalog.entries.filter(entry => entry.hasStill).length, 196);
const before = (await runtime.getSnapshot({})).version;
await runtime.execute('picks.set', { id: 'B3', selected: true }, { actor: 'human' });
await runtime.execute('work.save', { id: 'work-1', title: '城市片头', styles: ['B3', 'C1'] }, { actor: 'human' });
await runtime.execute('work.register', { id: 'work-1', relativePath: 'demo\\index.html' }, { actor: 'agent', taskRef: 'task-1' });
const saved = JSON.parse(values.get('library.json'));
assert.deepEqual(saved.picks, ['B3']);
assert.deepEqual(saved.works[0].styles, ['B3', 'C1']);
assert.equal(saved.works[0].kind, 'task');
assert.equal(saved.works[0].relativePath, 'demo/index.html');
assert.equal(saved.works[0].render.width, 1920);
assert.equal(saved.works[0].render.fps, 30);
const revision = saved.works[0].revision;
await assert.rejects(runtime.execute('work.save', { id: 'work-1', title: '旧版本', styles: ['B3'], expected: revision - 1 }, { actor: 'human' }), /已更新/);
await runtime.execute('work.validation', { id: 'work-1', status: 'passed', frames: [0, 6, 11.999], errors: [], expected: revision }, { actor: 'human' });
const afterValidation = JSON.parse(values.get('library.json')).works[0];
await runtime.execute('work.render', { id: 'work-1', status: 'queued', progress: 0, jobId: 'render-1', expected: afterValidation.revision }, { actor: 'human' });
const afterQueue = JSON.parse(values.get('library.json')).works[0];
await runtime.execute('work.render', { id: 'work-1', status: 'completed', progress: 1, jobId: 'render-1', assetId: '11111111-1111-4111-8111-111111111111', filename: 'render.webm', expected: afterQueue.revision }, { actor: 'human' });
const rendered = JSON.parse(values.get('library.json')).works[0];
assert.equal(rendered.validation.status, 'passed');
assert.equal(rendered.renderJob.status, 'completed');
assert.equal(rendered.renderJob.filename, 'render.webm');
const prompt = await runtime.query('prompt', { id: 'B3' });
assert.match(prompt.markdown, /粒子聚形/);
assert.ok((await runtime.getSnapshot({})).version > before);

// The panel is a host iframe, so exercise its DOM contract with the same
// catalog/domain boundary used by the real extension host.
const panelHtml = await readFile(path.resolve('code-animation/panel/panel.html'), 'utf8');
const panelCss = await readFile(path.resolve('code-animation/panel/style.css'), 'utf8');
assert.match(panelCss, /dialog\s*\{[^}]*position:\s*fixed/);
assert.match(panelCss, /dialog\s*\{[^}]*inset:\s*0/);
assert.match(panelCss, /dialog\[open\]\s*\{[^}]*display:\s*grid/);
assert.ok(panelHtml.includes('class="dialogCard"'));
assert.match(panelCss, /body\s*\{[^}]*background:\s*var\(--surface-canvas\)/);
assert.match(panelCss, /\.dialogCard\s*\{[^}]*background:\s*var\(--surface-overlay\)/);
const panel = new JSDOM(panelHtml, { url: 'http://code-animation.test/panel/panel.html', runScripts: 'outside-only' });
const { window } = panel;
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
window.requestAnimationFrame = () => 1;
window.cancelAnimationFrame = () => {};
window.Motion = { draw() {} };
const panelLibrary = { version: 0, picks: [], works: [{
  id: 'task-work', title: '可渲染片头', kind: 'task', taskRef: 'task-1',
  relativePath: 'demo/index.html', styles: ['B3'], revision: 1, updated: Date.now(),
  render: { duration: 12, fps: 30, width: 1920, height: 1080 },
  validation: { status: 'unknown', frames: [], errors: [] },
  renderJob: { status: 'idle', progress: 0 }
}] };
const releasedAssets = [];
const panelMa = {
  ready: Promise.resolve(),
  agent: { domain: {
    query: async (name, args = {}) => {
      if (name === 'catalog') return catalog;
      if (name === 'library') return structuredClone(panelLibrary);
      if (name === 'prompt') return runtime.query('prompt', args);
      throw new Error('unexpected query ' + name);
    },
    command: async (name, args) => {
      if (name === 'picks.set') {
        panelLibrary.picks = args.selected ? [...new Set([...panelLibrary.picks, args.id])] : panelLibrary.picks.filter(id => id !== args.id);
      }
      panelLibrary.version++;
      return { ok: true };
    }
  }},
  on: () => () => {},
  ui: { confirm: async () => true },
  files: { pick: async () => [] },
  media: { import: async () => ({ assetId: crypto.randomUUID() }), url: async () => ({ url: '' }), retain: async () => {}, release: async assetId => releasedAssets.push(assetId) },
  tasks: {}, exports: {}
};
window.ma = panelMa;
window.eval(await readFile(path.resolve('code-animation/panel/app.js'), 'utf8'));
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(window.document.querySelectorAll('#stylesGrid .tile').length, 341);
const search = window.document.querySelector('#search');
search.value = 'B3';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
assert.equal(window.document.querySelectorAll('#stylesGrid .tile').length, 1);
window.document.querySelector('#stylesGrid .tile .check').click();
await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(window.document.querySelector('#pickCount').textContent, '1');
window.document.querySelector('#worksNav').click();
assert.equal(window.document.querySelector('#worksPage').hidden, false);
window.document.querySelector('#stylesNav').click();
window.document.querySelector('#stylesGrid .tileOpen').click();
assert.equal(window.document.querySelector('#dialog').open, true);
assert.equal(window.document.querySelector('#dialogTitle').textContent, '粒子聚形');
window.document.querySelector('#dialog').close();
window.document.querySelector('#worksNav').click();
// Task works expose the host-backed preview, deterministic validation and WebM
// render actions. Exercise the button wiring with the same domain boundary as
// the real panel; the host tool itself is covered by browser-rendering.mjs.
panelMa.tasks.preview = async () => ({ ok: true, tabId: 'tab-task-1' });
panelMa.tasks.render = async request => {
  if (request.action === 'validate') return { ok: true, validation: { frames: request.times.map(timeMs => ({ timeMs, consistent: true, bytes: 12 })) } };
  if (request.action === 'start') return { ok: true, render: { id: 'render-task-1', status: 'completed', totalFrames: 1, frameCount: 1, artifact: { path: 'C:\\render-task-1.webm', mimeType: 'video/webm' } } };
  if (request.action === 'status') return { ok: true, render: { id: 'render-task-1', status: 'completed', totalFrames: 1, frameCount: 1, artifact: { path: 'C:\\render-task-1.webm', mimeType: 'video/webm' } } };
  throw new Error('unexpected render action ' + request.action);
};
panelMa.media.import = async () => ({ assetId: 'asset-rendered' });
panelMa.agent.domain.command = async (name, args) => {
  const work = panelLibrary.works.find(item => item.id === args.id);
  if (work && name === 'work.validation') work.validation = { status: args.status, frames: args.frames || [], errors: args.errors || [] };
  if (work && name === 'work.render') work.renderJob = { status: args.status, progress: args.progress || 0, jobId: args.jobId, assetId: args.assetId, filename: args.filename, error: args.error };
  panelLibrary.version++;
  return { ok: true };
};
window.document.querySelector('#workSearch').value = '可渲染片头';
window.document.querySelector('#workSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
window.document.querySelector('.workOpen').click();
await new Promise(resolve => setTimeout(resolve, 20));
const taskButtons = [...window.document.querySelectorAll('#dialog .dialogActions button')].map(node => node.textContent);
assert.ok(taskButtons.includes('验证关键帧'));
assert.ok(taskButtons.includes('渲染 WebM'));
window.document.querySelector('#dialog .dialogActions button:nth-child(2)').click();
await new Promise(resolve => setTimeout(resolve, 30));
assert.equal(panelLibrary.works[0].validation.status, 'passed');
window.document.querySelector('#dialog .dialogActions button:nth-child(3)').click();
await new Promise(resolve => setTimeout(resolve, 40));
assert.equal(panelLibrary.works[0].renderJob.status, 'completed');
assert.equal(panelLibrary.works[0].renderJob.assetId, 'asset-rendered');
window.document.querySelector('#dialog').close();
panelMa.files.pick = async () => ['C:\\demo\\failed.mp4'];
panelMa.media.import = async () => ({ assetId: 'asset-imported-then-released' });
panelMa.agent.domain.command = async () => { throw new Error('save failed'); };
window.document.querySelector('#importWork').click();
await new Promise(resolve => setTimeout(resolve, 20));
assert.deepEqual(releasedAssets, ['asset-imported-then-released']);
console.log('code-animation-extension: ok');
