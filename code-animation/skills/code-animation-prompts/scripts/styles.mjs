#!/usr/bin/env node
/** Search the bundled style catalog without loading every prompt. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = () => {
  console.error('用法：node styles.mjs <search|show|list> [查询] [--series 系列] [--limit 数量] [--json]');
};

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 需要参数`);
  return value;
}

const args = process.argv.slice(2);
const command = args.shift();
if (!['search', 'show', 'list'].includes(command)) {
  usage();
  process.exitCode = 1;
} else {
  try {
    const series = option(args, '--series', '').trim().toUpperCase();
    const optionValues = new Set(['--series', '--limit']);
    const query = args.find((value, index) => !value.startsWith('--') && !optionValues.has(args[index - 1]))?.trim() ?? '';
    const limit = Number(option(args, '--limit', '20'));
    const json = args.includes('--json');
    if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit 必须是正整数');
    const catalog = JSON.parse(await readFile(path.join(root, 'references', 'catalog.json'), 'utf8'));
    let rows = catalog.entries;
    if (series) {
      if (!catalog.series.some(item => item.id === series)) throw new Error(`未知系列：${series}`);
      rows = rows.filter(entry => entry.series === series);
    }
    if (command !== 'list' && !query) throw new Error('search/show 需要风格编号或查询词');
    const folded = query.toLocaleLowerCase();
    if (command === 'show') rows = rows.filter(entry => entry.id.toLocaleLowerCase() === folded);
    if (command === 'search') {
      const terms = folded.split(/\s+/).filter(Boolean);
      rows = rows.filter(entry => terms.every(term => [entry.id, entry.name, entry.category, entry.description, entry.fit, ...entry.tags].join(' ').toLocaleLowerCase().includes(term)));
      rows.sort((a, b) => Number(a.id.toLocaleLowerCase() !== folded) - Number(b.id.toLocaleLowerCase() !== folded));
    }
    if (!rows.length) throw new Error('没有匹配的风格；B6 只是示例，并非目录条目');
    if (json) {
      console.log(JSON.stringify(rows.slice(0, limit), null, 2));
    } else if (command === 'show') {
      console.log(await readFile(path.join(root, rows[0].file), 'utf8'));
    } else {
      for (const entry of rows.slice(0, limit)) {
        console.log(`${entry.id.padStart(4)}  ${entry.name}  [${entry.series}]  ${entry.image ? '有静帧' : '文字参考'}`);
        console.log(`      ${entry.description}\n      ${entry.file}`);
      }
      console.log(`\n${rows.length} matches; showing ${Math.min(rows.length, limit)}.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
