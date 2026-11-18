import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const skillRoot = path.join(root, 'code-animation', 'skills', 'code-animation-prompts');
const skill = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
const rendering = await readFile(path.join(skillRoot, 'references', 'rendering.md'), 'utf8');

// Keep the skill and its reference on the workbench protocol. These strings
// were the old standalone renderer's dependency contract and must not return.
const oldProtocol = /render_video\.py|styles\.py|playwright|chrom(?:e|ium)|ffmpeg|python\s+-m/i;
assert.equal(existsSync(path.join(skillRoot, 'scripts', 'render_video.py')), false, 'retired renderer script is still present');
assert.equal(existsSync(path.join(skillRoot, 'scripts', 'styles.py')), false, 'retired Python catalog script is still present');
assert.doesNotMatch(skill, oldProtocol, 'skill still advertises the retired renderer');
assert.doesNotMatch(rendering, oldProtocol, 'rendering reference still advertises the retired renderer');
assert.match(skill, /内置浏览器/);
assert.match(skill, /host\.tasks\.render/);
assert.match(rendering, /ma\.tasks\.render/);
assert.match(skill, /WebCodecs/);
assert.match(skill, /renderAt/);
assert.match(skill, /关键帧/);
assert.match(skill, /preparing.*rendering.*finalizing.*completed/s);
assert.match(skill, /不接受只有标题和段落/);
assert.match(rendering, /render-contract/);
assert.match(rendering, /项目相对路径/);
assert.match(rendering, /像素摘要/);
assert.match(rendering, /times.*毫秒/);
assert.match(rendering, /timeMs \/ 1000/);
assert.match(rendering, /validate.*times.*两次/s);
assert.match(rendering, /video\/webm/);
assert.match(rendering, /failed/);
assert.match(rendering, /cancelled/);

const checker = path.join(skillRoot, 'scripts', 'check_render.mjs');
const starter = path.join(skillRoot, 'assets', 'starter', 'index.html');
assert.equal(spawnSync(process.execPath, [checker, starter], { cwd: root, encoding: 'utf8' }).status, 0);
const checked = spawnSync(process.execPath, [checker, starter, '--json'], { cwd: root, encoding: 'utf8' });
assert.equal(checked.status, 0, checked.stderr);
const result = JSON.parse(checked.stdout);
assert.equal(result.ok, true);
assert.deepEqual(result.keyframes, [0, 6, 11.966666667]);
assert.deepEqual(result.assets, []);

const tmp = await mkdtemp(path.join(os.tmpdir(), 'code-animation-protocol-'));
try {
  const noContract = path.join(tmp, 'no-contract.html');
  await writeFile(noContract, '<canvas></canvas><script>window.renderAt = async function(t) {}</script>');
  const missing = spawnSync(process.execPath, [checker, noContract, '--json'], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0, 'missing render-contract must fail preflight');
  assert.match(missing.stdout, /render-contract/);

  const nondeterministic = path.join(tmp, 'nondeterministic.html');
  await writeFile(nondeterministic, `<canvas></canvas>
<script id="render-contract" type="application/json">${JSON.stringify({ duration: 3, fps: 30, width: 320, height: 320, seed: 'test', keyframes: [0, 1.5, 3], assets: [] })}</script>
<script>window.renderAt = async function(t) { const now = Date.now(); }</script>`);
  const nondeterministicResult = spawnSync(process.execPath, [checker, nondeterministic, '--json'], { encoding: 'utf8' });
  assert.notEqual(nondeterministicResult.status, 0, 'clock reads inside renderAt must fail preflight');
  assert.match(nondeterministicResult.stdout, /系统时钟/);

  const textOnly = path.join(tmp, 'text-only.html');
  await writeFile(textOnly, `<h1>标题</h1>
<script id="render-contract" type="application/json">${JSON.stringify({ duration: 3, fps: 30, width: 320, height: 320, seed: 'test', keyframes: [0, 1.5, 3], assets: [] })}</script>
<script>window.renderAt = async function(t) { document.querySelector('h1').textContent = t; }</script>`);
  const textOnlyResult = spawnSync(process.execPath, [checker, textOnly, '--json'], { encoding: 'utf8' });
  assert.notEqual(textOnlyResult.status, 0, 'text-only output must fail preflight');
  assert.match(textOnlyResult.stdout, /不能只生成文字/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('code-animation-protocol: all assertions passed');
