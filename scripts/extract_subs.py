#!/usr/bin/env python3
"""Extract English subtitles from every Family Guy .mkv into the repo.

Parallel, configurable worker count, and resumable: episodes whose .srt already
exists (and is non-empty) are skipped, so re-running picks up where it left off.

A tiny Flask dashboard auto-opens in your browser and live-updates with progress,
counts, throughput, and a running log. Disable it with --no-dashboard.

Usage:
    ./.venv/bin/python scripts/extract_subs.py [--workers N] [--src DIR]
        [--out DIR] [--sdh] [--overwrite] [--dry-run]
        [--no-dashboard] [--port 5055] [--no-open]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import subprocess
import sys
import threading
import time
import webbrowser
from collections import deque
from pathlib import Path

# Directory of .mkv episodes. Point --src (or the SHOW_DIR env var) at yours.
DEFAULT_SRC = os.environ.get("SHOW_DIR", "Family Guy")
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "subtitles"


# --------------------------------------------------------------------------- #
# Extraction
# --------------------------------------------------------------------------- #
def probe_english_streams(mkv: Path) -> list[dict]:
    """Return English subtitle streams as [{index, title}], in file order."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "s",
        "-show_entries", "stream=index,codec_name:stream_tags=language,title",
        "-of", "json", str(mkv),
    ]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or "ffprobe failed")
    streams = json.loads(out.stdout or "{}").get("streams", [])
    eng = []
    for s in streams:
        tags = s.get("tags", {}) or {}
        if (tags.get("language") or "").lower() == "eng":
            eng.append({"index": s["index"], "codec": s.get("codec_name", ""),
                        "title": tags.get("title", "") or ""})
    return eng


def pick_stream(eng: list[dict], want_sdh: bool) -> dict | None:
    """Pick the target stream. Prefer plain dialogue; SDH is fallback
    (or the primary choice when --sdh is passed)."""
    if not eng:
        return None
    sdh = [e for e in eng if "sdh" in e["title"].lower()]
    plain = [e for e in eng if "sdh" not in e["title"].lower()]
    if want_sdh:
        return (sdh or plain)[0]
    return (plain or sdh)[0]


def extract_one(mkv: Path, src_root: Path, out_root: Path,
                want_sdh: bool, overwrite: bool, dry_run: bool) -> tuple[str, str]:
    """Returns (status, detail). status in {ok, skip, no-eng, fail}."""
    rel = mkv.relative_to(src_root)
    dest = out_root / rel.with_suffix(".srt")
    dest.parent.mkdir(parents=True, exist_ok=True)

    if dest.exists() and dest.stat().st_size > 0 and not overwrite:
        return "skip", str(rel.with_suffix(".srt"))

    try:
        eng = probe_english_streams(mkv)
    except Exception as e:  # noqa: BLE001
        return "fail", f"{rel}: probe: {e}"

    stream = pick_stream(eng, want_sdh)
    if stream is None:
        return "no-eng", str(rel)
    idx, codec = stream["index"], stream["codec"]

    if dry_run:
        mode = "copy" if codec == "subrip" else "transcode"
        return "ok", f"{rel.with_suffix('.srt')} (stream {idx}, {codec}, {mode}, dry-run)"

    tmp = dest.with_suffix(".srt.part")

    def run(codec_arg: str) -> subprocess.CompletedProcess:
        # -f srt is required: ffmpeg can't infer the muxer from the .part suffix.
        return subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(mkv),
             "-map", f"0:{idx}", "-c:s", codec_arg, "-f", "srt", str(tmp)],
            capture_output=True, text=True)

    # Extraction is network-bound: ffmpeg reads the whole file over SMB regardless
    # of copy vs transcode (subtitle events are scattered across every cluster).
    # For subrip, copy is a lossless passthrough; ass etc. must transcode into srt.
    # Fall back to transcode if a copy unexpectedly fails.
    if codec == "subrip":
        res = run("copy")
        if res.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
            res = run("srt")
    else:
        res = run("srt")

    if res.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        return "fail", f"{rel}: ffmpeg: {res.stderr.strip()[:200]}"
    tmp.replace(dest)
    return "ok", str(rel.with_suffix(".srt"))


# --------------------------------------------------------------------------- #
# Shared state (thread-safe)
# --------------------------------------------------------------------------- #
class State:
    def __init__(self, total: int, workers: int, out: Path):
        self.lock = threading.Lock()
        self.total = total
        self.workers = workers
        self.out = str(out)
        self.done = 0
        self.counts = {"ok": 0, "skip": 0, "no-eng": 0, "fail": 0}
        self.log: deque[dict] = deque(maxlen=400)
        self.failures: list[str] = []
        self.start = time.time()
        self.finished = False

    def record(self, status: str, detail: str):
        with self.lock:
            self.done += 1
            self.counts[status] += 1
            n = self.done
            if status in ("fail", "no-eng"):
                self.failures.append(f"{status.upper()}  {detail}")
            self.log.appendleft({"n": n, "status": status, "detail": detail,
                                 "t": time.time() - self.start})

    def snapshot(self) -> dict:
        with self.lock:
            elapsed = time.time() - self.start
            processed = self.counts["ok"] + self.counts["fail"] + self.counts["no-eng"]
            rate = processed / elapsed if elapsed > 0 else 0
            remaining = self.total - self.done
            eta = remaining / rate if rate > 0 else None
            return {
                "total": self.total,
                "done": self.done,
                "workers": self.workers,
                "out": self.out,
                "counts": dict(self.counts),
                "elapsed": elapsed,
                "rate": rate,
                "eta": eta,
                "finished": self.finished,
                "log": list(self.log)[:120],
                "failures": self.failures[-50:],
            }


# --------------------------------------------------------------------------- #
# Dashboard (Flask)
# --------------------------------------------------------------------------- #
DASHBOARD_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>Subtitle Extraction</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         background:#0d1117; color:#e6edf3; }
  header { padding:18px 24px; border-bottom:1px solid #21262d; display:flex;
           align-items:center; gap:12px; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  header .dot { width:10px; height:10px; border-radius:50%; background:#3fb950;
                box-shadow:0 0 8px #3fb950; animation:pulse 1.5s infinite; }
  header .dot.done { background:#8b949e; box-shadow:none; animation:none; }
  @keyframes pulse { 50% { opacity:.3; } }
  .wrap { padding:24px; max-width:1100px; margin:0 auto; }
  .bar { height:26px; background:#161b22; border-radius:6px; overflow:hidden;
         border:1px solid #21262d; }
  .bar > div { height:100%; background:linear-gradient(90deg,#1f6feb,#388bfd);
               width:0; transition:width .4s ease; }
  .pct { text-align:center; margin:8px 0 20px; font-size:13px; color:#8b949e; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr));
           gap:12px; margin-bottom:24px; }
  .card { background:#161b22; border:1px solid #21262d; border-radius:8px; padding:14px; }
  .card .k { font-size:12px; color:#8b949e; text-transform:uppercase;
             letter-spacing:.5px; }
  .card .v { font-size:24px; font-weight:600; margin-top:4px; }
  .v.ok{color:#3fb950} .v.skip{color:#d29922} .v.fail{color:#f85149} .v.none{color:#db6d28}
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.5px; color:#8b949e;
       margin:24px 0 8px; }
  .log { background:#010409; border:1px solid #21262d; border-radius:8px;
         font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; padding:12px;
         max-height:340px; overflow:auto; }
  .row { display:flex; gap:10px; white-space:nowrap; }
  .row .tag { flex:0 0 46px; font-weight:600; }
  .tag.ok{color:#3fb950} .tag.skip{color:#d29922} .tag.fail{color:#f85149} .tag.none{color:#db6d28}
  .row .d { color:#c9d1d9; overflow:hidden; text-overflow:ellipsis; }
  .row .n { flex:0 0 62px; color:#6e7681; }
  .fail-box { border-color:#5c1f1f; }
  .muted { color:#6e7681; }
</style></head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <h1>Family Guy — Subtitle Extraction</h1>
  <span class="muted" id="sub"></span>
</header>
<div class="wrap">
  <div class="bar"><div id="fill"></div></div>
  <div class="pct" id="pct">starting…</div>
  <div class="cards">
    <div class="card"><div class="k">Extracted</div><div class="v ok" id="c-ok">0</div></div>
    <div class="card"><div class="k">Skipped</div><div class="v skip" id="c-skip">0</div></div>
    <div class="card"><div class="k">No English</div><div class="v none" id="c-none">0</div></div>
    <div class="card"><div class="k">Failed</div><div class="v fail" id="c-fail">0</div></div>
    <div class="card"><div class="k">Rate</div><div class="v" id="c-rate">—</div></div>
    <div class="card"><div class="k">ETA</div><div class="v" id="c-eta">—</div></div>
  </div>
  <h2>Activity</h2>
  <div class="log" id="log"></div>
  <h2 id="fh" style="display:none">Problems</h2>
  <div class="log fail-box" id="failbox" style="display:none"></div>
</div>
<script>
const fmt = s => { if(s==null) return "—"; s=Math.round(s);
  const m=Math.floor(s/60), r=s%60; return m? m+"m "+r+"s" : r+"s"; };
async function tick() {
  let d; try { d = await (await fetch("/api/status")).json(); } catch(e) { return; }
  const pct = d.total ? (d.done/d.total*100) : 0;
  document.getElementById("fill").style.width = pct+"%";
  document.getElementById("pct").textContent =
    d.done+" / "+d.total+" ("+pct.toFixed(1)+"%) · "+fmt(d.elapsed)+" elapsed";
  document.getElementById("sub").textContent = d.workers+" workers · "+d.out;
  document.getElementById("c-ok").textContent = d.counts.ok;
  document.getElementById("c-skip").textContent = d.counts.skip;
  document.getElementById("c-none").textContent = d.counts["no-eng"];
  document.getElementById("c-fail").textContent = d.counts.fail;
  document.getElementById("c-rate").textContent = d.rate ? d.rate.toFixed(2)+"/s" : "—";
  document.getElementById("c-eta").textContent = d.finished ? "done" : fmt(d.eta);
  const dot = document.getElementById("dot");
  if (d.finished) dot.classList.add("done");
  const tagClass = s => s==="no-eng" ? "none" : s;
  document.getElementById("log").innerHTML = d.log.map(e =>
    `<div class="row"><span class="n">${e.n}</span>`+
    `<span class="tag ${tagClass(e.status)}">${e.status}</span>`+
    `<span class="d">${e.detail.replace(/</g,"&lt;")}</span></div>`).join("");
  if (d.failures.length) {
    document.getElementById("fh").style.display="block";
    const fb=document.getElementById("failbox");
    fb.style.display="block";
    fb.innerHTML = d.failures.map(f=>`<div class="row"><span class="d">${f.replace(/</g,"&lt;")}</span></div>`).join("");
  }
}
tick(); setInterval(tick, 1000);
</script>
</body></html>"""


def start_dashboard(state: State, port: int, host: str = "127.0.0.1"):
    """Serve the dashboard from the stdlib http.server — no third-party deps,
    so it runs anywhere Python does (e.g. a bare VM without pip/flask)."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    html = DASHBOARD_HTML.encode()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # silence request logging
            pass

        def _send(self, body: bytes, ctype: str):
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path.startswith("/api/status"):
                self._send(json.dumps(state.snapshot()).encode(), "application/json")
            elif self.path == "/" or self.path.startswith("/index"):
                self._send(html, "text/html; charset=utf-8")
            else:
                self.send_response(404)
                self.end_headers()

    srv = ThreadingHTTPServer((host, port), Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return t


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workers", type=int, default=4,
                    help="parallel extraction workers (default: 4)")
    ap.add_argument("--src", default=DEFAULT_SRC, help="show root directory")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="output directory")
    ap.add_argument("--sdh", action="store_true",
                    help="prefer the SDH English track instead of plain dialogue")
    ap.add_argument("--overwrite", action="store_true",
                    help="re-extract even if the .srt already exists")
    ap.add_argument("--dry-run", action="store_true",
                    help="probe and report, but do not write files")
    ap.add_argument("--no-dashboard", action="store_true", help="disable the web dashboard")
    ap.add_argument("--port", type=int, default=5055, help="dashboard port (default: 5055)")
    ap.add_argument("--host", default="127.0.0.1",
                    help="dashboard bind address (use 0.0.0.0 to expose on the network)")
    ap.add_argument("--no-open", action="store_true", help="don't auto-open the browser")
    args = ap.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    if not src.is_dir():
        print(f"error: source not found: {src}", file=sys.stderr)
        return 2
    out.mkdir(parents=True, exist_ok=True)

    mkvs = sorted(src.rglob("*.mkv"))
    if not mkvs:
        print(f"error: no .mkv files under {src}", file=sys.stderr)
        return 2

    total = len(mkvs)
    state = State(total, args.workers, out)

    if not args.no_dashboard:
        start_dashboard(state, args.port, args.host)
        url = f"http://127.0.0.1:{args.port}"
        print(f"Dashboard: {url}  (bound {args.host}:{args.port})")
        if not args.no_open:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    print(f"Found {total} episodes. Workers: {args.workers}. Output: {out}")

    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {
            ex.submit(extract_one, m, src, out, args.sdh, args.overwrite, args.dry_run): m
            for m in mkvs
        }
        for fut in cf.as_completed(futs):
            status, detail = fut.result()
            state.record(status, detail)
            snap_done = state.done
            tag = {"ok": "OK  ", "skip": "SKIP", "no-eng": "NONE", "fail": "FAIL"}[status]
            print(f"[{snap_done}/{total}] {tag} {detail}")

    with state.lock:
        state.finished = True
        c = dict(state.counts)
        failures = list(state.failures)

    (out / "extract.log").write_text("\n".join(failures) + ("\n" if failures else ""))
    print("\n---")
    print(f"total={total} extracted={c['ok']} skipped={c['skip']} "
          f"no-eng={c['no-eng']} failed={c['fail']}")
    if failures:
        print(f"{len(failures)} problem(s) logged to {out / 'extract.log'}")

    if not args.no_dashboard:
        print(f"\nDashboard still live at http://127.0.0.1:{args.port} — Ctrl+C to exit.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nbye")
    return 0 if c["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
