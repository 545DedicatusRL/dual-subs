const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../extension');
const bridge = fs.readFileSync(path.join(root, 'page-bridge.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
function harness(sessions, players) {
  const sent = [], callbacks = {}, timers = [];
  const api = {getAllPlayerSessionIds: () => sessions, getVideoPlayerBySessionId: id => players[id]};
  const context = vm.createContext({URL, Node: class {}, performance, location: {pathname:'/watch/123',origin:'https://www.netflix.com'}, setInterval:fn=>{timers.push(fn);return timers.length;},setTimeout,clearTimeout});
  context.capture = data => sent.push(data);
  context.register = (type, fn) => callbacks[type] = fn;
  context.netflix = {appContext:{state:{playerApp:{getAPI:()=>({videoPlayer:api})}}}};
  vm.runInContext('window=globalThis;window.postMessage=(data)=>capture(data);window.addEventListener=(type,fn)=>register(type,fn);', context);
  vm.runInContext(core,context);vm.runInContext(bridge,context);
  const hello = () => vm.runInContext("window.dispatchFixture({source:window,origin:location.origin,data:{channel:'dual-subs/v1',from:'extension',type:'HELLO'}})",context);
  context.dispatchFixture = event => callbacks.message(event);
  return {context,sent,timers,hello,state:()=>sent.filter(m=>m.type==='STATE').at(-1)};
}
const tracks=[{trackId:'en',bcp47:'en',displayName:'English'},{trackId:'zh',bcp47:'zh-Hans',displayName:'Simplified Chinese'}];
const player=id=>({getMovieId:()=>id,getTimedTextTrackList:()=>tracks,getTimedTextTrack:()=>tracks[0]});
test('connection chooses the active title among opaque player session IDs',()=>{
  const h=harness(['opaque-main','opaque-preview'],{'opaque-main':player(123),'opaque-preview':player(999)});
  h.hello();assert.equal(h.state()?.tracks.length,2);assert.equal(h.state()?.movieId,'123');
});
test('a later watch session must not suppress the current title’s languages',()=>{
  const h=harness(['watch-main','watch-buffer'],{'watch-main':player(123),'watch-buffer':player(999)});
  h.hello();assert.equal(h.state()?.tracks.length,2);assert.equal(h.state()?.primary.label,'English');
});
test('cached manifest tracks stay selectable when only a preview player is found',()=>{
  const h=harness(['preview'],{preview:player(999)});
  vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify({result:{movieId:123,timedtexttracks:tracks}}))})`,h.context);
  h.hello();assert.equal(h.state()?.tracks.length,2);assert.equal(h.state()?.diagnostics.playerFound,false);
});
test('missing player API returns useful connection details instead of silence',()=>{
  const h=harness([],{});h.context.netflix={};h.hello();
  assert.equal(h.state()?.diagnostics.apiFound,false);assert.equal(h.state()?.diagnostics.playerFound,false);
});
test('reconnection does not install duplicate page hooks or timers',()=>{
  const h=harness(['main'],{main:player(123)});h.hello();
  const parse=vm.runInContext('JSON.parse',h.context);
  vm.runInContext(core,h.context);vm.runInContext(bridge,h.context);
  assert.equal(vm.runInContext('JSON.parse',h.context),parse);assert.equal(h.timers.length,1);
});
test('browse-page preview manifests do not evict the title you then play',()=>{
  const h=harness(['main'],{main:player(123)});
  const manifest=(id,url)=>vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify({result:{movieId:id,timedtexttracks:[{new_track_id:'T:'+id,bcp47:'zh-Hans',displayName:'Simplified Chinese',ttDownloadables:{'webvtt-lssdh-ios8':{downloadUrls:{a:url}}}}]}}))})`,h.context);
  manifest(123,'https://x.nflxvideo.net/123.vtt');
  for(let i=0;i<20;i++)manifest(9000+i,`https://x.nflxvideo.net/${i}.vtt`);
  h.hello();
  const zh=h.state().tracks.filter(t=>t.language==='zh-Hans');
  assert.equal(zh.length,1,'manifest and player entries for one language are merged');
  assert.equal(zh[0].sources[0]?.url,'https://x.nflxvideo.net/123.vtt');
});
test('player and manifest IDs for the same language resolve to one track with sources',()=>{
  const h=harness(['main'],{main:player(123)});h.hello();
  vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify({movieId:123,timedtexttracks:[{new_track_id:'T:1;zh',bcp47:'zh-Hans',displayName:'Simplified Chinese',ttDownloadables:{'webvtt-lssdh-ios8':{downloadUrls:{a:'https://x.nflxvideo.net/zh.vtt'}}}}]}))})`,h.context);
  h.hello();
  const s=h.state();assert.equal(s.tracks.length,2);
  const zh=s.tracks.find(t=>t.language==='zh-Hans');assert.equal(zh.id,'zh');assert.equal(zh.sources.length,1);assert.equal(zh.aliases,undefined);
});
