(() => {
  'use strict';
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const prior = globalThis.__dualSubsPlayerControlsV110;
  if (prior?.alive?.() ?? (prior && !prior.destroy)) return;
  try { prior?.destroy?.(); } catch { /* Old builds have no teardown. */ }
  // Remove any controls an orphaned copy left in the page before building ours.
  for (const id of ['dual-subs-player-settings', 'dual-subs-player-launcher', 'dual-subs-enabled-indicator', 'dual-subs-player-style']) document.getElementById(id)?.remove();
  document.querySelectorAll('.nds-native-menu-entry, .nds-player-control-slot').forEach(n => n.remove());
  const lifetime = new AbortController(), on = {capture: true, signal: lifetime.signal};
  let tickTimer = 0, destroyed = false, clockCache = null, clockScanAt = 0;
  const menuSelector = '[data-uia="audio-subtitle-menu"], [data-uia="audio-subtitle-container"], #audio-subtitle-menu, .audio-subtitle-menu';
  const controlSelector = '[data-uia="control-audio-subtitle"], [data-uia="audio-subtitle-controller"], button[aria-label="Audio & Subtitles"]';
  // Same viewBox and speech-bubble outline as the native caption icon. The ²
  // sits inside the bubble, so its visual centre matches the neighbouring icon.
  const glyph = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true" style="display:block;pointer-events:none"><path d="M3 5h26v20H21l-7 5v-5H3z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><text x="6.5" y="21" fill="currentColor" font-family="Arial,sans-serif" font-weight="700" font-size="10">CC</text><text x="22" y="14" fill="currentColor" font-family="Arial,sans-serif" font-weight="700" font-size="7">2</text></svg>';
  let root, anchor, slot, control, entry, host, frame, indicator, open = false, returnFocus;
  let closeTimer, hoveringControl = false, hoveringPanel = false, mode = 'hover', currentPath = location.pathname;
  const owned = event => event.composedPath().find(node => node === control || node === entry);
  function reveal(element, show, display = 'block') {
    element.hidden = !show;
    element.style.setProperty('display', show ? display : 'none', 'important');
    if (typeof element.showPopover === 'function') {
      try {
        const shown = element.matches(':popover-open');
        if (show && !shown) element.showPopover();
        if (!show && shown) element.hidePopover();
      } catch { /* Positioned fallback for browsers without popovers. */ }
    }
  }
  function painted(element) {
    if (!element?.isConnected) return false;
    const r = element.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    for (let n = element; n && n !== root?.parentElement; n = n.parentElement) {
      const style = getComputedStyle(n);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  }
  function cancelClose() { clearTimeout(closeTimer); }
  function scheduleClose() {
    cancelClose();
    if (mode === 'keyboard') return;
    closeTimer = setTimeout(() => { if (!hoveringControl && !hoveringPanel) closePanel(false); }, 280);
  }
  function makeUI() {
    if (host) return;
    host = document.createElement('div'); host.id = 'dual-subs-player-settings';
    host.setAttribute('popover', 'manual'); host.setAttribute('aria-label', 'Dual subtitle settings');
    host.style.cssText = 'position:fixed;inset:auto;margin:0;padding:0;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:#141414;box-shadow:0 18px 48px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.4);overflow:hidden;box-sizing:border-box;pointer-events:auto;z-index:2147483647;color-scheme:dark;';
    frame = document.createElement('iframe'); frame.id = 'dual-subs-player-panel';
    frame.title = 'Dual subtitle settings'; frame.src = chrome.runtime.getURL('player-panel.html');
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:#141414;pointer-events:auto;color-scheme:dark;';
    host.append(frame); reveal(host, false);
    host.addEventListener('pointerenter', () => { hoveringPanel = true; cancelClose(); });
    host.addEventListener('pointerleave', () => { hoveringPanel = false; scheduleClose(); });
    slot = document.createElement('span'); slot.className = 'nds-player-control-slot';
    slot.setAttribute('aria-hidden', 'true');
    slot.style.cssText = 'display:inline-block;flex:none;align-self:center;pointer-events:none;';
    control = document.createElement('button'); control.id = 'dual-subs-player-launcher'; control.type = 'button';
    control.className = 'nds-player-launcher'; control.setAttribute('popover', 'manual');
    control.setAttribute('aria-label', 'Dual subtitle settings'); control.setAttribute('aria-expanded', 'false');
    control.setAttribute('aria-controls', host.id); control.title = 'Dual subtitle settings · C to enable/disable';
    control.style.cssText = 'all:initial;position:fixed;inset:auto;margin:0;padding:0;border:0;border-radius:10px;box-sizing:border-box;align-items:center;justify-content:center;background:transparent;color:white;cursor:pointer;pointer-events:auto;z-index:2147483646;';
    for (const key of ['position','pointer-events','z-index']) control.style.setProperty(key, control.style.getPropertyValue(key), 'important');
    control.innerHTML = glyph; reveal(control, false, 'flex');
    control.addEventListener('pointerenter', event => { if (event.pointerType === 'touch') return; hoveringControl = true; cancelClose(); if (!open) openPanel('hover'); });
    control.addEventListener('pointerleave', () => { hoveringControl = false; scheduleClose(); });
    indicator = document.createElement('div'); indicator.id = 'dual-subs-enabled-indicator';
    indicator.setAttribute('role', 'img'); indicator.setAttribute('aria-label', 'Dual subtitles enabled'); indicator.setAttribute('popover', 'manual');
    indicator.style.cssText = 'position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;color:white;opacity:.65;width:32px;height:32px;pointer-events:none;z-index:2147483645;';
    indicator.style.setProperty('pointer-events','none','important'); indicator.innerHTML = glyph;
    indicator.firstChild.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;'; reveal(indicator, false);
    entry = document.createElement('button'); entry.type = 'button'; entry.className = 'nds-native-menu-entry';
    entry.textContent = 'Dual subtitle settings';
    entry.style.cssText = 'display:block;position:relative;flex:1 0 100%;grid-column:1/-1;width:100%;padding:14px 18px;border:0;border-top:1px solid rgba(255,255,255,.15);border-radius:0;background:transparent;color:white;text-align:left;font:inherit;cursor:pointer;pointer-events:auto;';
    const style = document.createElement('style'); style.id = 'dual-subs-player-style';
    style.textContent = '#dual-subs-player-launcher{transition:background .15s ease!important}#dual-subs-player-launcher:hover{background:rgba(255,255,255,.12)!important}#dual-subs-player-launcher[data-enabled="true"]::after{content:"";position:absolute;left:30%;right:30%;bottom:12%;height:3px;border-radius:2px;background:#e50914}#dual-subs-player-launcher[data-enabled="false"] svg{opacity:.55}.nds-native-menu-entry:hover{background:rgba(255,255,255,.08)!important}#dual-subs-player-launcher:focus-visible,.nds-native-menu-entry:focus-visible{outline:2px solid white!important;outline-offset:2px}#dual-subs-player-settings::backdrop,#dual-subs-player-launcher::backdrop,#dual-subs-enabled-indicator::backdrop{pointer-events:none;background:transparent}';
    (document.head || document.documentElement).append(style);
  }
  function mountBranch(button) {
    // A direct sibling can itself be a button. querySelector alone misses it,
    // causing the old version to reserve a slot outside the actual icon row.
    let branch = button;
    while (branch.parentElement && branch.parentElement !== root) {
      const parent = branch.parentElement, layout = getComputedStyle(parent);
      if ((layout.display === 'flex' || layout.display === 'inline-flex') && !layout.flexDirection.startsWith('column')) {
        const siblings = [...parent.children].filter(s => s !== branch && s !== slot && !s.matches(menuSelector));
        if (siblings.some(s => s.matches('button') || s.querySelector('button'))) return branch;
      }
      branch = parent;
    }
    return null;
  }
  function visualCenterY(svg) {
    try {
      const box = svg.getBBox(), matrix = svg.getScreenCTM();
      if (box.height && matrix) return new DOMPoint(box.x+box.width/2,box.y+box.height/2).matrixTransform(matrix).y;
    } catch { /* A just-mounted SVG may not have geometry yet. */ }
    const rect = svg.getBoundingClientRect(); return rect.top+rect.height/2;
  }
  function remainingTime(vr) {
    // Reuse the last clock while it is still on screen; the text-scan fallback
    // walks every element in the player, so run it at most once a second.
    if (clockCache?.isConnected && painted(clockCache) && root.contains(clockCache)) return clockCache;
    if (performance.now() - clockScanAt < 1000) return null;
    clockScanAt = performance.now();
    return clockCache = findRemainingTime(vr);
  }
  function findRemainingTime(vr) {
    const selectors = '[data-uia="time-remaining"], [data-uia="controls-time-remaining"], .time-remaining__time, .time-remaining, .player-time-remaining';
    const inTimeArea = element => {
      if (!painted(element) || element.closest(menuSelector) || element.closest('.player-timedtext, #netflix-dual-subs, #dual-subs-player-settings')) return false;
      const r = element.getBoundingClientRect();
      return r.width <= 160 && r.height <= 70 && r.left >= vr.left+vr.width*.65 && r.top >= vr.top+vr.height*.55 && r.bottom <= vr.bottom;
    };
    const known = [...root.querySelectorAll(selectors)].filter(inTimeArea);
    // Netflix varies the clock's class names. Limit the text fallback to small
    // timestamp elements in the bottom-right time area, outside subtitle/menu UI.
    const candidates = known.length ? known : [...root.querySelectorAll('span, button, div')].filter(element => /^[-−]?\s*\d{1,3}:\d{2}(?::\d{2})?$/.test(element.textContent.trim()) && inTimeArea(element));
    return candidates.sort((a,b) => { const x=a.getBoundingClientRect(), y=b.getBoundingClientRect(); return x.width*x.height-y.width*y.height; })[0] || null;
  }
  function closePanel(focus = true) {
    cancelClose(); open = false; hoveringPanel = false;
    if (host) reveal(host, false);
    if (control) control.setAttribute('aria-expanded', 'false');
    if (focus && returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  }
  function openPanel(source = 'keyboard') {
    makeUI(); cancelClose(); returnFocus = control; mode = source; open = true; tick();
    if (source === 'keyboard' && host.isConnected) frame.focus({preventScroll:true});
  }
  window.addEventListener('click', event => {
    if (!owned(event)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (open && mode === 'click' && event.composedPath().includes(control)) closePanel(); else openPanel('click');
  }, on);
  for (const type of ['pointerdown','pointerup','mousedown','mouseup']) window.addEventListener(type, event => {
    if (owned(event)) event.stopImmediatePropagation();
  }, on);
  window.addEventListener('pointerdown', event => {
    if (open && !owned(event) && !event.composedPath().includes(host)) closePanel(false);
  }, on);
  window.addEventListener('keydown', event => {
    const typing = event.composedPath().some(node => node?.matches?.('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'));
    if (event.key.toLowerCase() === 'c' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !typing && /^\/watch\/\d+/.test(location.pathname) && root?.querySelector('video')) {
      event.preventDefault(); event.stopImmediatePropagation();
      const api = globalThis.DualSubsPlayerApi;
      if (api) void api.updateSettings({enabled: !api.getState().settings.enabled}).then(tick).catch(() => {});
    } else if (event.composedPath().includes(control) && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (open) closePanel(); else openPanel('keyboard');
    } else if (open && event.key === 'Escape') { event.preventDefault(); closePanel(); }
  }, on);
  function hide() { closePanel(false); if (control) reveal(control, false); if (indicator) reveal(indicator, false); slot?.remove(); entry?.remove(); }
  function tick() {
    if (destroyed) return;
    if (!alive()) { destroy(); return; }
    if (currentPath !== location.pathname) { currentPath = location.pathname; hide(); hoveringControl = false; }
    const api = globalThis.DualSubsPlayerApi;
    if (!api || !/^\/watch\/\d+/.test(location.pathname)) { hide(); return; }
    const video = [...document.querySelectorAll('video')].filter(v => v.getBoundingClientRect().width > 100).sort((a,b) => b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
    if (!video || document.fullscreenElement === video) { hide(); return; }
    root = document.fullscreenElement || video.closest('.watch-video--player-view, .NFPlayer, [data-uia="video-canvas"]') || video.parentElement;
    makeUI(); for (const node of [host,control,indicator]) if (node.parentElement !== root) root.append(node);
    const candidates = [...root.querySelectorAll(controlSelector)].map(c => c.closest('button') || c.querySelector('button')).filter(Boolean);
    anchor = candidates.find(painted) || candidates.find(c => c.getBoundingClientRect().width > 0) || null;
    const vr = video.getBoundingClientRect();
    const fullscreen = !!document.fullscreenElement;
    if (!fullscreen) slot.remove();
    const clock = fullscreen ? null : remainingTime(vr);
    let size = 56, left = vr.right - 80, top = vr.bottom - 88, nativeVisible = false;
    if (anchor) {
      const ar = anchor.getBoundingClientRect(); size = Math.max(52, Math.min(96, Math.max(ar.width, ar.height)));
      const icon = anchor.querySelector('svg'), ir = icon?.getBoundingClientRect();
      const iconWidth = ir?.width || ar.width * .8, iconHeight = ir?.height || ar.height * .8;
      // Align to the native SVG, rather than its wrapper's baseline or padding.
      const centerY = ir?.height ? ir.top + ir.height/2 : ar.top + ar.height/2;
      top = centerY - size/2;
      const branch = mountBranch(anchor);
      if (branch && fullscreen) {
        slot.style.width = `${size}px`; slot.style.height = `${size}px`; slot.style.margin = '0 6px';
        slot.style.order = getComputedStyle(branch).order;
        const layout = getComputedStyle(branch.parentElement), reverse = (layout.direction === 'rtl') !== (layout.flexDirection === 'row-reverse');
        if (reverse) { if (slot.previousElementSibling !== branch) branch.after(slot); }
        else if (slot.nextElementSibling !== branch) branch.before(slot);
        const sr = slot.getBoundingClientRect(); left = sr.left + (sr.width-size)/2;
      } else { slot.remove(); left = ar.left-size-10; }
      const ownIcon = control.firstChild;
      ownIcon.style.width = `${Math.min(size,iconWidth)}px`; ownIcon.style.height = `${Math.min(size,iconHeight)}px`;
      // Adding the spacer can change native layout; read the final icon position.
      const final = icon?.getBoundingClientRect() || anchor.getBoundingClientRect(); top = final.top + final.height/2-size/2;
      nativeVisible = painted(anchor);
    } else slot.remove();
    if (!fullscreen) {
      const tr = clock?.getBoundingClientRect(), ar = anchor?.getBoundingClientRect();
      left = Math.max(vr.left+8,Math.min(vr.right-size-8,(tr ? tr.left+tr.width/2 : vr.right-size/2-12)-size/2));
      top = Math.max(vr.top+8,(tr ? tr.top-8 : ar ? ar.top-44 : vr.bottom-128)-size);
      if (!anchor) { control.firstChild.style.width = `${size*.8}px`; control.firstChild.style.height = `${size*.8}px`; }
    }
    for (const [key,value] of Object.entries({left,top,width:size,height:size})) control.style.setProperty(key,`${value}px`,'important');
    // Windowed controls sit above the clock; fullscreen keeps the native CC row.
    // The separate status mark below cannot receive pointer or keyboard input.
    reveal(control, (!!anchor || !!clock) && (nativeVisible || !!clock || open), 'flex'); control.setAttribute('aria-expanded', String(open));
    control.dataset.placement = fullscreen ? 'cc-row' : 'above-time';
    control.dataset.enabled = String(!!api.getState().settings.enabled);
    const nativeIcon = anchor?.querySelector('svg');
    if (fullscreen && nativeIcon && !control.hidden) {
      top += visualCenterY(nativeIcon)-visualCenterY(control.firstChild);
      control.style.setProperty('top',`${top}px`,'important');
    }
    const settings = api.getState().settings;
    indicator.style.left = `${Math.max(12,Math.min(innerWidth,vr.right)-48)}px`;
    indicator.style.top = `${Math.max(12,Math.min(innerHeight,vr.bottom)-48)}px`;
    reveal(indicator, !!document.fullscreenElement && !nativeVisible && !open && settings.enabled && settings.showIndicator);
    const menu = [...root.querySelectorAll(menuSelector)].find(painted);
    if (menu) { if (entry.parentElement !== menu) menu.append(entry); } else entry.remove();
    if (open) {
      const visibleTop = Math.max(0, vr.top), visibleBottom = Math.min(innerHeight, vr.bottom);
      const width = Math.min(380, vr.width-24, innerWidth-24), height = Math.max(140,Math.min(560,visibleBottom-visibleTop-106,innerHeight-32));
      host.style.setProperty('left',`${Math.max(12,vr.left+12,Math.min(innerWidth-width-12,vr.right-width-12,fullscreen ? left : left-width-8))}px`,'important');
      host.style.setProperty('top',`${Math.max(12,visibleTop+12,Math.min(top-8,visibleBottom-88)-height)}px`,'important');
      host.style.setProperty('width',`${width}px`,'important'); host.style.setProperty('height',`${height}px`,'important');
      host.setAttribute('data-placement','player'); reveal(host,true);
    }
  }
  function start() {
    if (!document.body) { requestAnimationFrame(start); return; }
    if (destroyed) return;
    tick(); tickTimer = setInterval(() => { try { tick(); } catch { /* Netflix rebuilt its controls mid-tick. */ } }, 150);
    document.addEventListener('fullscreenchange', tick, {signal: lifetime.signal});
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; lifetime.abort(); clearInterval(tickTimer); cancelClose();
    for (const node of [host, control, indicator, slot, entry, document.getElementById('dual-subs-player-style')]) node?.remove();
  }
  globalThis.__dualSubsPlayerControlsV110 = {alive:()=>!destroyed&&alive(),destroy,open:()=>openPanel('keyboard'),close:()=>closePanel()};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
