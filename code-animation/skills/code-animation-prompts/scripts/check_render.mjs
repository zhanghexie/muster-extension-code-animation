#!/usr/bin/env node
/**
 * Validate the workbench code-animation render contract before opening a page.
 * This is a static preflight; actual pixels and WebM are produced by the
 * workbench code-animation render service described in references/rendering.md.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptName = path.basename(fileURLToPath(import.meta.url));
const usage = () => `用法：node ${scriptName} <项目内 HTML> [--project-root <任务目录>] [--json]`;
const fail = (message) => { throw new Error(message); };

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} 需要参数`);
  return value;
}

function parseContract(html) {
  const match = html.match(/<script\b[^>]*\bid=["']render-contract["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) fail('缺少 <script id="render-contract" type="application/json"> 元数据');
  try { return JSON.parse(match[1]); } catch (error) { fail(`render-contract 不是有效 JSON：${error.message}`); }
}

async function validateContract(contract, entry, projectRoot) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) fail('render-contract 必须是对象');
  for (const key of ['duration', 'fps', 'width', 'height']) {
    if (!Number.isFinite(contract[key]) || contract[key] <= 0) fail(`${key} 必须是正数`);
  }
  if (!Number.isInteger(contract.fps)) fail('fps 必须是整数');
  for (const key of ['width', 'height']) if (!Number.isInteger(contract[key])) fail(`${key} 必须是整数`);
  if (typeof contract.seed !== 'string' || !contract.seed.trim()) fail('seed 必须是非空字符串');
  if (!Array.isArray(contract.keyframes) || contract.keyframes.length < 3) fail('keyframes 至少需要开头、中段、结尾三个时间点');
  let previous = -Infinity;
  for (const time of contract.keyframes) {
    if (!Number.isFinite(time) || time < 0 || time > contract.duration) fail(`关键帧时间超出 0..duration：${time}`);
    if (time <= previous) fail('keyframes 必须严格递增且不可重复');
    previous = time;
  }
  if (contract.keyframes[0] !== 0) fail('keyframes 必须从 0 秒开始');
  if (!contract.keyframes.some(time => time > 0 && time < contract.duration)) fail('keyframes 必须包含中段时间点');
  if (!Array.isArray(contract.assets)) fail('assets 必须是项目相对资源路径数组');
  const root = projectRoot ?? path.dirname(entry);
  const assets = [];
  for (const asset of contract.assets) {
    if (typeof asset !== 'string' || !asset.trim()) fail('assets 中包含空路径');
    const normalized = asset.replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.split('/').includes('..')) fail(`资源必须是项目相对路径：${asset}`);
    const absolute = path.resolve(root, normalized);
    const relativeAsset = path.relative(root, absolute);
    if (!relativeAsset || relativeAsset === '..' || relativeAsset.startsWith(`..${path.sep}`) || path.isAbsolute(relativeAsset)) fail(`资源越过项目目录：${asset}`);
    try { await stat(absolute); } catch { fail(`找不到项目资源：${asset}`); }
    assets.push(normalized);
  }
  return assets;
}

function renderFunctionBody(html) {
  const start = html.search(/(?:window|globalThis)\.renderAt\s*=\s*(?:async\s*)?function\b|(?:window|globalThis)\.renderAt\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/i);
  if (start < 0) return '';
  const bodyStart = html.indexOf('{', start);
  if (bodyStart < 0) return html.slice(start);
  let depth = 0;
  for (let index = bodyStart; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  return html.slice(start);
}

const args = process.argv.slice(2);
const htmlPath = args.find((value, index) => !value.startsWith('--') && args[index - 1] !== '--project-root');
if (!htmlPath) { console.error(usage()); process.exitCode = 1; }
else {
  try {
    const entry = path.resolve(htmlPath);
    const projectRootOption = option(args, '--project-root');
    const projectRoot = projectRootOption ? path.resolve(projectRootOption) : undefined;
    if (projectRoot) {
      const relativeEntry = path.relative(projectRoot, entry);
      if (!relativeEntry || relativeEntry === '..' || relativeEntry.startsWith(`..${path.sep}`) || path.isAbsolute(relativeEntry)) fail('入口 HTML 必须位于 project-root 内');
    }
    const html = await readFile(entry, 'utf8');
    const contract = parseContract(html);
    const assets = await validateContract(contract, entry, projectRoot);
    if (!/(?:window|globalThis)\.renderAt\s*=/.test(html)) fail('页面必须暴露 window.renderAt(t)');
    const body = renderFunctionBody(html);
    if (/\bMath\.random\s*\(|\bDate\.now\s*\(|\bperformance\.now\s*\(|\bnew\s+Date\s*\(|\bcrypto\.(?:randomUUID|getRandomValues)\s*\(/.test(body)) fail('renderAt 不能读取系统时钟或未播种随机数；请从 t 和固定 seed 重算画面');
    const hasVisualOutput = /<(?:canvas|svg|img|video)\b/i.test(html)
      || /\b(?:drawImage|fillRect|strokeRect|arc|lineTo|createLinearGradient)\s*\(/.test(html)
      || /\b(?:background(?:-image)?|border(?:-radius)?|transform|filter)\s*:/.test(html);
    if (!hasVisualOutput) fail('页面没有可验收的图像、几何或绘制输出；不能只生成文字');
    const result = { ok: true, entry, duration: contract.duration, fps: contract.fps, width: contract.width, height: contract.height, seed: contract.seed, keyframes: contract.keyframes, assets };
    if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else console.log(`check_render: ok | ${path.relative(process.cwd(), entry)} | ${contract.width}x${contract.height} | ${contract.fps} fps | ${contract.duration}s | ${contract.keyframes.length} keyframes | ${assets.length} assets`);
  } catch (error) {
    const result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
    else console.error(`check_render: failed | ${result.error}`);
    process.exitCode = 1;
  }
}
