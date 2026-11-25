// Field Ledger entry point (Node 22, standard library only).
//
// Reads the sealed snapshot at /input/snapshot.json, writes /output/board.json and
// /output/data.js, copies dashboard/ and screenshots/ into /output, then writes
// /output/dossier.json with the vendored buildDossier. No network. Two runs write
// the same bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Width and height of a PNG or JPEG, or null when the bytes are not one. */
function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1] ?? 0;
    if (marker === 0xd8) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const len = buf.readUInt16BE(i + 2);
    const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (sof) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`field ledger: no snapshot at ${inputFile}\n`);
  process.exit(2);
}

const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`field ledger: the board was refused: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ as_of: snapshot.as_of, model_version: radar.model_version, rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((name) => !name.startsWith('.')).sort();
  const copied: string[] = [];
  for (const name of names) {
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFlat(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`field ledger: screenshots/ holds ${shots.length} images; hand in 3 or 4\n`);
  process.exit(1);
}
const imageName = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
for (const name of shots) {
  if (!imageName.test(name)) {
    process.stderr.write(`field ledger: screenshots/${name} is not a plain file name\n`);
    process.exit(1);
  }
  const buf = readFileSync(join(out, 'screenshots', name));
  if (buf.length > 512 * 1024) {
    process.stderr.write(`field ledger: screenshots/${name} is ${buf.length} bytes\n`);
    process.exit(1);
  }
  const dim = imageSize(buf);
  if (dim === null) {
    process.stderr.write(`field ledger: screenshots/${name} is not a whole PNG or JPEG\n`);
    process.exit(1);
  }
  const long = Math.max(dim.w, dim.h);
  const short = Math.min(dim.w, dim.h);
  if (long > 1440 || short < 800) {
    process.stderr.write(`field ledger: screenshots/${name} is ${dim.w}×${dim.h}\n`);
    process.exit(1);
  }
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65536 }));
process.stdout.write(
  `field ledger: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} ranked (${radar.counts.early} early, ${radar.counts.derivative} derivatives set aside)\n`,
);
