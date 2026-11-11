(() => {
  'use strict';
  // After an extension reload/update, the previous copy of this script is orphaned
  // (its chrome.* APIs are dead) but keeps running and drawing. Only reuse a live one.
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const prior = globalThis.__dualSubsContentV101;
  if (prior?.alive?.()) { prior.refresh(); return; }
  try { prior?.destroy?.(); } catch { /* An old build may not support teardown. */ }
  const C = globalThis.DualSubsCore, S = globalThis.DualSubsSubtitles;
  const CHANNEL = 'dual-subs/v1';
  let settings = C.cleanSettings(), state = {movieId: '', tracks: [], primary: null, primaryKnown: false, capturing: false};
  let initialized = false, selected = null, secondary = null, primary = null;
  let alignedSecondary = null;
  let status = 'Start a Netflix title to find its original subtitle tracks.', phase = 'waiting';
  let generation = 0, loadKey = '', currentPath = location.pathname;
  let host, shadow, stage, stack, primaryLine, secondaryLine, playerRoot, nativeStyle, video;
  let lastDraw = 0, requestSequence = 0, rafId = 0, appearanceAt = 0, cachedAppearance = null;
  let retryKey = '', retryCount = 0, retryTimer = 0, destroyed = false;
  const timers = [];
  const RETRY_DELAYS = [1500, 4000, 10000];
  let bridgeConnected = false;
  let nativeAppearance = null;
  let diagnostics = {apiFound: false, playerFound: false, sessionCount: 0};
  const cache = new Map(), pending = new Map();
  const post = (type, data = {}) => window.postMessage({channel: CHANNEL, from: 'extension', type, ...data}, location.origin);
  const isWatch = () => /^\/watch\/\d+/.test(location.pathname);
  function notify(message, value = 'ready') { status = message; phase = value; }
  function resetNative() {
    if (playerRoot) { playerRoot.classList.remove('nds-own-primary', 'nds-native-primary', 'nds-no-background'); playerRoot.style.removeProperty('--nds-reserve'); playerRoot.style.removeProperty('--nds-primary-scale'); }
  }
  function publicState() {
    let message = status;
    if (isWatch() && settings.enabled && !state.tracks.length) {
      message = !bridgeConnected ? 'The Netflix page connection is missing. Click Reconnect to Netflix.' : !diagnostics.playerFound ? 'The Netflix playback session is not ready. Open Netflix’s Audio & Subtitles menu, then click Reconnect to Netflix.' : 'The player is connected, but Netflix has not exposed its subtitle list. Open Audio & Subtitles, then reconnect.';
    }
    return {settings, phase, status: message, movieId: state.movieId, tracks: state.tracks.map(({sources, ...t}) => ({...t, hasText: !!sources.length})), primary: state.primary?.label || (state.primaryKnown ? 'Off' : 'Netflix’s selected language'), selectedId: selected?.id || '', capturing: state.capturing, primaryRendered: !!primary, diagnostics: {...diagnostics, bridgeConnected}};
  }
  function requestSources(track) {
    if (track.sources.length) return Promise.resolve(track.sources);
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}:${++requestSequence}`;
      const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('Netflix did not expose this subtitle file. Select the language once in Netflix, return to the main language, then retry.')); }, 11500);
      pending.set(requestId, {resolve, reject, timeout, movieId: state.movieId});
      post('RESOLVE', {requestId, trackId: track.id, movieId: state.movieId});
    });
  }
  async function load(track, movie) {
    const key = movie + ':' + track.id;
    if (cache.has(key)) return cache.get(key);
    const sources = C.mergeSources(await requestSources(track));
    let error = new Error('Netflix has not exposed a supported text subtitle file for this language.');
    for (const source of sources) {
      try {
        if (!alive()) throw new Error('Dual Subs was updated. Reload this Netflix page once.');
        const response = await chrome.runtime.sendMessage({type: 'FETCH_SUBTITLE', url: source.url});
        if (!response || response.error) throw new Error(response?.error || 'The extension could not load the subtitle.');
        let timeline;
        // An unreadable (image/binary) file will never parse: don't retry those.
        try { timeline = S.parse(response.text); } catch (e) { e.permanent = true; throw e; }
        cache.set(key, timeline);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
        return timeline;
      } catch (e) { error = e; }
    }
    throw error;
  }
  function reconcile(force = false) {
    if (!initialized) return;
    selected = C.findPreferred(state.tracks, settings.secondary);
    // Include whether URLs are known, so a load that failed because the manifest
    // arrived late is retried automatically once Netflix exposes the files.
    const key = [state.movieId, selected?.id || '', !!selected?.sources.length, state.primary?.id || '', !!state.primary?.sources.length, state.primaryKnown, settings.enabled, settings.secondary ? JSON.stringify(settings.secondary) : ''].join('|');
    if (!force && key === loadKey) return;
    loadKey = key;
    if (key !== retryKey) { retryKey = key; retryCount = 0; }
    clearTimeout(retryTimer);
    const token = ++generation;
    secondary = null; primary = null; alignedSecondary = null; resetNative();
    if (!isWatch() || !state.movieId) return notify('Start a Netflix title to find its original subtitle tracks.', 'waiting');
    if (!settings.enabled) return notify('Dual subtitles are off. Netflix subtitles remain available.', 'off');
    if (!settings.secondary) return notify('Choose a secondary language from this title’s Netflix tracks.', 'waiting');
    if (!selected) return notify('Your saved secondary language is unavailable for this title. Choose another track.', 'unavailable');
    if (state.primaryKnown && !state.primary) return notify('Turn on your main subtitle language in Netflix’s subtitle menu.', 'waiting');
    if (C.sameTrack(selected, state.primary)) return notify('Choose a secondary language different from the main Netflix subtitles.', 'waiting');
    notify(`Loading ${selected.label} from Netflix…`, 'loading');
    const movie = state.movieId, target = selected, main = state.primary;
    void (async () => {
      try {
        const loaded = await load(target, movie);
        if (token !== generation) return;
        secondary = loaded;
        notify(`${target.label} ready · ${loaded.cues.length.toLocaleString()} original cues`, 'ready');
        if (main) {
          try {
            const loadedMain = await load(main, movie);
            if (token !== generation) return;
            primary = loadedMain;
            alignedSecondary = S.alignToPrimary(secondary, primary);
          } catch {
            if (token === generation) notify(`${target.label} ready · main subtitles use Netflix’s native display`, 'ready');
          }
        }
      } catch (error) {
        if (token !== generation) return;
        resetNative();
        // Transient failures (player still starting, CDN hiccup, sleeping worker)
        // used to stick until a page refresh. Retry a few times with backoff.
        if (!error.permanent && retryCount < RETRY_DELAYS.length) {
          const delay = RETRY_DELAYS[retryCount++];
          notify(`${error.message} Retrying automatically…`, 'loading');
          retryTimer = setTimeout(() => { if (token === generation && !destroyed) { post('REFRESH'); reconcile(true); } }, delay);
        } else notify(error.message, 'error');
      }
    })();
  }
  function validateTrack(t) {
    if (!t || typeof t.id !== 'string' || t.id.length > 500 || typeof t.language !== 'string' || typeof t.label !== 'string') return null;
    return {id: t.id, language: t.language.slice(0, 80), label: t.label.slice(0, 160), type: t.type === 'closedcaptions' ? 'closedcaptions' : 'subtitles', forced: !!t.forced, variant: String(t.variant || '').slice(0, 80), sources: C.mergeSources(Array.isArray(t.sources) ? t.sources.slice(0, 12) : [])};
  }
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.channel !== CHANNEL || e.data?.from !== 'page') return;
    const data = e.data;
    if (data.type === 'RESOLVED') {
      const job = pending.get(data.requestId);
      if (!job) return;
      pending.delete(data.requestId); clearTimeout(job.timeout);
      if (data.movieId !== job.movieId) return job.reject(new Error('The Netflix title changed.'));
      if (data.error) return job.reject(new Error(String(data.error).slice(0, 600)));
      job.resolve(Array.isArray(data.sources) ? data.sources.slice(0, 12) : []);
    }
    if (data.type === 'STATE' && typeof data.movieId === 'string' && Array.isArray(data.tracks)) {
      bridgeConnected = true;
      diagnostics = {apiFound: !!data.diagnostics?.apiFound, playerFound: !!data.diagnostics?.playerFound, sessionCount: Math.max(0, Math.min(1000, Number(data.diagnostics?.sessionCount) || 0))};
      const movieChanged = state.movieId !== data.movieId;
      state = {movieId: data.movieId, tracks: data.tracks.slice(0, 160).map(validateTrack).filter(Boolean), primary: validateTrack(data.primary), primaryKnown: !!data.primaryKnown, capturing: !!data.capturing};
      if (movieChanged) { cache.clear(); secondary = null; primary = null; alignedSecondary = null; resetNative(); }
      reconcile();
    }
  });
  async function saveSettings(next) {
    settings = C.cleanSettings({...settings, ...next});
    await chrome.storage.local.set({settings});
    post('CONFIG', {enabled: settings.enabled});
    reconcile();
  }
  async function selectTrack(id) {
    const track = state.tracks.find(t => t.id === id);
    if (!track) throw new Error('This subtitle track is no longer available. Refresh the languages.');
    await saveSettings({secondary: C.preference(track)});
  }
  // This API stays in the extension's isolated world; Netflix page scripts cannot access it.
  globalThis.DualSubsPlayerApi = Object.freeze({
    getState: publicState,
    updateSettings: saveSettings,
    selectTrack,
    refresh: () => { post('CONFIG', {enabled: settings.enabled}); post('REFRESH'); },
    retry: () => { cache.clear(); retryCount = 0; post('REFRESH'); reconcile(true); }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'PLAYER_READY') { respond({ok: !!globalThis.__dualSubsPlayerControlsV110}); return; }
    if (message?.type === 'GET_STATE') { post('HELLO'); respond(publicState()); return; }
    if (message?.type === 'UPDATE_SETTINGS') {
      void saveSettings(message.settings || {}).then(() => respond(publicState())).catch(e => respond({error: e.message}));
      return true;
    }
    if (message?.type === 'SELECT_TRACK') {
      const track = state.tracks.find(t => t.id === message.id);
      if (!track) { respond({error: 'This track is no longer available. Reopen the popup.'}); return; }
      void saveSettings({secondary: C.preference(track)}).then(() => respond(publicState())).catch(e => respond({error: e.message}));
      return true;
    }
    if (message?.type === 'RETRY') { cache.clear(); retryCount = 0; post('REFRESH'); reconcile(true); respond(publicState()); }
    if (message?.type === 'REFRESH_TRACKS') { post('REFRESH'); respond(publicState()); }
    if (message?.type === 'OPEN_PLAYER_SETTINGS') { globalThis.__dualSubsPlayerControlsV110?.open(); respond({ok: !!globalThis.__dualSubsPlayerControlsV110}); }
    if (message?.type === 'CLOSE_PLAYER_SETTINGS') { globalThis.__dualSubsPlayerControlsV110?.close(); respond({ok:true}); }
  });
  function destroy() {
    if (destroyed) return;
    destroyed = true; ++generation;
    for (const id of timers) clearInterval(id);
    clearTimeout(retryTimer); cancelAnimationFrame(rafId);
    resetNative(); host?.remove(); nativeStyle?.remove();
    for (const job of pending.values()) clearTimeout(job.timeout);
    pending.clear();
  }
  globalThis.__dualSubsContentV101 = {alive: () => !destroyed && alive(), destroy, refresh: () => { post('CONFIG', {enabled: settings.enabled}); post('REFRESH'); }};
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) { settings = C.cleanSettings(changes.settings.newValue); post('CONFIG', {enabled: settings.enabled}); reconcile(); }
  });
  function mount() {
    const found = [...document.querySelectorAll('video')].filter(v => v.getBoundingClientRect().width > 100).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    video = found || null;
    if (!video || !isWatch()) { resetNative(); if (host) host.hidden = true; return; }
    const fullscreen = document.fullscreenElement;
    const root = (fullscreen && fullscreen !== video ? fullscreen : null) || video.closest('.watch-video--player-view, .NFPlayer, [data-uia="video-canvas"]') || video.parentElement;
    // Element fullscreen on <video> itself cannot host HTML overlays.
    if (fullscreen === video) { resetNative(); if (host) host.hidden = true; return; }
    if (!host) {
      host = document.createElement('div');
      host.id = 'netflix-dual-subs';
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;';
      shadow = host.attachShadow({mode: 'open'});
      const style = document.createElement('style');
      style.textContent = `:host{all:initial;pointer-events:none!important} .stage{position:absolute;overflow:hidden;pointer-events:none}.stack{position:absolute;left:6%;right:6%;display:flex;flex-direction:column;align-items:center;text-align:center;line-height:1.28;font-family:Arial,"Noto Sans",sans-serif;font-weight:600;text-shadow:0 2px 4px #000,1px 0 2px #000,-1px 0 2px #000;pointer-events:none}.line{white-space:pre-line;overflow-wrap:anywhere;max-width:100%;padding:2px 9px;border-radius:4px;box-sizing:border-box;unicode-bidi:plaintext}.line:empty{display:none}`;
      stage = document.createElement('div'); stage.className = 'stage';
      stack = document.createElement('div'); stack.className = 'stack';
      primaryLine = document.createElement('div'); primaryLine.className = 'line primary'; primaryLine.dir = 'auto';
      secondaryLine = document.createElement('div'); secondaryLine.className = 'line secondary'; secondaryLine.dir = 'auto';
      stack.append(primaryLine, secondaryLine); stage.append(stack); shadow.append(style, stage);
      nativeStyle = document.createElement('style');
      nativeStyle.textContent = '.nds-own-primary .player-timedtext{visibility:hidden!important}.nds-native-primary .player-timedtext{translate:0 calc(-1 * var(--nds-reserve,0px))!important}.nds-native-primary .player-timedtext-text-container{scale:var(--nds-primary-scale,1);transform-origin:center bottom}.nds-no-background .player-timedtext,.nds-no-background .player-timedtext *{background:transparent!important;box-shadow:none!important;border:0!important}';
    }
    if (root !== playerRoot) { resetNative(); playerRoot = root; }
    if (host.parentElement !== root) root.append(host);
    if (!nativeStyle.isConnected) (document.head || document.documentElement).append(nativeStyle);
  }
  function readNativeAppearance(rect) {
    // Netflix keeps laying out its native cues even when the duplicate is hidden.
    // Read the actual glyph spans, not the root's inherited 16 px font size.
    let found = null;
    for (const element of playerRoot.querySelectorAll('.player-timedtext-text-container span, .player-timedtext-text-container')) {
      if (!Array.from(element.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const style = getComputedStyle(element), font = parseFloat(style.fontSize);
      if (style.display === 'none' || !element.getBoundingClientRect().height || !Number.isFinite(font) || font < 8 || font > rect.height * .3) continue;
      if (!found || font > found.font) found = {font, family: style.fontFamily, weight: style.fontWeight, height: rect.height};
    }
    if (found) nativeAppearance = found;
    if (nativeAppearance) return {...nativeAppearance, font: nativeAppearance.font * rect.height / nativeAppearance.height};
    return {font: Math.max(18, Math.min(64, rect.height * .052)), family: 'Arial, "Noto Sans", sans-serif', weight: '600'};
  }
  function draw() {
    if (!host || !video || !playerRoot || !host.isConnected) return;
    const active = isWatch() && settings.enabled && secondary && !(state.primaryKnown && !state.primary) && !C.sameTrack(selected, state.primary) && !video.ended;
    host.hidden = !active;
    if (!active) { resetNative(); return; }
    const vr = video.getBoundingClientRect(), hr = host.getBoundingClientRect();
    // Scanning Netflix's cue spans with getComputedStyle is costly; 3× a second is plenty.
    const nowMs = performance.now();
    if (!cachedAppearance || nowMs - appearanceAt > 333) { appearanceAt = nowMs; cachedAppearance = {...readNativeAppearance(vr), height: vr.height}; }
    const appearance = {...cachedAppearance, font: cachedAppearance.font * vr.height / (cachedAppearance.height || vr.height)};
    const mainFont = appearance.font * settings.primaryScale / 100;
    const subFont = appearance.font * settings.secondaryScale / 100;
    stage.style.cssText = `left:${vr.left - hr.left}px;top:${vr.top - hr.top}px;width:${vr.width}px;height:${vr.height}px;`;
    stack.style.bottom = `${settings.bottom}%`;
    stack.style.gap = `${settings.gap}px`;
    primaryLine.style.fontSize = `${mainFont}px`;
    secondaryLine.style.fontSize = `${subFont}px`;
    primaryLine.style.fontFamily = appearance.family;
    primaryLine.style.fontWeight = appearance.weight;
    secondaryLine.style.color = settings.color;
    primaryLine.style.color = '#ffffff';
    primaryLine.style.background = secondaryLine.style.background = settings.noBackground ? 'transparent' : `rgba(0,0,0,${settings.background / 100})`;
    primaryLine.style.border = secondaryLine.style.border = '0';
    primaryLine.style.boxShadow = secondaryLine.style.boxShadow = 'none';
    // Each language uses its own timestamps; positive offset delays only the secondary.
    const t = video.currentTime;
    const primaryText = primary?.at(t) || '';
    const secondaryText = (settings.alignTimings && alignedSecondary ? alignedSecondary : secondary).at(t - settings.offset);
    if (primaryLine.textContent !== primaryText) primaryLine.textContent = primaryText;
    if (secondaryLine.textContent !== secondaryText) secondaryLine.textContent = secondaryText;
    primaryLine.lang = state.primary?.language || '';
    secondaryLine.lang = selected?.language || '';
    const ownsPrimary = !!primary;
    playerRoot.classList.toggle('nds-own-primary', ownsPrimary);
    playerRoot.classList.toggle('nds-native-primary', !ownsPrimary);
    playerRoot.classList.toggle('nds-no-background', settings.noBackground);
    playerRoot.style.setProperty('--nds-primary-scale', String(settings.primaryScale / 100));
    if (!ownsPrimary) {
      // Reserve enough room for the second language, including wrapped lines.
      const reserve = Math.max(subFont * 2.6, secondaryLine.getBoundingClientRect().height) + settings.gap;
      playerRoot.style.setProperty('--nds-reserve', `${reserve}px`);
      const candidates = [...playerRoot.querySelectorAll('.player-timedtext-text-container, .player-timedtext img')].map(e => e.getBoundingClientRect()).filter(r => r.height > 0 && r.height < vr.height * .65);
      if (candidates.length && secondaryText) {
        const bottom = Math.max(...candidates.map(r => r.bottom));
        const top = Math.max(vr.top, Math.min(bottom + settings.gap, vr.bottom - secondaryLine.getBoundingClientRect().height - 8));
        stack.style.bottom = 'auto'; stack.style.top = `${top - vr.top}px`;
      } else stack.style.top = '';
    } else { stack.style.top = ''; playerRoot.style.removeProperty('--nds-reserve'); }
  }
  function frame(now) {
    if (destroyed) return;
    if (now - lastDraw >= 33) { lastDraw = now; try { draw(); } catch { /* Never let one bad frame stop the render loop. */ } }
    rafId = requestAnimationFrame(frame);
  }
  void chrome.storage.local.get('settings').then(data => {
    settings = C.cleanSettings(data.settings); initialized = true;
    post('CONFIG', {enabled: settings.enabled}); post('HELLO'); reconcile();
  });
  function start() {
    if (destroyed) return;
    mount(); rafId = requestAnimationFrame(frame);
    document.addEventListener('fullscreenchange', () => { if (!destroyed) { mount(); draw(); } });
    timers.push(setInterval(() => {
      if (!alive()) { destroy(); return; }
      if (currentPath !== location.pathname) {
        currentPath = location.pathname; ++generation; secondary = null; primary = null; loadKey = ''; resetNative();
        state = {movieId: '', tracks: [], primary: null, primaryKnown: false, capturing: false};
        reconcile(); post('HELLO');
      }
      try { mount(); } catch { /* Netflix DOM changes mid-transition; next tick retries. */ }
    }, 500));
    // The page bridge only pushes on change; a periodic HELLO heals any message
    // lost while the player was being torn down or rebuilt.
    timers.push(setInterval(() => { if (isWatch() && settings.enabled && (!state.tracks.length || phase !== 'ready')) post('HELLO'); }, 3000));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
