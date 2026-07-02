// Build data/lines.json — every usable dialogue line from the extracted subtitles,
// keyed by episode code (mirrors data/episodes.json's shape). Each entry is a
// [timecode, line] pair, where the timecode is the cue's start time as MM:SS:
//
//   { "S01E01": [["00:05", "Mom, Dad, I found cigarettes in Greg's jacket."], ...], ... }
//
// This is the file the bot reads at runtime, so it never has to parse SRTs. Run it
// whenever the subtitles change:
//
//   node scripts/build-lines-index.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUBS_DIR = path.join(__dirname, '..', 'subtitles');
const OUT = path.join(__dirname, '..', 'data', 'lines.json');

// Strip SRT/ASS markup and decode the few entities that show up in these files.
function clean(text) {
  return text
    .replace(/<[^>]+>/g, '')            // <i>, <b>, <font ...>
    .replace(/\{\\[^}]*\}/g, '')        // leftover ASS override tags {\an8}
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// A cue is dialogue if, once music notes / bracketed sound cues are removed,
// there's an actual word left. Filters out "♪ ♪", "[ groans ]", "( sighs )", etc.
function isDialogue(text) {
  const speech = text
    .replace(/♪/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  return /[A-Za-z0-9]/.test(speech);
}

// "HH:MM:SS,mmm" (SRT start time) -> "MM:SS" (total minutes, so >59 min is fine).
function toTimecode(stamp) {
  const m = stamp.match(/(\d+):(\d+):(\d+)/);
  if (!m) return '00:00';
  const total = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// Parse one .srt into [timecode, line] pairs.
function parseSrt(raw) {
  const cues = [];
  for (const block of raw.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const timing = lines.find((l) => l.includes('-->'));
    if (!timing) continue;
    const time = toTimecode(timing.split('-->')[0]);
    const textLines = lines.filter(
      (l) => !/^\d+$/.test(l.trim()) && !l.includes('-->'),
    );
    if (!textLines.length) continue;
    // Join caption word-wrap into one line (\n -> space), but keep the break
    // before a "- " dialogue dash so two-speaker cues stay on separate lines.
    const joined = textLines.join('\n').replace(/\n(?!\s*-)/g, ' ');
    const text = clean(joined);
    if (text && isDialogue(text)) cues.push([time, text]);
  }
  return cues;
}

const codeFromFilename = (name) => {
  const m = name.match(/S(\d{2})E(\d{2})/i);
  return m ? `S${m[1]}E${m[2]}`.toUpperCase() : null;
};

const files = fs.globSync('**/*.srt', { cwd: SUBS_DIR }).sort();
if (!files.length) {
  console.error(`No .srt files under ${SUBS_DIR} — run scripts/extract_subs.py first.`);
  process.exit(1);
}

const byEpisode = {};
let totalLines = 0;
for (const rel of files) {
  const code = codeFromFilename(path.basename(rel));
  if (!code) {
    console.warn(`skip (no SxxExx): ${rel}`);
    continue;
  }
  const lines = parseSrt(fs.readFileSync(path.join(SUBS_DIR, rel), 'utf8'));
  if (!lines.length) continue;
  // Merge if an episode somehow spans multiple files.
  byEpisode[code] = (byEpisode[code] || []).concat(lines);
  totalLines += lines.length;
}

// Write keyed by episode, one [timecode, line] pair per row so diffs stay readable.
const codes = Object.keys(byEpisode).sort();
const body = codes
  .map((code) => `${JSON.stringify(code)}: [\n` +
    byEpisode[code].map((pair) => `  ${JSON.stringify(pair)}`).join(',\n') + '\n]')
  .join(',\n');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `{\n${body}\n}\n`);

const sizeMB = (fs.statSync(OUT).size / 1e6).toFixed(1);
console.log(`Wrote ${totalLines} lines from ${codes.length} episodes to ${OUT} (${sizeMB} MB)`);
