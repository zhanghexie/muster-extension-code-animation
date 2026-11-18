#!/usr/bin/env node
/**
 * Generate deterministic, dependency-free SVG covers for the code-animation
 * catalog.  The source stills are kept intact; these covers fill the gaps for
 * text-only entries and make it possible to render the catalog offline.
 *
 * The module exports the planning/rendering helpers as pure functions so the
 * generator can be checked without writing the repository.  The CLI writes
 * one SVG per catalog entry and a manifest containing the content hashes used
 * for incremental generation.
 */
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const GENERATOR_VERSION = '1';
export const DEFAULT_WIDTH = 800;
export const DEFAULT_HEIGHT = 450;
export const DEFAULT_FORMAT = 'svg';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_CATALOG = path.join(SKILL_ROOT, 'references', 'catalog.json');
const DEFAULT_OUTPUT = path.join(SKILL_ROOT, 'assets', 'generated-previews');
const MANIFEST_NAME = 'manifest.json';

const PALETTES = {
  AG: ['#08141f', '#12314c', '#52d3dd', '#f1c76b', '#f5f7ff'],
  M: ['#1d1727', '#45304d', '#ef8b72', '#f6c883', '#fff4d6'],
  K: ['#fff3e5', '#ffcabd', '#f1848d', '#6b76d6', '#26305a'],
  Z: ['#101b25', '#1e3543', '#c44b3d', '#dca85f', '#e7e1c4'],
  H: ['#f2eee5', '#c8d5e3', '#2d4f77', '#c76850', '#182334'],
  L: ['#0c1826', '#17405b', '#72c6d0', '#ef9b63', '#eff6ee'],
  V: ['#12101e', '#32244e', '#b963ed', '#57d6cf', '#f4e7ff'],
  X: ['#070b0e', '#142b2d', '#48d597', '#e3df78', '#dff8ee'],
  R: ['#27211d', '#58453a', '#bc7556', '#e2b576', '#f4e6cb'],
  O: ['#111318', '#29313c', '#d28b4c', '#e7c477', '#f4eee2'],
};

const MOTIF_RULES = [
  // A bare "字" token would also match 数字/汉字 in otherwise graphical
  // descriptions.  Category A is handled explicitly below; the remaining
  // terms are intentionally more specific.
  ['type', ['文字', '字幕', '打字', '歌词', '金句', '字体', 'word', 'letter', 'typography']],
  ['particle', ['粒子', '光尘', '萤火', '星空', '星星', '火星', '尘', '微光', 'particle', 'spark']],
  ['network', ['连线', '关系', '节点', '箭头', '网络', '网', '连接', 'network', 'node']],
  ['wave', ['水墨', '涟漪', '波', '雨', '雪', '云', '雾', '流动', '丝线', 'wave', 'rain', 'water']],
  ['chart', ['图表', '数据', '公式', '数学', '时间线', '地图', '步骤', '拆解', 'chart', 'timeline']],
  ['film', ['胶片', '录像', '电影', '镜头', '年代', '舞台', '海报', 'film', 'cinema', 'camera']],
  ['paper', ['纸', '剪纸', '白板', '手绘', '手写', '明信片', '书', '笔记', 'paper', 'sketch']],
  ['geometry', ['几何', '圆', '方', '三角', '形状', '色块', '建筑', '玻璃', 'geometry', 'shape']],
];

const CATEGORY_MOTIFS = {
  A: 'type',
  B: 'particle',
  C: 'wave',
  D: 'wave',
  E: 'geometry',
  F: 'chart',
  G: 'film',
  M: 'paper',
  K: 'geometry',
  Z: 'paper',
  H: 'geometry',
  L: 'film',
  V: 'particle',
  X: 'geometry',
  R: 'paper',
  O: 'film',
};

const MOTION_PREVIEW_IDS = new Set([
  'M2', 'M18', 'M19', 'M20', 'M21', 'M22', 'M23', 'M24', 'M8', 'M9', 'M10', 'M11', 'M12', 'M13', 'M27', 'M29', 'M31',
  'M3', 'M25', 'M36', 'M4', 'M5', 'M33', 'M38', 'M37', 'M6', 'M7', 'M32', 'M34',
  'Z7', 'Z12', 'V1', 'V2', 'V4', 'V6', 'V10', 'V12', 'V14', 'V15',
  'X2', 'X3', 'X4', 'X5', 'X6', 'X10', 'X11', 'X12', 'X13', 'X14', 'X15', 'X16', 'X21', 'X22', 'X24', 'X25', 'X26', 'X27', 'X28', 'X29', 'X30', 'X31'
]);

export function previewTypeFor(entryLike) {
  const entry = normalizeEntry(entryLike);
  return MOTION_PREVIEW_IDS.has(entry.id) ? 'motion' : 'static';
}

const escapeXml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const n = (value, digits = 2) => Number(value.toFixed(digits));

function normalizedText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Return a stable, compact representation of the catalog fields used by a preview. */
export function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('catalog entry must be an object');
  const id = normalizedText(entry.id).toUpperCase();
  if (!/^[A-Z][A-Z0-9]*$/.test(id)) throw new Error(`invalid catalog id: ${entry.id}`);
  const tags = Array.isArray(entry.tags) ? entry.tags.map(normalizedText).filter(Boolean) : [];
  return {
    id,
    name: normalizedText(entry.name),
    series: normalizedText(entry.series).toUpperCase(),
    category: normalizedText(entry.category),
    description: normalizedText(entry.description),
    fit: normalizedText(entry.fit),
    tags,
    image: normalizedText(entry.image),
  };
}

/** Validate and normalize a catalog document without touching the filesystem. */
export function normalizeCatalog(document) {
  if (!document || typeof document !== 'object' || !Array.isArray(document.entries)) {
    throw new TypeError('catalog must contain an entries array');
  }
  const entries = document.entries.map(normalizeEntry);
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`duplicate catalog id: ${entry.id}`);
    seen.add(entry.id);
  }
  return entries;
}

function catalogText(entry) {
  return [entry.name, entry.category, entry.description, entry.fit, ...entry.tags]
    .filter(Boolean).join(' ').toLocaleLowerCase();
}

/** Pick a semantic visual motif from the metadata. */
export function motifFor(entryLike) {
  const entry = normalizeEntry(entryLike);
  if (/^A(?:\s|$)/i.test(entry.category) || /^A(?:\d|$)/i.test(entry.id)) return 'type';
  const text = catalogText(entry);
  for (const [motif, terms] of MOTIF_RULES) {
    if (terms.some(term => text.includes(term.toLocaleLowerCase()))) return motif;
  }
  return CATEGORY_MOTIFS[entry.id[0]] || CATEGORY_MOTIFS[entry.series[0]] || 'geometry';
}

function hashBytes(input) {
  return createHash('sha256').update(input).digest();
}

function seedFor(entry) {
  const bytes = hashBytes(`${entry.id}\u0000${catalogText(entry)}`);
  let state = bytes.readUInt32LE(0) || 1;
  return () => {
    // Mulberry32-style integer step; all arithmetic stays deterministic.
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function paletteFor(entryLike) {
  const entry = normalizeEntry(entryLike);
  const base = PALETTES[entry.series] || PALETTES[entry.id[0]] || PALETTES.AG;
  const rotate = hashBytes(entry.id).readUInt32LE(0) % base.length;
  return base.map((_, index) => base[(index + rotate) % base.length]);
}

function signatureFor(entry) {
  const palette = paletteFor(entry);
  const motif = motifFor(entry);
  const variant = hashBytes(JSON.stringify(canonicalEntry(entry))).toString('hex').slice(0, 8);
  return `${entry.series || entry.id[0] || 'AG'}:${motif}:${variant}:${palette.join(',')}`;
}

const canonicalEntry = entry => ({
  id: entry.id,
  name: entry.name,
  series: entry.series,
  category: entry.category,
  description: entry.description,
  fit: entry.fit,
  tags: [...entry.tags],
  image: entry.image,
});

/** Content hash used by the incremental cache. */
export function entryHash(entryLike, options = {}) {
  const entry = normalizeEntry(entryLike);
  const width = Math.max(1, Math.trunc(finite(options.width, DEFAULT_WIDTH)));
  const height = Math.max(1, Math.trunc(finite(options.height, DEFAULT_HEIGHT)));
  const format = options.format || DEFAULT_FORMAT;
  return createHash('sha256').update(JSON.stringify({ generator: GENERATOR_VERSION, width, height, format, entry: canonicalEntry(entry) })).digest('hex');
}

function pathFor(points) {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${n(x)} ${n(y)}`).join(' ');
}

function defs(palette, id) {
  return `<defs>
    <linearGradient id="bg-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette[0]}"/><stop offset="0.55" stop-color="${palette[1]}"/><stop offset="1" stop-color="${palette[2]}"/>
    </linearGradient>
    <radialGradient id="glow-${id}" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="${palette[3]}" stop-opacity=".36"/><stop offset="1" stop-color="${palette[0]}" stop-opacity="0"/></radialGradient>
    <pattern id="grid-${id}" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="${palette[4]}" stroke-opacity=".11"/></pattern>
  </defs>`;
}

function background(width, height, palette, id) {
  return `<rect width="${width}" height="${height}" fill="url(#bg-${id})"/><rect width="${width}" height="${height}" fill="url(#glow-${id})"/><rect width="${width}" height="${height}" fill="url(#grid-${id})"/>`;
}

function motifType(entry, palette, width, height, rand) {
  const motif = motifFor(entry);
  const accent = palette[3];
  const bright = palette[4];
  const soft = palette[2];
  const cx = width * (0.48 + rand() * 0.08);
  const cy = height * (0.44 + rand() * 0.1);
  if (motif === 'type') {
    const lines = [];
    for (let row = 0; row < 8; row += 1) {
      const y = 72 + row * 40 + rand() * 12;
      const len = 150 + rand() * 440;
      lines.push(`<rect x="${n(width * .11 + rand() * width * .08)}" y="${n(y)}" width="${n(len)}" height="${n(5 + rand() * 7)}" rx="${n(3)}" fill="${row % 3 === 0 ? accent : bright}" opacity="${n(.26 + rand() * .4, 3)}"/>`);
    }
    lines.push(`<text x="${n(cx)}" y="${n(cy + 14)}" text-anchor="middle" fill="${bright}" opacity=".9" font-family="sans-serif" font-size="${n(Math.min(width, height) * .13)}" font-weight="700">${escapeXml(entry.id)}</text>`);
    lines.push(`<path d="M${n(cx + 64)} ${n(cy - 62)}v${n(75 + rand() * 35)}" stroke="${accent}" stroke-width="5" opacity=".9"/>`);
    return lines.join('');
  }
  if (motif === 'particle') {
    const dots = [];
    for (let i = 0; i < 54; i += 1) {
      const x = width * (.1 + rand() * .8);
      const y = height * (.12 + rand() * .68);
      const radius = 1.5 + rand() * 5.5;
      dots.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(radius)}" fill="${i % 5 ? soft : accent}" opacity="${n(.24 + rand() * .7, 3)}"/>`);
      if (i > 0 && i % 4 === 0) dots.push(`<path d="M${n(x)} ${n(y)}L${n(x - (rand() - .5) * 180)} ${n(y - (rand() - .5) * 100)}" stroke="${bright}" stroke-width="1" opacity=".24"/>`);
    }
    dots.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(34 + rand() * 18)}" fill="none" stroke="${accent}" stroke-width="3" opacity=".88"/><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(7 + rand() * 6)}" fill="${bright}"/>`);
    return dots.join('');
  }
  if (motif === 'network') {
    const points = Array.from({ length: 10 }, () => [width * (.16 + rand() * .68), height * (.2 + rand() * .55)]);
    const links = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x, y] = points[i];
      for (const j of [i + 1, i + 3]) if (j < points.length) links.push(`<path d="M${n(x)} ${n(y)}L${n(points[j][0])} ${n(points[j][1])}" stroke="${soft}" stroke-width="2" opacity=".48"/>`);
      links.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(6 + rand() * 6)}" fill="${i === 0 ? accent : bright}" opacity=".9"/>`);
    }
    links.push(`<path d="M${n(width * .13)} ${n(height * .78)}H${n(width * .87)}" stroke="${accent}" stroke-width="2" stroke-dasharray="5 10" opacity=".55"/>`);
    return links.join('');
  }
  if (motif === 'wave') {
    const waves = [];
    for (let line = 0; line < 8; line += 1) {
      const points = [];
      for (let step = 0; step <= 12; step += 1) {
        const x = width * .06 + step * width * .88 / 12;
        const y = height * (.25 + line * .065) + Math.sin(step * .8 + rand() * 3) * (11 + line * 2);
        points.push([x, y]);
      }
      waves.push(`<path d="${pathFor(points)}" fill="none" stroke="${line % 3 ? soft : accent}" stroke-width="${n(2 + line * .35)}" opacity="${n(.3 + line * .07, 3)}"/>`);
    }
    waves.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(16 + rand() * 10)}" fill="${accent}" opacity=".8"/><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(44 + rand() * 24)}" fill="none" stroke="${bright}" stroke-width="2" opacity=".46"/>`);
    return waves.join('');
  }
  if (motif === 'chart') {
    const chart = [];
    const left = width * .15;
    const bottom = height * .79;
    chart.push(`<path d="M${n(left)} ${n(height * .18)}V${n(bottom)}H${n(width * .86)}" fill="none" stroke="${bright}" stroke-width="3" opacity=".7"/>`);
    const bars = [];
    for (let i = 0; i < 7; i += 1) {
      const barHeight = height * (.13 + rand() * .4);
      const x = left + 44 + i * 65;
      bars.push(`<rect x="${n(x)}" y="${n(bottom - barHeight)}" width="${n(31 + rand() * 12)}" height="${n(barHeight)}" rx="4" fill="${i % 2 ? soft : accent}" opacity=".82"/>`);
    }
    chart.push(bars.join(''));
    const line = Array.from({ length: 9 }, (_, i) => [left + i * 75, height * (.3 + rand() * .27)]);
    chart.push(`<path d="${pathFor(line)}" fill="none" stroke="${bright}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`);
    chart.push(line.map(([x, y]) => `<circle cx="${n(x)}" cy="${n(y)}" r="5" fill="${accent}"/>`).join(''));
    return chart.join('');
  }
  if (motif === 'film') {
    const frame = [];
    frame.push(`<rect x="${n(width * .09)}" y="${n(height * .18)}" width="${n(width * .82)}" height="${n(height * .55)}" rx="10" fill="none" stroke="${bright}" stroke-width="3" opacity=".86"/>`);
    for (let x = width * .12; x < width * .88; x += 38) frame.push(`<rect x="${n(x)}" y="${n(height * .12)}" width="20" height="14" rx="3" fill="${accent}" opacity=".55"/><rect x="${n(x)}" y="${n(height * .75)}" width="20" height="14" rx="3" fill="${accent}" opacity=".55"/>`);
    for (let y = height * .23; y < height * .69; y += 16) frame.push(`<path d="M${n(width * .11)} ${n(y)}H${n(width * .89)}" stroke="${soft}" stroke-width="1" opacity=".22"/>`);
    frame.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(54 + rand() * 24)}" fill="${accent}" opacity=".7"/><path d="M${n(cx - 26)} ${n(cy + 22)}l${n(26)} ${n(-48)}l${n(30)} ${n(48)}z" fill="${bright}" opacity=".9"/>`);
    return frame.join('');
  }
  if (motif === 'paper') {
    const paper = [];
    paper.push(`<rect x="${n(width * .18)}" y="${n(height * .17)}" width="${n(width * .6)}" height="${n(height * .57)}" rx="7" fill="${bright}" opacity=".92" transform="rotate(-4 ${n(width * .48)} ${n(height * .45)})"/>`);
    paper.push(`<rect x="${n(width * .24)}" y="${n(height * .23)}" width="${n(width * .6)}" height="${n(height * .57)}" rx="7" fill="${accent}" opacity=".27" transform="rotate(6 ${n(width * .54)} ${n(height * .5)})"/>`);
    for (let row = 0; row < 6; row += 1) paper.push(`<path d="M${n(width * .28)} ${n(height * (.31 + row * .065))}h${n(260 + rand() * 160)}" stroke="${palette[0]}" stroke-width="${n(3 + rand() * 4)}" opacity=".42"/>`);
    paper.push(`<path d="M${n(width * .63)} ${n(height * .31)}l${n(62 + rand() * 30)} ${n(54 + rand() * 38)}l${n(-82 - rand() * 24)} ${n(62 + rand() * 26)}z" fill="${soft}" opacity=".78"/>`);
    return paper.join('');
  }
  // geometry and the catch-all are intentionally bold at thumbnail size.
  const shapes = [];
  for (let i = 0; i < 9; i += 1) {
    const x = width * (.14 + rand() * .7);
    const y = height * (.16 + rand() * .58);
    const size = 25 + rand() * 105;
    if (i % 3 === 0) shapes.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(size / 2)}" fill="${i % 2 ? soft : accent}" opacity="${n(.3 + rand() * .55, 3)}"/>`);
    else if (i % 3 === 1) shapes.push(`<rect x="${n(x - size / 2)}" y="${n(y - size / 2)}" width="${n(size)}" height="${n(size)}" rx="${n(5 + rand() * 18)}" fill="${i % 2 ? bright : soft}" opacity="${n(.25 + rand() * .58, 3)}" transform="rotate(${n(rand() * 80 - 40)} ${n(x)} ${n(y)})"/>`);
    else shapes.push(`<path d="M${n(x)} ${n(y - size / 2)}L${n(x + size / 2)} ${n(y + size / 2)}H${n(x - size / 2)}Z" fill="${accent}" opacity="${n(.28 + rand() * .5, 3)}"/>`);
  }
  shapes.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(64 + rand() * 28)}" fill="none" stroke="${bright}" stroke-width="4" opacity=".86"/><path d="M${n(cx - 42)} ${n(cy)}h84M${n(cx)} ${n(cy - 42)}v84" stroke="${accent}" stroke-width="2" opacity=".55"/>`);
  return shapes.join('');
}

/** Render one catalog entry as a deterministic SVG string. */
export function renderPreviewSvg(entryLike, options = {}) {
  const entry = normalizeEntry(entryLike);
  const width = Math.max(1, Math.trunc(finite(options.width, DEFAULT_WIDTH)));
  const height = Math.max(1, Math.trunc(finite(options.height, DEFAULT_HEIGHT)));
  const palette = paletteFor(entry);
  const rand = seedFor(entry);
  const safeId = entry.id.replace(/[^A-Za-z0-9_-]/g, '_');
  const idLabel = escapeXml(entry.id);
  const title = escapeXml(entry.name || entry.id);
  const subtitle = escapeXml(entry.fit || entry.description || entry.category || '代码动画风格');
  const motif = motifFor(entry);
  const art = motifType(entry, palette, width, height, rand);
  const labelY = height - 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title-${safeId} desc-${safeId}">
  <title id="title-${safeId}">${title}</title>
  <desc id="desc-${safeId}">${idLabel} · ${escapeXml(entry.category)} · ${escapeXml(subtitle)}</desc>
  ${defs(palette, safeId)}
  ${background(width, height, palette, safeId)}
  <g data-motif="${motif}">${art}</g>
  <rect x="22" y="20" width="${Math.min(126, width - 44)}" height="30" rx="15" fill="${palette[0]}" opacity=".72" stroke="${palette[4]}" stroke-opacity=".28"/>
  <text x="38" y="41" fill="${palette[4]}" font-family="ui-monospace,Consolas,monospace" font-size="16" font-weight="700" letter-spacing="1">${idLabel}</text>
  <text x="${n(width - 24)}" y="${labelY}" text-anchor="end" fill="${palette[4]}" opacity=".72" font-family="sans-serif" font-size="15">${title}</text>
  <path d="M24 ${labelY + 8}H${n(width - 24)}" stroke="${palette[3]}" stroke-width="2" opacity=".54"/>
</svg>`;
}

/** Build the manifest row for one entry. */
export function manifestEntry(entryLike, options = {}) {
  const entry = normalizeEntry(entryLike);
  const width = Math.max(1, Math.trunc(finite(options.width, DEFAULT_WIDTH)));
  const height = Math.max(1, Math.trunc(finite(options.height, DEFAULT_HEIGHT)));
  const format = options.format || DEFAULT_FORMAT;
  return {
    id: entry.id,
    file: `${entry.id}.svg`,
    src: `generated-previews/${entry.id}.svg`,
    path: `assets/generated-previews/${entry.id}.svg`,
    hash: entryHash(entry, { width, height, format }),
    signature: signatureFor(entry),
    series: entry.series,
    category: entry.category,
    motif: motifFor(entry),
    previewType: previewTypeFor(entry),
    hasSourceStill: Boolean(entry.image),
    metadataComplete: Boolean(entry.name && entry.category && (entry.description || entry.fit || entry.tags.length)),
  };
}

function imagegenRow(row, hash) {
  return {
    ...row,
    file: `ai/${row.id}.webp`,
    src: `generated-previews/ai/${row.id}.webp`,
    path: `assets/generated-previews/ai/${row.id}.webp`,
    hash: `imagegen:${hash}`,
    previewType: 'image',
    previewSource: 'imagegen',
  };
}

export function makeManifest(entriesLike, options = {}) {
  const entries = entriesLike.map(entry => manifestEntry(entry, options));
  const width = Math.max(1, Math.trunc(finite(options.width, DEFAULT_WIDTH)));
  const height = Math.max(1, Math.trunc(finite(options.height, DEFAULT_HEIGHT)));
  return { version: 1, generator: 'generate_previews.mjs', generatorVersion: GENERATOR_VERSION, width, height, format: options.format || DEFAULT_FORMAT, entries };
}

async function fileExists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function readManifest(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    return value && Array.isArray(value.entries) ? value : null;
  } catch { return null; }
}

async function atomicWrite(file, contents) {
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await writeFile(temp, contents, 'utf8');
  await rename(temp, file);
}

function selectEntries(entries, ids, missingOnly) {
  const idSet = ids?.length ? new Set(ids.map(id => id.toUpperCase())) : null;
  return entries.filter(entry => (!idSet || idSet.has(entry.id)) && (!missingOnly || !entry.image));
}

/**
 * Generate previews and return a deterministic summary.  With dryRun no
 * directory or file is changed, which makes this function safe for audits.
 */
export async function generatePreviews(options = {}) {
  const catalogPath = path.resolve(options.catalog || DEFAULT_CATALOG);
  const outputDir = path.resolve(options.output || DEFAULT_OUTPUT);
  const width = Math.max(1, Math.trunc(finite(options.width, DEFAULT_WIDTH)));
  const height = Math.max(1, Math.trunc(finite(options.height, DEFAULT_HEIGHT)));
  const format = options.format || DEFAULT_FORMAT;
  if (format !== 'svg') throw new Error(`unsupported preview format: ${format}`);
  const document = JSON.parse(await readFile(catalogPath, 'utf8'));
  const catalogEntries = normalizeCatalog(document);
  const ids = Array.isArray(options.ids) ? options.ids : (options.ids ? [options.ids] : []);
  if (ids.length) {
    const known = new Set(catalogEntries.map(entry => entry.id));
    const unknown = ids.map(id => String(id).toUpperCase()).filter(id => !known.has(id));
    if (unknown.length) throw new Error(`catalog 中没有风格：${unknown.join('、')}`);
  }
  const selected = selectEntries(catalogEntries, ids, Boolean(options.missingOnly));
  const manifestPath = path.join(outputDir, MANIFEST_NAME);
  const previous = await readManifest(manifestPath);
  const previousById = new Map((previous?.entries || []).map(entry => [entry.id, entry]));
  const rows = [];
  let generated = 0;
  let skipped = 0;
  let wouldGenerate = 0;
  if (!options.dryRun) await mkdir(outputDir, { recursive: true });
  for (const entry of selected) {
    const row = manifestEntry(entry, { width, height, format });
    const imagegenPath = path.join(outputDir, 'ai', `${entry.id}.webp`);
    if (await fileExists(imagegenPath)) {
      const imagegenHash = createHash('sha256').update(await readFile(imagegenPath)).digest('hex');
      rows.push(imagegenRow(row, imagegenHash));
      skipped += 1;
      continue;
    }
    const destination = path.join(outputDir, row.file);
    const cached = previousById.get(entry.id);
    const canSkip = !options.force && cached?.hash === row.hash && await fileExists(destination);
    if (canSkip) skipped += 1;
    else {
      generated += 1;
      wouldGenerate += 1;
      if (!options.dryRun) await atomicWrite(destination, renderPreviewSvg(entry, { width, height }));
    }
    rows.push(row);
  }
  // A partial or --missing-only run keeps valid rows produced by an earlier
  // full run. A normal full run drops rows for catalog entries that no longer
  // exist, so stale previews do not remain discoverable through the manifest.
  const selectedIds = new Set(selected.map(entry => entry.id));
  const partial = Boolean(ids.length || options.missingOnly);
  const merged = partial
    ? [...(previous?.entries || []).filter(row => !selectedIds.has(row.id)), ...rows]
    : rows;
  merged.sort((a, b) => catalogEntries.findIndex(entry => entry.id === a.id) - catalogEntries.findIndex(entry => entry.id === b.id));
  const manifest = { version: 1, generator: 'generate_previews.mjs', generatorVersion: GENERATOR_VERSION, width, height, format, entries: merged };
  const oldManifestText = previous ? JSON.stringify(previous, null, 2) + '\n' : '';
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  const manifestChanged = oldManifestText !== manifestText;
  if (!options.dryRun && manifestChanged) await atomicWrite(manifestPath, manifestText);
  return { catalogPath, outputDir, manifestPath, width, height, format, selected: selected.length, generated: options.dryRun ? wouldGenerate : generated, skipped, manifestChanged, manifest, dryRun: Boolean(options.dryRun) };
}

function usage() {
  return `用法：node generate_previews.mjs [选项]

选项：
  --catalog <文件>       catalog.json（默认使用本技能 references/catalog.json）
  --output <目录>        生成目录（默认 assets/generated-previews）
  --ids <A1,B2>          只处理指定风格编号
  --missing-only         只处理 catalog 中没有原始静帧的条目
  --width <像素>         SVG 宽度（默认 800）
  --height <像素>        SVG 高度（默认 450）
  --force                忽略缓存并重写 SVG
  --dry-run              只计算，不写文件
  --json                 输出 JSON 摘要`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--force') { options.force = true; continue; }
    if (arg === '--missing-only') { options.missingOnly = true; continue; }
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (['--catalog', '--output', '--ids', '--width', '--height'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 需要参数`);
      index += 1;
      if (arg === '--ids') options.ids = value.split(/[\s,，、]+/).map(item => item.trim()).filter(Boolean);
      else if (arg === '--width' || arg === '--height') {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 1) throw new Error(`${arg} 必须是正整数`);
        options[arg.slice(2)] = number;
      } else options[arg.slice(2)] = value;
      continue;
    }
    throw new Error(`未知选项：${arg}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  try {
    const options = parseArgs(args);
    if (options.help) { console.log(usage()); }
    else {
      const result = await generatePreviews(options);
      if (options.json) console.log(JSON.stringify({ ok: true, ...result, manifest: undefined }, null, 2));
      else console.log(`generate_previews: ok | ${result.selected} selected | ${result.generated} generated | ${result.skipped} cached | ${result.outputDir}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.includes('--json')) console.log(JSON.stringify({ ok: false, error: message }));
    else { console.error(`generate_previews: failed | ${message}`); console.error(usage()); }
    process.exitCode = 1;
  }
}

