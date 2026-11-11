importScripts('core.js');
const C = globalThis.DualSubsCore;
const MAX_BYTES = 8 * 1024 * 1024;
const playerInstalls = new Map();
function playbackTab(tab) {
  try { const u = new URL(tab.url); return Number.isInteger(tab.id) && u.protocol === 'https:' && (u.hostname === 'netflix.com' || u.hostname.endsWith('.netflix.com')) && /^\/watch\/\d+/.test(u.pathname); } catch { return false; }
}
async function installPlayer(tabId) {
  await chrome.scripting.executeScript({target:{tabId, frameIds:[0]}, world:'ISOLATED', files:['core.js','subtitles.js','content.js','player-controls.js']});
  await chrome.scripting.executeScript({target:{tabId, frameIds:[0]}, world:'MAIN', files:['core.js','page-bridge.js']});
}
async function ensurePlayer(tab) {
  if (!playbackTab(tab)) return;
  if (playerInstalls.has(tab.id)) return playerInstalls.get(tab.id);
  const task = (async () => {
    try { if ((await chrome.tabs.sendMessage(tab.id, {type:'PLAYER_READY'}, {frameId:0}))?.ok) return; } catch {}
    // Recheck after async work: never install into a tab that has navigated away.
    const current = await chrome.tabs.get(tab.id);
    if (playbackTab(current)) await installPlayer(tab.id);
  })().catch(() => {}).finally(() => playerInstalls.delete(tab.id));
  playerInstalls.set(tab.id, task);
  return task;
}
// Static document_start injection handles new pages; these events also recover
// already-open tabs and Netflix's in-page navigation without a toolbar click.
chrome.tabs?.onUpdated?.addListener((id, change, tab) => {
  if (change.url || change.status === 'complete') return ensurePlayer({...tab, id, url:change.url || tab.url});
});
async function restorePlayers() {
  try { await Promise.all((await chrome.tabs.query({url:['https://*.netflix.com/*']})).map(ensurePlayer)); } catch {}
}
chrome.runtime.onInstalled?.addListener(restorePlayers);
chrome.runtime.onStartup?.addListener(restorePlayers);

chrome.runtime.onMessage.addListener((request, sender, respond) => {
  const panelRoutes={PLAYER_PANEL_GET_STATE:'GET_STATE',PLAYER_PANEL_UPDATE_SETTINGS:'UPDATE_SETTINGS',PLAYER_PANEL_SELECT_TRACK:'SELECT_TRACK',PLAYER_PANEL_REFRESH:'REFRESH_TRACKS',PLAYER_PANEL_RETRY:'RETRY',PLAYER_PANEL_CLOSE:'CLOSE_PLAYER_SETTINGS'};
  if(Object.hasOwn(panelRoutes,request?.type)){
    if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('player-panel.html')||!Number.isInteger(sender.tab?.id)){respond({error:'Settings must be opened inside the Netflix player.'});return;}
    (async()=>{try{
      const tab=await chrome.tabs.get(sender.tab.id),u=new URL(tab.url);
      if(u.protocol!=='https:'||!(u.hostname==='netflix.com'||u.hostname.endsWith('.netflix.com'))||!/^\/watch\/\d+/.test(u.pathname))throw new Error('Open a Netflix title to use these settings.');
      const message={type:panelRoutes[request.type]};
      if(request.type==='PLAYER_PANEL_UPDATE_SETTINGS')message.settings=request.settings;
      if(request.type==='PLAYER_PANEL_SELECT_TRACK')message.id=request.id;
      respond(await chrome.tabs.sendMessage(tab.id,message,{frameId:0}));
    }catch(error){respond({error:error.message});}})();return true;
  }
  if (request?.type !== 'FETCH_SUBTITLE') return;
  // Only Netflix content scripts may fetch, and only from the declared Netflix CDN hosts.
  let validSender = false;
  try { const u = new URL(sender.url); validSender = !!sender.tab && u.protocol === 'https:' && (u.hostname === 'netflix.com' || u.hostname.endsWith('.netflix.com')) && /^\/watch\/\d+/.test(u.pathname); } catch {}
  if (!validSender || !C.safeURL(request.url)) { respond({error: 'Subtitle request is outside the allowed Netflix domains.'}); return; }
  (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(request.url, {credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal});
      if (!response.ok) throw new Error(`Netflix subtitle request failed (HTTP ${response.status}). Retry, or reload the title to refresh the file URL.`);
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('The subtitle file exceeds the 8 MB limit.');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('The subtitle file exceeds the 8 MB limit.'); }
        chunks.push(value);
      }
      const result = new Uint8Array(size);
      let offset = 0;
      for (const bytes of chunks) { result.set(bytes, offset); offset += bytes.length; }
      const utf16 = result[0] === 0xff && result[1] === 0xfe ? 'utf-16le' : result[0] === 0xfe && result[1] === 0xff ? 'utf-16be' : 'utf-8';
      respond({text: new TextDecoder(utf16).decode(result)});
    } catch (error) { respond({error: error.name === 'AbortError' ? 'The subtitle request timed out. Retry the track.' : error.message}); }
    finally { clearTimeout(timeout); }
  })();
  return true;
});

// Clicking the toolbar icon opens settings in the player; this build has no action popup.
chrome.action?.onClicked.addListener(async tab => {
  if (!playbackTab(tab)) return;
  try {
    try { if ((await chrome.tabs.sendMessage(tab.id, {type: 'OPEN_PLAYER_SETTINGS'}, {frameId: 0}))?.ok) return; } catch { /* Scripts missing or orphaned by an update. */ }
    await installPlayer(tab.id);
    await chrome.tabs.sendMessage(tab.id, {type: 'OPEN_PLAYER_SETTINGS'}, {frameId: 0});
  } catch { /* The tab may have closed. No account or playback settings are changed. */ }
});
