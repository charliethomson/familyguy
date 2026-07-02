// Runtime access to the precomputed subtitle lines. The heavy lifting (parsing
// SRTs, cleaning, filtering) happens offline in scripts/build-lines-index.js; here
// we just read data/lines.json ([timecode, line] pairs keyed by episode) and
// data/episodes.json (title + year per episode), then serve random lines.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');

let pool = null;      // [{ code, time, text }]
let episodes = {};

function load() {
  if (pool) return pool;
  pool = [];
  try {
    const lines = JSON.parse(fs.readFileSync(path.join(DATA, 'lines.json'), 'utf8'));
    episodes = JSON.parse(fs.readFileSync(path.join(DATA, 'episodes.json'), 'utf8'));
    for (const [code, entries] of Object.entries(lines)) {
      for (const [time, text] of entries) pool.push({ code, time, text });
    }
  } catch (err) {
    console.error(`Could not load subtitle data — run the build scripts. ${err.message}`);
  }
  return pool;
}

export function randomFunnyMoment() {
  const p = load();
  if (!p.length) return null;
  const { code, time, text } = p[Math.floor(Math.random() * p.length)];
  const meta = episodes[code] || {};
  return {
    text,
    time,
    code,
    title: meta.title || 'Unknown',
    year: meta.year || null,
    season: meta.season,
    episode: meta.episode,
  };
}

// Requested layout, with the timecode appended:
//   "<line>"
//   SxxExx - <title> (<year>) · MM:SS
export function formatFunnyMoment(m) {
  const yr = m.year ? ` (${m.year})` : '';
  const line = m.text.replace(/^"([\s\S]*)"$/, '$1'); // avoid ""double quotes""
  return `"${line}"\n*${m.code} - ${m.title}${yr} · ${m.time}*`;
}

export function poolStats() {
  const p = load();
  const eps = new Set(p.map((m) => m.code));
  return { lines: p.length, episodes: eps.size };
}
