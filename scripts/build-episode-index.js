// Build data/episodes.json — a map of "SxxExx" -> { code, season, episode, title, year }
// parsed from the Kodi/Jellyfin .nfo files that sit next to each episode on the NAS.
// Run once (needs the media volume mounted); the JSON is committed so the bot never
// needs the NAS at runtime.
//
//   node scripts/build-episode-index.js [showDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Directory of episodes with sidecar .nfo files. Pass as argv[2] or set SHOW_DIR.
const SHOW_DIR = process.argv[2] || process.env.SHOW_DIR || 'Family Guy';
const OUT = path.join(__dirname, '..', 'data', 'episodes.json');

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
   .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
};

const nfos = fs.globSync('**/*.nfo', { cwd: SHOW_DIR })
  .filter((f) => !/(^|\/)(season|tvshow)\.nfo$/i.test(f));

const episodes = {};
let skipped = 0;
for (const rel of nfos) {
  const se = path.basename(rel).match(/S(\d{2})E(\d{2})/i);
  if (!se) { skipped++; continue; }
  const xml = fs.readFileSync(path.join(SHOW_DIR, rel), 'utf8');
  const code = `S${se[1]}E${se[2]}`.toUpperCase();
  const year = tag(xml, 'year') || (tag(xml, 'premiered') || tag(xml, 'aired')).slice(0, 4);
  episodes[code] = {
    code,
    season: parseInt(se[1], 10),
    episode: parseInt(se[2], 10),
    title: tag(xml, 'title') || code,
    year: year || null,
  };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(episodes, null, 2) + '\n');
console.log(`Wrote ${Object.keys(episodes).length} episodes to ${OUT} (skipped ${skipped} without SxxExx)`);
