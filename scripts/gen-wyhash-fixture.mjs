// Writes tests/fixtures/wyhash-bun.json: Bun.hash (wyhash, seed 0) of strings
// whose UTF-8 byte lengths cover every branch of the algorithm (0, 1-3, 4-8,
// 9-16, 17-48, over 48, block edges at 48, 96, 144), multi-byte UTF-8
// included. Run with bun from the repo root: bun scripts/gen-wyhash-fixture.mjs
// A seeded generator keeps the file stable across runs.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof Bun === 'undefined') {
  console.error('ERROR run this with bun: it records Bun.hash');
  process.exit(2);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'wyhash-bun.json');
let s = 0x2f6b1d3;
const rand = () => {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ASCII = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_ .:/{}';
const WIDE = ['é', 'ñ', 'ß', 'Ω', 'ж', '中', '文', '字', '한', 'ア', '😀', '🐙', '🦆', '✦', '·', '°', '◉', 'é', 'ä', '‍', ' '];
const ascii = (n) => Array.from({ length: n }, () => ASCII[Math.floor(rand() * ASCII.length)]).join('');
const mixed = (n) => {
  let t = '';
  while (t.length < n) t += rand() < 0.4 ? WIDE[Math.floor(rand() * WIDE.length)] : ASCII[Math.floor(rand() * ASCII.length)];
  return t;
};
const strings = [];
for (let n = 0; n <= 200; n++) strings.push(ascii(n));
for (let k = 0; k < 110; k++) strings.push(mixed(Math.floor(rand() * 201)));
for (const n of [1, 2, 3, 4, 5, 8, 9, 16, 17, 47, 48, 49]) strings.push(mixed(n));
const bytes = (t) => Buffer.byteLength(t, 'utf8');
const vectors = strings.map((t) => {
  const h = BigInt(Bun.hash(t));
  return { s: t, bytes: bytes(t), hash64: h.toString(), hash32: Number(h & 0xffffffffn) };
});
writeFileSync(out, JSON.stringify({ runtime: `bun ${Bun.version} Bun.hash`, count: vectors.length, vectors }, null, 0) + '\n');
console.log(`wrote ${vectors.length} vectors to tests/fixtures/wyhash-bun.json; byte lengths ${Math.min(...vectors.map((v) => v.bytes))}..${Math.max(...vectors.map((v) => v.bytes))}`);
