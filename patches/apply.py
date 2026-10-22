#!/usr/bin/env python3
"""Copy upstream SamSUCKS web UI and adapt for Android 9."""
from pathlib import Path
import shutil
import sys

source = Path(sys.argv[1]).resolve()
dest = Path(sys.argv[2]).resolve()
assert (source / "app/js/screens/player.js").is_file(), "Expected upstream SamSUCKS checkout"
if dest.exists():
    shutil.rmtree(dest)
shutil.copytree(source / "app", dest)

def edit(path, old, new):
    f = dest / path
    data = f.read_text(encoding="utf-8")
    if old not in data:
        raise RuntimeError("Upstream has changed; patch no longer applies: " + path)
    f.write_text(data.replace(old, new), encoding="utf-8")

edit("index.html", '<script src="$WEBAPIS/webapis/webapis.js"></script>', "")
edit("index.html", "<title>SamSUCKS</title>", "<title>HumaxPlex</title>")
# Android WebView must expose its *actual* CSS viewport, not claim a 1920px viewport.
# app.js fitWindow() then scales the 1920x1080 UI to the measured device size.
edit("index.html", 'content="width=1920, height=1080"',
     'content="width=device-width, initial-scale=1.0, maximum-scale=1.0"')
edit("js/app.js", "import { isTizen, registerKeys } from './platform/tizen.js';",
     "import { isTizen, registerKeys } from './platform/tizen.js';\nimport { inject } from './input.js';".replace("\\n", "\n"))
edit("js/app.js", "  registerKeys();", "  registerKeys();\n  window.__androidAction = inject;".replace("\\n", "\n"))
edit("js/platform/tizen.js", "return { model, name, platform: isTizen ? 'Samsung' : 'Web' };",
     "return { model: 'FVP-4KGTR', name: 'Humax FVP-4KGTR', platform: 'Android' };")
edit("js/plex/client.js", "'X-Plex-Platform-Version': '6.5',", "'X-Plex-Platform-Version': '9',")
edit("js/plex/client.js", "export const PRODUCT = 'SamSUCKS';", "export const PRODUCT = 'HumaxPlex';")
edit("js/screens/player.js",
     "  container: { mp4: 1, m4v: 1, mov: 1, mkv: 1, webm: 1, ts: 1, mpegts: 1, avi: 1 },\n  video: { h264: 1, hevc: 1, vp9: 1, av1: 1, mpeg4: 1, mpeg2video: 1, vc1: 1 },\n  audio: { aac: 1, ac3: 1, eac3: 1, mp3: 1, mp2: 1, flac: 1, opus: 1, vorbis: 1, pcm: 1 },".replace("\\n","\n"),
     "  container: { mp4: 1, m4v: 1 },\n  video: { h264: 1 },\n  audio: { aac: 1, mp3: 1 },".replace("\\n","\n"))

old = """function fitWindow() {
  const root = document.documentElement;
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  root.style.position = 'relative'; // so the margins below move #app too
  root.style.zoom = s;
  root.style.marginLeft = Math.max(0, (innerWidth - 1920 * s) / 2 / s) + 'px';
  root.style.marginTop = Math.max(0, (innerHeight - 1080 * s) / 2 / s) + 'px';
}"""
new = """function fitWindow() {
  const root = document.documentElement;
  const body = document.body;
  // Some Android TV WebViews report physical-size innerWidth but logical-size screen.width.\n  // This Humax reports inner=1920x1080, screen=960x540, DPR=2.\n  const w = Math.min(window.innerWidth, window.screen.width || window.innerWidth);\n  const h = Math.min(window.innerHeight, window.screen.height || window.innerHeight);
  const scale = Math.min(w / 1920, h / 1080);
  root.style.zoom = '1';
  root.style.width = w + 'px';
  root.style.height = h + 'px';
  root.style.position = 'static';
  root.style.margin = '0';
  body.style.width = '1920px';
  body.style.height = '1080px';
  body.style.transformOrigin = 'top left';
  body.style.transform = 'translate(' + ((w - 1920 * scale) / 2) + 'px,' + ((h - 1080 * scale) / 2) + 'px) scale(' + scale + ')';
}"""
edit("js/app.js", old, new)

print("Prepared HumaxPlex app assets at", dest)
