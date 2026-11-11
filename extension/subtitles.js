(() => {
  'use strict';
  function time(value, rates = {tick: 1, frame: 30, subframe: 1}) {
    if (!value) return NaN;
    const v = value.trim();
    let m = v.match(/^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/);
    if (m) return Number(m[1]) * ({h: 3600, m: 60, s: 1, ms: .001, f: 1 / rates.frame, t: 1 / rates.tick}[m[2]]);
    m = v.match(/^(?:(\d+):)?(\d{2}):(\d{2})([.,]\d+)?$/);
    if (m) return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] || '0').replace(',', '.'));
    m = v.match(/^(\d+):(\d{2}):(\d{2}):(\d+)(?:\.(\d+))?$/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (Number(m[4]) + Number(m[5] || 0) / rates.subframe) / rates.frame : NaN;
  }
  function entities(s) {
    return s.replace(/&(amp|lt|gt|nbsp|quot|apos|lrm|rlm|#\d+|#x[0-9a-f]+);/gi, (all, name) => {
      // Keep bidi marks as invisible Unicode characters so RTL text retains its direction.
      if (name[0] !== '#') return ({amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', quot: '"', apos: "'", lrm: '\u200e', rlm: '\u200f'})[name.toLowerCase()];
      const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
    });
  }
  function parseVTT(input) {
    const cues = [];
    for (const block of input.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
      const lines = block.trim().split('\n');
      if (/^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
      const at = lines.findIndex(l => l.includes('-->'));
      if (at < 0) continue;
      const m = lines[at].match(/^(\S+)\s+-->\s+(\S+)/);
      if (!m) continue;
      const start = time(m[1]), end = time(m[2]);
      const text = entities(lines.slice(at + 1).join('\n').replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')).trim();
      if (Number.isFinite(start) && end > start && text) cues.push({start, end, text});
    }
    return cues;
  }
  function attr(node, name) { return Array.from(node.attributes || []).find(a => a.localName === name)?.value || ''; }
  function parseTTML(input) {
    const doc = new DOMParser().parseFromString(input, 'application/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'tt') throw new Error('Invalid TTML subtitle file.');
    const root = doc.documentElement;
    const multiplier = attr(root, 'frameRateMultiplier').split(/\s+/).map(Number);
    const frame = (Number(attr(root, 'frameRate')) || 30) * (multiplier.length === 2 && multiplier[1] ? multiplier[0] / multiplier[1] : 1);
    const rates = {frame, subframe: Number(attr(root, 'subFrameRate')) || 1, tick: Number(attr(root, 'tickRate')) || (attr(root, 'timeBase') === 'smpte' ? frame : 1)};
    const cues = [];
    function interval(node, parent) {
      const begin = attr(node, 'begin'), end = attr(node, 'end'), dur = attr(node, 'dur');
      const start = parent.start + (begin ? time(begin, rates) : 0);
      return {start, end: Math.min(parent.end, end ? parent.start + time(end, rates) : dur ? start + time(dur, rates) : Infinity)};
    }
    function walk(node, parent) {
      if (node.nodeType !== 1) return;
      if (attr(node, 'timeContainer') === 'seq') throw new Error('Sequential TTML timing is not supported. Choose another subtitle track.');
      const range = interval(node, parent);
      if (node.localName === 'p') {
        const boundaries = new Set([range.start, range.end]);
        const spans = new Map();
        function scan(el, inherited) {
          for (const child of el.children) {
            const timing = interval(child, inherited);
            spans.set(child, timing);
            if (timing.start > range.start && timing.start < range.end) boundaries.add(timing.start);
            if (timing.end > range.start && timing.end < range.end) boundaries.add(timing.end);
            scan(child, timing);
          }
        }
        scan(node, range);
        const points = [...boundaries].sort((a, b) => a - b);
        for (let i = 0; i + 1 < points.length; i++) {
          const start = points[i], end = points[i + 1];
          // A sentinel preserves explicit <br> while collapsing XML indentation.
          const text = textAtWithBreaks(node, start);
          if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) cues.push({start, end, text});
        }
        function textAtWithBreaks(el, at) {
          function read(n) {
            if (n.nodeType === 3) return n.textContent;
            if (n.nodeType !== 1 || ['metadata', 'image', 'data'].includes(n.localName) || attr(n, 'ruby') === 'text') return '';
            const r = spans.get(n);
            if (r && !(at >= r.start && at < r.end)) return '';
            return n.localName === 'br' ? '\u000b' : Array.from(n.childNodes).map(read).join('');
          }
          return read(el).replace(/[ \t\r\n]+/g, ' ').replace(/ *\u000b */g, '\n').trim();
        }
      } else for (const child of node.children) walk(child, range);
    }
    const body = Array.from(root.children).find(n => n.localName === 'body');
    if (body) walk(body, {start: 0, end: Infinity});
    return cues;
  }
  class Timeline {
    constructor(cues) {
      this.cues = cues.sort((a, b) => a.start - b.start || a.end - b.end);
      let max = 0;
      this.maxEnd = this.cues.map(c => max = Math.max(max, c.end));
    }
    at(t) {
      let lo = 0, hi = this.cues.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.cues[mid].start <= t) lo = mid + 1; else hi = mid; }
      const active = [];
      for (let i = lo - 1; i >= 0 && this.maxEnd[i] > t; i--) if (this.cues[i].end > t) active.push(this.cues[i]);
      return [...new Set(active.reverse().map(c => c.text))].join('\n');
    }
  }
  function alignToPrimary(secondary, primary, tolerance = .2) {
    if (!primary?.cues.length || !secondary?.cues.length || tolerance <= 0) return secondary;
    const refs = primary.cues, originals = secondary.cues, used = new Set();
    const adjusted = originals.map(cue => {
      let lo = 0, hi = refs.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (refs[mid].start < cue.start - tolerance - 1e-9) lo = mid + 1; else hi = mid; }
      let best = -1, score = Infinity;
      for (let i = lo; i < refs.length && refs[i].start <= cue.start + tolerance + 1e-9; i++) {
        const ref = refs[i], endDelta = Math.abs(ref.end - cue.end);
        const durationRatio = (ref.end - ref.start) / (cue.end - cue.start);
        if (used.has(i) || endDelta > tolerance + 1e-9 || durationRatio < 2 / 3 || durationRatio > 1.5 || Math.min(ref.end, cue.end) <= Math.max(ref.start, cue.start)) continue;
        const candidate = Math.abs(ref.start - cue.start) + endDelta;
        if (candidate < score) { best = i; score = candidate; }
      }
      if (best < 0) return {...cue};
      used.add(best);
      return {...cue, start: refs[best].start, end: refs[best].end};
    });
    // Do not introduce overlapping secondary lines where the original track had a gap.
    // Each reverted cue adds at most its two adjacent pairs, keeping this pass linear.
    const pairs = originals.slice(1).map((_, i) => i + 1), reverted = new Set();
    for (let at = 0; at < pairs.length; at++) {
      const i = pairs[at];
      if (i <= 0 || i >= originals.length || originals[i - 1].end > originals[i].start || adjusted[i - 1].end <= adjusted[i].start) continue;
      for (const index of [i - 1, i]) {
        if (reverted.has(index)) continue;
        reverted.add(index); adjusted[index] = {...originals[index]};
        pairs.push(index, index + 1);
      }
    }
    return new Timeline(adjusted);
  }
  function parse(input) {
    const text = input.replace(/^\ufeff/, '').trim();
    const cues = text.startsWith('<') ? parseTTML(text) : /^WEBVTT(?:\s|$)/.test(text) ? parseVTT(text) : [];
    if (!cues.length) throw new Error('This Netflix track has no readable text cues. Image and binary subtitles are not supported.');
    return new Timeline(cues);
  }
  const api = {time, parseVTT, parseTTML, parse, Timeline, alignToPrimary};
  globalThis.DualSubsSubtitles = Object.freeze(api);
  if (typeof module !== 'undefined') module.exports = api;
})();
