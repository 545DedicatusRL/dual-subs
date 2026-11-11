/* Shared, dependency-free data handling. Loaded independently in each execution world. */
(() => {
  'use strict';
  const DEFAULTS = Object.freeze({enabled: true, secondary: null, primaryScale: 100, secondaryScale: 80, gap: 8, bottom: 8, background: 35, noBackground: false, alignTimings: true, showIndicator: true, color: '#ffffff', offset: 0});
  const TEXT_PROFILES = ['webvtt-lssdh-ios8', 'simplesdh', 'dfxp-ls-sdh', 'imsc1.1'];
  const CDN_DOMAINS = ['netflix.com', 'nflxvideo.net', 'nflxso.net', 'nflximg.net'];
  const bounded = (v, low, high, fallback) => Number.isFinite(Number(v)) ? Math.min(high, Math.max(low, Number(v))) : fallback;
  function safeURL(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && CDN_DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.' + d));
    } catch { return false; }
  }
  function cleanSettings(input = {}) {
    const d = DEFAULTS;
    const s = input.secondary;
    return {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : d.enabled,
      secondary: s && typeof s.language === 'string' && s.language.length < 80 ? {language: s.language, type: String(s.type || 'subtitles').slice(0, 60), forced: !!s.forced, variant: String(s.variant || '').slice(0, 80)} : null,
      primaryScale: bounded(input.primaryScale ?? d.primaryScale, 50, 250, d.primaryScale),
      secondaryScale: bounded(input.secondaryScale ?? d.secondaryScale, 40, 200, d.secondaryScale),
      gap: bounded(input.gap ?? d.gap, 0, 32, d.gap),
      bottom: bounded(input.bottom ?? d.bottom, 2, 30, d.bottom),
      background: bounded(input.background ?? d.background, 0, 90, d.background),
      noBackground: typeof input.noBackground === 'boolean' ? input.noBackground : d.noBackground,
      alignTimings: typeof input.alignTimings === 'boolean' ? input.alignTimings : d.alignTimings,
      showIndicator: typeof input.showIndicator === 'boolean' ? input.showIndicator : d.showIndicator,
      color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : d.color,
      offset: bounded(input.offset ?? d.offset, -10, 10, d.offset)
    };
  }
  function trackId(raw) { return String(raw?.trackId ?? raw?.new_track_id ?? raw?.id ?? ''); }
  function sources(raw) {
    const all = [];
    const add = (profile, payload) => {
      if (!TEXT_PROFILES.includes(profile) || payload?.isImage) return;
      const entries = payload?.urls || payload?.downloadUrls || [];
      for (const entry of Object.values(entries)) {
        const url = typeof entry === 'string' ? entry : entry?.url;
        if (safeURL(url)) all.push({profile, url});
      }
    };
    for (const [p, data] of Object.entries(raw?.ttDownloadables || {})) add(p, data);
    if (raw?.profile) add(raw.profile, raw);
    return mergeSources(all);
  }
  function mergeSources(...groups) {
    const seen = new Set();
    return groups.flat().filter(x => x && TEXT_PROFILES.includes(x.profile) && safeURL(x.url) && !seen.has(x.url) && seen.add(x.url))
      .sort((a, b) => TEXT_PROFILES.indexOf(a.profile) - TEXT_PROFILES.indexOf(b.profile)).slice(0, 12);
  }
  function normalizeTrack(raw, index = 0) {
    if (!raw || raw.isNoneTrack || raw.languageDescription === 'Off' || raw.displayName === 'Off' || trackId(raw) === 'none') return null;
    const language = String(raw.bcp47 || raw.language || '').slice(0, 80);
    if (!language) return null;
    const rawType = String(raw.rawTrackType || raw.trackType || '').toLowerCase();
    const type = /caption|sdh/.test(rawType) ? 'closedcaptions' : 'subtitles';
    const forced = !!raw.isForcedNarrative || /forced/.test(rawType);
    const variant = String(raw.trackVariant ?? '');
    let label = String(raw.displayName || raw.languageDescription || language).slice(0, 160);
    if (type === 'closedcaptions' && !/\b(CC|SDH)\b/i.test(label)) label += ' [CC]';
    if (forced && !/forced/i.test(label)) label += ' [forced only]';
    return {id: trackId(raw) || `${language}:${type}:${forced}:${variant}:${index}`, language, label, type, forced, variant, sources: sources(raw)};
  }
  function preference(track) { return track ? {language: track.language, type: track.type, forced: track.forced, variant: track.variant} : null; }
  function findPreferred(tracks, pref) {
    if (!pref) return null;
    // Never silently change region, writing system, captions, or forced-only status.
    return tracks.find(t => t.language.toLowerCase() === pref.language.toLowerCase() && t.type === pref.type && t.forced === pref.forced && t.variant === (pref.variant || '')) || null;
  }
  function sameTrack(a, b) { return !!a && !!b && (a.id === b.id || (a.language === b.language && a.type === b.type && a.forced === b.forced && a.variant === b.variant)); }
  const api = {DEFAULTS, TEXT_PROFILES, safeURL, cleanSettings, trackId, sources, mergeSources, normalizeTrack, preference, findPreferred, sameTrack};
  globalThis.DualSubsCore = Object.freeze(api);
  if (typeof module !== 'undefined') module.exports = api;
})();
