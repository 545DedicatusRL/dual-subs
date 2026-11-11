(() => {
  'use strict';
  const C = globalThis.DualSubsCore, $ = id => document.getElementById(id);
  const keys = ['primaryScale', 'secondaryScale', 'noBackground', 'alignTimings', 'showIndicator', 'gap', 'bottom', 'background', 'color', 'offset'];
  const flags = new Set(['noBackground', 'alignTimings', 'showIndicator']);
  const units = {gap: ' px', offset: ' s'};
  const SWATCHES = ['#ffffff', '#ffe066', '#7ee0ff', '#9dff9d', '#ffb0d0'];
  let settings = C.cleanSettings(), signature = '', edits = {}, timer, queue = Promise.resolve(), polling = false, lastState = null;

  const send = async (type, data = {}) => {
    const result = await chrome.runtime.sendMessage({type, ...data});
    if (!result || result.error) throw new Error(result?.error || 'Reload Netflix to reconnect the settings.');
    return result;
  };
  const showError = error => { $('status').textContent = error.message; $('status-row').dataset.phase = 'error'; };
  const format = (key, value) => value + (units[key] ?? '%');

  function paintSlider(input) {
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty('--p', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  }

  // Swatches are a shortcut for the color input; the input remains the source of truth.
  const swatchBox = $('swatches');
  for (const color of SWATCHES) {
    const b = document.createElement('button');
    b.type = 'button'; b.style.background = color; b.dataset.color = color;
    b.setAttribute('aria-label', `Second language color ${color}`);
    b.addEventListener('click', event => {
      event.preventDefault();
      $('color').value = color;
      $('color').dispatchEvent(new Event('input', {bubbles: true}));
    });
    swatchBox.append(b);
  }

  function renderPreview() {
    const s = C.cleanSettings({...settings, ...edits});
    const base = 15;
    $('preview').classList.toggle('off', !s.enabled);
    $('preview').style.setProperty('--pv-gap', `${Math.round(s.gap / 2)}px`);
    $('preview').style.setProperty('--pv-bottom', `${4 + s.bottom * .6}px`);
    $('preview').style.setProperty('--pv-bg', s.noBackground ? '0' : String(s.background / 100));
    $('preview-primary').style.fontSize = `${base * s.primaryScale / 100}px`;
    $('preview-secondary').style.fontSize = `${base * s.secondaryScale / 100}px`;
    $('preview-secondary').style.color = s.color;
    for (const b of swatchBox.children) b.setAttribute('aria-pressed', String(b.dataset.color.toLowerCase() === s.color.toLowerCase()));
    if (lastState) {
      const second = lastState.tracks.find(t => t.id === lastState.selectedId);
      $('preview-primary').textContent = lastState.primary && !['Off', 'Netflix’s selected language'].includes(lastState.primary) ? lastState.primary : 'First language';
      $('preview-secondary').textContent = second?.label || 'Second language';
    }
  }

  function friendlyStatus(state) {
    if (state.capturing) return 'Loading the Netflix track and restoring the first language…';
    return state.status
      .replaceAll('Click Reconnect to Netflix.', 'Choose Refresh languages.')
      .replaceAll('then click Reconnect to Netflix.', 'then choose Refresh languages.')
      .replaceAll('then reconnect.', 'then choose Refresh languages.');
  }

  function render(state) {
    lastState = state;
    settings = C.cleanSettings({...state.settings, ...edits});
    $('enabled').checked = settings.enabled;
    $('primary').textContent = state.primary;

    const next = JSON.stringify([state.tracks, state.selectedId]);
    if (next !== signature && document.activeElement !== $('secondary')) {
      signature = next;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = state.tracks.length ? 'Choose a language…' : 'No languages yet — Refresh';
      const options = [placeholder];
      for (const track of state.tracks) {
        const option = document.createElement('option');
        option.value = track.id; option.textContent = track.label;
        options.push(option);
      }
      $('secondary').replaceChildren(...options);
      $('secondary').value = state.selectedId || '';
      $('secondary').disabled = !state.tracks.length;
    }

    for (const key of keys) {
      const input = $(key);
      if (document.activeElement !== input) {
        if (flags.has(key)) input.checked = settings[key]; else input.value = settings[key];
      }
      if ($(key + '-value')) $(key + '-value').textContent = format(key, settings[key]);
      if (input.type === 'range') paintSlider(input);
    }
    $('background').disabled = settings.noBackground;

    $('status').textContent = friendlyStatus(state);
    $('status-row').dataset.phase = state.capturing ? 'loading' : state.phase;
    $('retry').hidden = state.phase !== 'error';
    renderPreview();
  }

  function enqueue(type, data) { queue = queue.then(() => send(type, data)).then(render).catch(showError); }
  function update(patch) { enqueue('PLAYER_PANEL_UPDATE_SETTINGS', {settings: patch}); }
  function flush() { clearTimeout(timer); const patch = edits; edits = {}; if (Object.keys(patch).length) update(patch); }
  async function close() { flush(); await queue; try { await send('PLAYER_PANEL_CLOSE'); } catch (error) { showError(error); } }

  $('close').addEventListener('click', () => { void close(); });
  document.addEventListener('keydown', event => {
    const typing = event.target.closest?.('input:not([type=checkbox]):not([type=range]),select,textarea,[contenteditable]:not([contenteditable="false"])');
    if (event.key.toLowerCase() === 'c' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !typing) {
      event.preventDefault(); update({enabled: !settings.enabled});
    }
    if (event.key === 'Escape') { event.preventDefault(); void close(); }
  });
  $('enabled').addEventListener('change', () => update({enabled: $('enabled').checked}));
  $('secondary').addEventListener('change', () => { const id = $('secondary').value; if (id) enqueue('PLAYER_PANEL_SELECT_TRACK', {id}); });
  for (const key of keys) $(key).addEventListener('input', () => {
    const input = $(key);
    const value = flags.has(key) ? input.checked : key === 'color' ? input.value : Number(input.value);
    if (key === 'offset' && !Number.isFinite(value)) return;
    edits[key] = value;
    if ($(key + '-value')) $(key + '-value').textContent = format(key, value);
    if (input.type === 'range') paintSlider(input);
    if (key === 'noBackground') $('background').disabled = value;
    renderPreview();
    clearTimeout(timer); timer = setTimeout(flush, 80);
  });
  $('refresh').addEventListener('click', () => enqueue('PLAYER_PANEL_REFRESH'));
  $('retry').addEventListener('click', () => enqueue('PLAYER_PANEL_RETRY'));
  $('reset').addEventListener('click', () => {
    clearTimeout(timer); edits = {};
    const patch = {};
    for (const key of keys) if (key !== 'showIndicator') patch[key] = C.DEFAULTS[key];
    update(patch);
  });

  // Stop polling Netflix while the panel is closed (its iframe is display:none).
  // IntersectionObserver works in cross-origin frames; requestAnimationFrame does
  // not (browsers throttle it there even while visible).
  let onScreen = true;
  try {
    new IntersectionObserver(entries => {
      const was = onScreen;
      onScreen = entries.at(-1).isIntersecting;
      if (onScreen && !was) void poll();
    }).observe(document.documentElement);
  } catch { /* Keep polling if the observer is unavailable. */ }
  async function poll() {
    if (polling || Object.keys(edits).length || document.hidden || (lastState && !onScreen)) return;
    polling = true;
    try { render(await send('PLAYER_PANEL_GET_STATE')); } catch (error) { showError(error); } finally { polling = false; }
  }
  void poll(); setInterval(poll, 750);
})();
