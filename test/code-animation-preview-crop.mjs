import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { cropPreviewSheet } from '../code-animation/skills/code-animation-prompts/scripts/crop_preview_sheet.mjs';

const temp = await mkdtemp(path.join(os.tmpdir(), 'code-animation-crop-'));
try {
  const input = path.join(temp, 'sheet.png');
  const output = path.join(temp, 'out');
  const sheet = sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 20, g: 30, b: 40 } } });
  await sheet.png().toFile(input);
  const files = await cropPreviewSheet({ input, output, ids: ['M2', 'K30', 'Z1', 'Z7'], columns: 2, rows: 2, gap: 8 });
  assert.equal(files.length, 4);
  for (const file of files) {
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 640);
    assert.equal(metadata.height, 360);
    assert.ok((await readFile(file)).length > 0);
  }
} finally {
  if (process.platform !== 'win32') await rm(temp, { recursive: true, force: true });
}

console.log('code-animation-preview-crop: ok');
