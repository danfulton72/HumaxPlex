// Sidecar (external) text subtitles, rendered by us over a direct-played video,
// so an .srt next to the file never forces the server to transcode.

function ms(h, m, s, frac) {
  return ((+h * 60 + +m) * 60 + +s) * 1000 + Math.round(+('0.' + (frac || '0')) * 1000);
}

function clean(text) {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\N/gi, '\n')
    .trim();
}

function parseSrtOrVtt(text) {
  const cues = [];
  const re = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/g;
  let m;
  while ((m = re.exec(text))) {
    cues.push({ start: ms(m[1], m[2], m[3], m[4]), end: ms(m[5], m[6], m[7], m[8]), text: clean(m[9]) });
  }
  // WebVTT allows mm:ss.ttt without hours.
  if (!cues.length) {
    const short = /(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2})\.(\d{3})[^\n]*\n([\s\S]*?)(?:\n\s*\n|$)/g;
    while ((m = short.exec(text))) {
      cues.push({ start: ms(0, m[1], m[2], m[3]), end: ms(0, m[4], m[5], m[6]), text: clean(m[7]) });
    }
  }
  return cues;
}

function parseAss(text) {
  const cues = [];
  const lines = text.split(/\r?\n/);
  let textIndex = 9;
  for (const line of lines) {
    if (/^Format:/i.test(line) && /Text/i.test(line)) {
      const fields = line.slice(7).split(',').map(f => f.trim().toLowerCase());
      textIndex = fields.indexOf('text');
    }
    if (!/^Dialogue:/i.test(line)) continue;
    const parts = line.slice(9).split(',');
    const t = s => s.trim().match(/(\d+):(\d{2}):(\d{2})\.(\d{1,3})/);
    const a = t(parts[1]);
    const b = t(parts[2]);
    if (!a || !b) continue;
    cues.push({ start: ms(a[1], a[2], a[3], a[4]), end: ms(b[1], b[2], b[3], b[4]), text: clean(parts.slice(textIndex).join(',')) });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export function parseSubtitles(text, codec) {
  text = text.replace(/\r\n/g, '\n').replace(/^﻿/, '');
  if (codec === 'ass' || codec === 'ssa' || /^\[Script Info\]/m.test(text)) return parseAss(text);
  return parseSrtOrVtt(text);
}

// Finds the active cue for a playback position; cheap for monotonic playback,
// binary search after jumps.
export class CueTrack {
  constructor(cues) {
    this.cues = cues;
    this.i = 0;
  }

  at(t) {
    const cues = this.cues;
    if (!cues.length) return '';
    let i = this.i;
    if (i >= cues.length || cues[i].start > t || (i + 1 < cues.length && cues[i + 1].start <= t && t - cues[i].start > 30000)) {
      let lo = 0;
      let hi = cues.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (cues[mid].start <= t) lo = mid; else hi = mid - 1;
      }
      i = lo;
    }
    while (i + 1 < cues.length && cues[i + 1].start <= t) i++;
    this.i = i;
    const c = cues[i];
    if (c.start <= t && t < c.end) {
      // Overlapping cues (common in ASS) are shown together.
      let text = c.text;
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        if (cues[j].end > t && cues[j].text !== text) text = cues[j].text + '\n' + text;
      }
      return text;
    }
    return '';
  }
}
