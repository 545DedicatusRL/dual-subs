/* Netflix-page adapter. No extension APIs, credentials, decryption, or external requests here. */
(() => {
  'use strict';
  if (window.__dualSubsPageV101) { window.__dualSubsPageV101.refresh(); return; }
  const C = globalThis.DualSubsCore;
  const CHANNEL = 'dual-subs/v1';
  const nativeParse = JSON.parse;
  const nativeStringify = JSON.stringify;
  const catalogs = new Map();
  let lastSnapshot = '', lastMovie = '', busy = null, scanAt = 0;
  let connection = {apiFound: false, playerFound: false, sessionCount: 0};
  let enabled = true;
  const watchId = () => location.pathname.match(/^\/watch\/(\d+)/)?.[1] || '';
  const send = (type, data) => window.postMessage({channel: CHANNEL, from: 'page', type, ...data}, location.origin);
  function player() {
    connection = {apiFound: false, playerFound: false, sessionCount: 0};
    try {
      const api = window.netflix?.appContext?.state?.playerApp?.getAPI?.()?.videoPlayer;
      connection.apiFound = !!api;
      const raw = api?.getAllPlayerSessionIds?.() || [];
      const sessions = Array.isArray(raw) ? raw : [...raw];
      connection.sessionCount = sessions.length;
      const candidates = [];
      for (const session of sessions) {
        try {
          const candidate = api.getVideoPlayerBySessionId(session);
          if (candidate) candidates.push({candidate, session, id: movieId(candidate, '')});
        } catch { /* A preview session can disappear during discovery. */ }
      }
      // Session order and the word "watch" do not identify the active film.
      const exact = candidates.find(item => item.id === watchId());
      const unknown = candidates.filter(item => !item.id);
      const fallback = unknown.find(item => String(item.session).includes('watch')) || (candidates.length === 1 ? unknown[0] : null);
      const selected = exact || fallback;
      connection.playerFound = !!selected;
      return selected?.candidate || null;
    } catch { return null; }
  }
  function movieId(p, fallback = watchId()) { try { return String(p?.getMovieId?.() || fallback); } catch { return fallback; } }
  // Netflix fetches a manifest for every hover trailer and billboard on the browse
  // page. A tiny cache let those previews evict the title you then pressed play on,
  // which looked like "works only after a refresh". Keep many titles, LRU-ordered.
  const MAX_TITLES = 60;
  function bucket(id) {
    let data = catalogs.get(id);
    if (data) { catalogs.delete(id); catalogs.set(id, data); return data; }
    data = new Map();
    catalogs.set(id, data);
    while (catalogs.size > MAX_TITLES) catalogs.delete(catalogs.keys().next().value);
    return data;
  }
  // The manifest and the player's own track list can use different ID formats for
  // the same language. Unify them so the URLs from the manifest are never hidden
  // behind a duplicate, source-less entry from the player.
  const sameLanguage = (a, b) => a.language.toLowerCase() === b.language.toLowerCase() && a.type === b.type && a.forced === b.forced && (a.variant === b.variant || !a.variant || !b.variant);
  function merge(id, incoming) {
    if (!id) return;
    const data = bucket(id);
    for (const t of incoming) {
      if (!t) continue;
      let key = t.id, existing = data.get(key);
      if (!existing) for (const [k, v] of data) if (sameLanguage(v, t)) { key = k; existing = v; break; }
      const aliases = existing ? [...new Set([...(existing.aliases || []), ...(key !== t.id ? [t.id] : [])])].slice(0, 8) : [];
      data.set(key, existing ? {...existing, aliases, sources: C.mergeSources(existing.sources, t.sources)} : {...t, aliases});
    }
  }
  function findTrack(id, trackId) {
    const data = bucket(id);
    if (data.has(trackId)) return data.get(trackId);
    for (const t of data.values()) if (t.aliases?.includes(trackId)) return t;
    return null;
  }
  function inspectManifest(data) {
    // Inspect only a few known envelopes, never recursively walk every parsed response.
    const candidates = [data, data?.result, data?.value, data?.result?.value];
    for (const item of candidates) {
      if (Array.isArray(item?.timedtexttracks)) merge(String(item.movieId || item.viewableId || watchId()), item.timedtexttracks.map(C.normalizeTrack));
    }
  }
  JSON.parse = function (...args) {
    const result = Reflect.apply(nativeParse, this, args);
    try { inspectManifest(result); } catch { /* Observation must never break Netflix parsing. */ }
    return result;
  };
  JSON.stringify = function (...args) {
    // Request text alternatives alongside Netflix's existing profiles. Leave media profiles intact.
    const input = args[0];
    try {
      if (enabled && input?.params && Array.isArray(input.params.profiles) && input.params.profiles.some(p => /simplesdh|dfxp|imsc|nflx-cmisc|webvtt/.test(p))) {
        args[0] = {...input, params: {...input.params, profiles: [...new Set([...input.params.profiles, 'webvtt-lssdh-ios8'])], showAllSubDubTracks: true}};
      }
    } catch { /* Preserve serialization if an object is unusual or frozen. */ }
    return Reflect.apply(nativeStringify, this, args);
  };
  function readPrimary(p) {
    try {
      if (typeof p?.getTimedTextTrack !== 'function') return {known: false, track: null, raw: null};
      const raw = p.getTimedTextTrack();
      return {known: true, track: C.normalizeTrack(raw), raw};
    } catch { return {known: false, track: null, raw: null}; }
  }
  function readTrackList(p) {
    try { return p?.getTimedTextTrackList?.() || []; } catch { return []; }
  }
  function collectRuntimeSources(p, id, force = false) {
    if (!force && performance.now() - scanAt < 5000) return;
    scanAt = performance.now();
    // Bounded descriptor-only traversal: don't run getters, touch DOM, or inspect unrelated globals.
    const roots = [window.netflix?.player?.MediaSession, p].filter(Boolean);
    const queue = roots.map(value => ({value, depth: 0}));
    const seen = new WeakSet();
    const store = bucket(id);
    const deadline = performance.now() + 12;
    for (let i = 0; i < queue.length && i < 18000 && performance.now() < deadline; i++) {
      const {value, depth} = queue[i];
      if (!value || !['object', 'function'].includes(typeof value) || seen.has(value) || value instanceof Node || value === window) continue;
      seen.add(value);
      let descriptors;
      try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { continue; }
      const get = key => descriptors[key]?.value;
      if (get('trackId') && C.TEXT_PROFILES.includes(get('profile'))) {
        const t = findTrack(id, String(get('trackId')));
        if (t) t.sources = C.mergeSources(t.sources, C.sources({profile: get('profile'), urls: get('urls'), downloadUrls: get('downloadUrls')}));
      }
      if (get('timedtexttracks') && Array.isArray(get('timedtexttracks'))) merge(id, get('timedtexttracks').map(C.normalizeTrack));
      if (depth >= 14) continue;
      for (const [key, descriptor] of Object.entries(descriptors)) {
        const v = descriptor.value;
        if (key !== 'prototype' && key !== '__proto__' && v && ['object', 'function'].includes(typeof v) && queue.length < 24000) queue.push({value: v, depth: depth + 1});
      }
    }
  }
  function snapshot(force = false) {
    const p = player(), id = movieId(p);
    if (!watchId() || !id) {
      if (lastMovie) { lastMovie = ''; lastSnapshot = ''; send('STATE', {movieId: '', tracks: [], primary: null, primaryKnown: false, capturing: false}); }
      return;
    }
    if (id !== lastMovie) { lastMovie = id; lastSnapshot = ''; scanAt = -Infinity; }
    const list = readTrackList(p);
    merge(id, list.map(C.normalizeTrack));
    if (enabled) collectRuntimeSources(p, id);
    const current = busy?.movieId === id ? busy.original : readPrimary(p);
    const track = current.track;
    const primary = track ? findTrack(id, track.id) || [...bucket(id).values()].find(t => sameLanguage(t, track)) || track : null;
    const strip = t => { if (!t) return t; const {aliases, ...rest} = t; return rest; };
    const state = {movieId: id, tracks: [...bucket(id).values()].slice(0, 160).map(strip), primary: strip(primary), primaryKnown: current.known, capturing: !!busy, diagnostics: {...connection}};
    const signature = nativeStringify(state);
    if (force || signature !== lastSnapshot) { lastSnapshot = signature; send('STATE', state); }
  }
  async function resolve(request) {
    const p = player(), id = movieId(p);
    const reply = data => send('RESOLVED', {requestId: request.requestId, movieId: id, ...data});
    if (!p || !watchId() || id !== request.movieId || !enabled) return reply({error: 'The Netflix player changed. Try again.'});
    if (busy) return reply({error: 'Another Netflix track is loading. Try again in a moment.'});
    collectRuntimeSources(p, id, true);
    let target = findTrack(id, request.trackId);
    if (target?.sources.length) return reply({sources: target.sources});
    const ids = new Set([request.trackId, ...(target?.aliases || [])]);
    const raw = readTrackList(p).find(t => ids.has(C.trackId(t))) || (target && readTrackList(p).find(t => { const n = C.normalizeTrack(t); return n && sameLanguage(n, target); }));
    if (!raw) return reply({error: 'Netflix has not exposed this track. Select it once in Netflix’s subtitle menu, then retry.'});
    const original = readPrimary(p);
    if (!original.known || !original.raw || typeof p.setTimedTextTrack !== 'function') return reply({error: 'Select this language once in Netflix’s subtitle menu, then return to your main language and retry.'});
    const operation = {movieId: id, original, canceled: false};
    busy = operation;
    snapshot(true);
    let didSwitch = false;
    try {
      p.setTimedTextTrack(raw);
      didSwitch = true;
      for (let attempt = 0; attempt < 32; attempt++) {
        await new Promise(done => setTimeout(done, 250));
        if (operation.canceled || !enabled || movieId(player()) !== id || watchId() !== id) throw new Error('Track loading stopped because the player or settings changed.');
        const now = readPrimary(p);
        const currentId = C.trackId(now.raw);
        if (now.known && currentId && currentId !== C.trackId(raw) && currentId !== C.trackId(original.raw)) {
          didSwitch = false;
          throw new Error('Track loading stopped because you changed Netflix subtitles. Retry with your new main language.');
        }
        collectRuntimeSources(p, id, true);
        target = findTrack(id, request.trackId);
        if (target?.sources.length) { reply({sources: target.sources}); return; }
      }
      throw new Error('No text subtitle file was exposed. The track may be image-only. Select it once in Netflix’s menu, restore the main language, then retry.');
    } catch (error) { reply({error: error.message}); }
    finally {
      const currentId = C.trackId(readPrimary(p).raw);
      if (didSwitch && movieId(player()) === id && watchId() === id && (currentId === C.trackId(raw) || currentId === C.trackId(original.raw))) {
        try { p.setTimedTextTrack(original.raw); } catch { /* User can still select subtitles normally. */ }
      }
      if (busy === operation) busy = null;
      snapshot(true);
    }
  }
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.channel !== CHANNEL || e.data?.from !== 'extension') return;
    const data = e.data;
    if (data.type === 'HELLO' || data.type === 'REFRESH') { if (data.type === 'REFRESH') scanAt = -Infinity; snapshot(true); }
    if (data.type === 'CONFIG') { enabled = !!data.enabled; if (!enabled && busy) busy.canceled = true; }
    if (data.type === 'RESOLVE' && typeof data.requestId === 'string' && typeof data.trackId === 'string') void resolve(data);
  });
  window.__dualSubsPageV101 = {refresh: () => { scanAt = -Infinity; snapshot(true); }};
  setInterval(() => { try { snapshot(); } catch { /* Netflix internals can change at any time. */ } }, 750);
})();
