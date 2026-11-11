const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const C = require('../extension/core.js');
const code = fs.readFileSync(require('node:path').join(__dirname, '../extension/background.js'), 'utf8');
const valid = {url:'https://www.netflix.com/watch/123',tab:{id:1}};
function worker(fetch, extras={}) {
  let listener;
  vm.runInNewContext(code, {importScripts(){}, DualSubsCore:C, chrome:{...extras,runtime:{id:'fixture-extension',getURL:file=>'chrome-extension://fixture-extension/'+file,onMessage:{addListener(fn){listener=fn;}}}}, fetch, URL, TextDecoder, Uint8Array, AbortController, setTimeout, clearTimeout});
  return (req, sender=valid) => new Promise(resolve => listener(req, sender, resolve));
}
test('worker denies spoofed hosts and non-Netflix senders before fetching', async () => {
  const run=worker(()=>{throw new Error('must not fetch');});
  for (const [url,sender] of [['https://evil.com/file',valid],['https://x.nflxvideo.net/a',{url:'https://evil.com/watch/123',tab:{id:1}}],['https://x.nflxvideo.net/a',{url:'https://www.netflix.com/watch/123'}]]) assert.match((await run({type:'FETCH_SUBTITLE',url},sender)).error,/allowed Netflix/);
});
test('worker requests no credentials and refuses redirects', async () => {
  let options;
  const run=worker(async (url,opts)=>{options=opts;return new Response('WEBVTT\n\n00:01.000 --> 00:02.000\nHello');});
  const result=await run({type:'FETCH_SUBTITLE',url:'https://x.nflxvideo.net/sub'});
  assert.match(result.text,/Hello/); assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error');
});
test('worker caps declared and streamed file size and reports expired URLs', async () => {
  const tooBig=worker(async()=>new Response('data',{headers:{'content-length':String(9*1024*1024)}}));
  assert.match((await tooBig({type:'FETCH_SUBTITLE',url:'https://x.nflxso.net/sub'})).error,/8 MB/);
  const streamed=worker(async()=>new Response(new Uint8Array(9*1024*1024)));
  assert.match((await streamed({type:'FETCH_SUBTITLE',url:'https://x.nflxso.net/sub'})).error,/8 MB/);
  const expired=worker(async()=>new Response('',{status:403}));
  assert.match((await expired({type:'FETCH_SUBTITLE',url:'https://x.nflxso.net/sub'})).error,/HTTP 403/);
});
test('isolated settings frame relays only to its Netflix tab’s main frame',async()=>{
  const calls=[];
  const run=worker(()=>{}, {tabs:{get:async id=>({id,url:'https://www.netflix.com/watch/123'}),sendMessage:async(...args)=>{calls.push(args);return {settings:{noBackground:true},tracks:[]};}}});
  const sender={id:'fixture-extension',url:'chrome-extension://fixture-extension/player-panel.html',tab:{id:7}};
  const result=await run({type:'PLAYER_PANEL_UPDATE_SETTINGS',settings:{noBackground:true}},sender);
  assert.equal(result.settings.noBackground,true);assert.equal(calls[0][0],7);
  assert.equal(calls[0][1].type,'UPDATE_SETTINGS');assert.equal(calls[0][2].frameId,0);
});
test('web pages and unrelated tabs cannot invoke settings frame messages',async()=>{
  let forwarded=false;
  const run=worker(()=>{}, {tabs:{get:async()=>({id:7,url:'https://example.com/'}),sendMessage:async()=>{forwarded=true;}}});
  const bad=await run({type:'PLAYER_PANEL_GET_STATE'},valid);assert.match(bad.error,/inside the Netflix player/);
  const sender={id:'fixture-extension',url:'chrome-extension://fixture-extension/player-panel.html',tab:{id:7}};
  assert.match((await run({type:'PLAYER_PANEL_GET_STATE'},sender)).error,/Netflix title/);assert.equal(forwarded,false);
});
