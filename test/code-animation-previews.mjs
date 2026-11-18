import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  entryHash,
  generatePreviews,
  makeManifest,
  motifFor,
  normalizeCatalog,
  paletteFor,
  previewTypeFor,
  renderPreviewSvg,
} from '../code-animation/skills/code-animation-prompts/scripts/generate_previews.mjs';

const root = path.resolve(import.meta.dirname, '..');
const catalogPath = path.join(root, 'code-animation/skills/code-animation-prompts/references/catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const entries = normalizeCatalog(catalog);
assert.equal(entries.length, 341);
assert.equal(entries.filter(entry => !entry.image).length, 145);

const byId = new Map(entries.map(entry => [entry.id, entry]));
assert.equal(motifFor(byId.get('A1')), 'type');
assert.equal(motifFor(byId.get('B3')), 'particle');
assert.equal(motifFor(byId.get('F1')), 'chart');
assert.equal(previewTypeFor(byId.get('M2')), 'motion');
assert.equal(previewTypeFor(byId.get('M28')), 'static');
assert.notDeepEqual(paletteFor(byId.get('A1')), paletteFor(byId.get('B3')));

const b3 = renderPreviewSvg(byId.get('B3'));
assert.equal(b3, renderPreviewSvg(byId.get('B3')), 'same metadata must render byte-for-byte identically');
assert.match(b3, /^<svg\b/);
assert.match(b3, /width="800" height="450"/);
assert.match(b3, /data-motif="particle"/);
assert.match(b3, /<title[^>]*>粒子聚形<\/title>/);
assert.notEqual(b3, renderPreviewSvg({ ...byId.get('B3'), description: '另一种构图' }));
assert.notEqual(entryHash(byId.get('B3')), entryHash({ ...byId.get('B3'), tags: ['changed'] }));

const manifest = makeManifest([byId.get('A1'), byId.get('A2'), byId.get('M2')]);
assert.deepEqual(manifest.entries.map(entry => entry.id), ['A1', 'A2', 'M2']);
assert.equal(manifest.entries[0].file, 'A1.svg');
assert.equal(manifest.entries[0].src, 'generated-previews/A1.svg');
assert.equal(manifest.entries[0].path, 'assets/generated-previews/A1.svg');
assert.equal(manifest.entries[0].motif, 'type');
assert.equal(manifest.entries[0].previewType, 'static');
assert.equal(makeManifest([byId.get('M2')]).entries[0].previewType, 'motion');
assert.equal(manifest.entries[0].metadataComplete, true);
assert.equal(makeManifest([byId.get('M14')]).entries[0].metadataComplete, false);
const missingManifest = makeManifest(entries.filter(entry => !entry.image));
assert.equal(missingManifest.entries.filter(entry => entry.previewType === 'motion').length, 61);
assert.equal(missingManifest.entries.filter(entry => entry.previewType === 'static').length, 84);
assert.equal(missingManifest.entries.filter(entry => !entry.metadataComplete).length, 8);

const temp = await mkdtemp(path.join(os.tmpdir(), 'code-animation-previews-'));
try {
  const tempCatalog = path.join(temp, 'catalog.json');
  const tempOutput = path.join(temp, 'generated-previews');
  await writeFile(tempCatalog, JSON.stringify({ entries: [byId.get('A1'), byId.get('B3'), byId.get('M14')] }));
  const first = await generatePreviews({ catalog: tempCatalog, output: tempOutput });
  assert.equal(first.selected, 3);
  assert.equal(first.generated, 3);
  assert.equal(first.skipped, 0);
  const second = await generatePreviews({ catalog: tempCatalog, output: tempOutput });
  assert.equal(second.generated, 0);
  assert.equal(second.skipped, 3);
  await mkdir(path.join(tempOutput, 'ai'), { recursive: true });
  await writeFile(path.join(tempOutput, 'ai', 'A1.webp'), 'imagegen-preview');
  const withImagegen = await generatePreviews({ catalog: tempCatalog, output: tempOutput });
  const imagegenEntry = withImagegen.manifest.entries.find(entry => entry.id === 'A1');
  assert.equal(imagegenEntry?.previewType, 'image');
  assert.equal(imagegenEntry?.previewSource, 'imagegen');
  assert.equal(imagegenEntry?.src, 'generated-previews/ai/A1.webp');
  const forced = await generatePreviews({ catalog: tempCatalog, output: tempOutput, force: true });
  assert.equal(forced.generated, 2);
  assert.equal(forced.skipped, 1);
  const selectedByString = await generatePreviews({ catalog: tempCatalog, output: path.join(temp, 'single'), ids: 'B3' });
  assert.equal(selectedByString.selected, 1);
  const dry = await generatePreviews({ catalog: tempCatalog, output: path.join(temp, 'dry'), dryRun: true });
  assert.equal(dry.generated, 3);
  assert.equal(dry.manifestChanged, true);
  const missingOnly = await generatePreviews({ catalog: tempCatalog, output: path.join(temp, 'missing'), missingOnly: true });
  assert.equal(missingOnly.selected, 1, 'missing-only should select only the text-reference entry');
  await assert.rejects(() => generatePreviews({ catalog: tempCatalog, output: path.join(temp, 'unknown'), ids: ['NOPE'] }), /catalog 中没有风格/);
  const manifestFile = JSON.parse(await readFile(path.join(tempOutput, 'manifest.json'), 'utf8'));
  assert.equal(manifestFile.entries.length, 3);
  assert.ok(manifestFile.entries.every(entry => entry.hash && entry.signature && entry.motif));
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('code-animation-previews: all assertions passed');
