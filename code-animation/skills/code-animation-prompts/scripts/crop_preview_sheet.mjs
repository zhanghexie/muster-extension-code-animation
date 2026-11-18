#!/usr/bin/env node
/** Crop a low-resolution image-generation contact sheet into preview cards. */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export async function cropPreviewSheet({ input, output, ids, columns = 2, rows = 2, gap = 8, inset = 0, width = 640, height = 360, quality = 84 }) {
  if (!input || !output || !Array.isArray(ids) || ids.length !== columns * rows) throw new Error('input、output、ids 和网格尺寸必须完整匹配');
  if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) throw new Error('网格尺寸必须为正整数');
  const metadata = await sharp(input).metadata();
  const sourceWidth = Number(metadata.width || 0), sourceHeight = Number(metadata.height || 0);
  const cellWidth = Math.floor((sourceWidth - gap * (columns - 1)) / columns);
  const cellHeight = Math.floor((sourceHeight - gap * (rows - 1)) / rows);
  if (cellWidth <= inset * 2 || cellHeight <= inset * 2) throw new Error('contact sheet 尺寸不足以裁剪');
  await mkdir(output, { recursive: true });
  const results = [];
  for (let index = 0; index < ids.length; index += 1) {
    const id = String(ids[index]).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]*$/.test(id)) throw new Error(`无效风格编号：${id}`);
    const column = index % columns, row = Math.floor(index / columns);
    const left = column * (cellWidth + gap) + inset;
    const top = row * (cellHeight + gap) + inset;
    const file = path.join(output, `${id}.webp`);
    await sharp(input).extract({ left, top, width: cellWidth - inset * 2, height: cellHeight - inset * 2 }).resize(width, height, { fit: 'cover' }).webp({ quality }).toFile(file);
    results.push(file);
  }
  return results;
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = argument('--input');
  const output = argument('--output');
  const ids = String(argument('--ids', '')).split(',').map(value => value.trim()).filter(Boolean);
  cropPreviewSheet({ input, output, ids, columns: Number(argument('--columns', 2)), rows: Number(argument('--rows', 2)), gap: Number(argument('--gap', 8)), inset: Number(argument('--inset', 0)) }).then(files => console.log(`crop_preview_sheet: ${files.length} generated`)).catch(error => { console.error(`crop_preview_sheet: failed | ${error.message}`); process.exitCode = 1; });
}
