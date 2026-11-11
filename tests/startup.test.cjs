const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8');
function harness({ready=false,current='https://www.netflix.com/watch/123'}={}){
  const events={},calls=[];
  const chrome={runtime:{onMessage:{addListener(){}},onInstalled:{addListener:f=>events.installed=f},onStartup:{addListener:f=>events.startup=f}},tabs:{onUpdated:{addListener:f=>events.updated=f},get:async id=>({id,url:current}),query:async()=>[{id:7,url:current},{id:8,url:'https://example.com/watch/123'}],sendMessage:async(id,msg,options)=>{calls.push({id,msg,options});return {ok:ready};}},scripting:{executeScript:async options=>{calls.push(options);}}};
  vm.runInNewContext(code,{chrome,importScripts(){},DualSubsCore:require('../extension/core.js'),URL});return {events,calls};
}
test('opening or switching a Netflix title installs missing scripts without opening the menu',async()=>{
  const h=harness();await h.events.updated(7,{url:'https://www.netflix.com/watch/123'},{id:7});
  assert.equal(h.calls[0].msg.type,'PLAYER_READY');assert.equal(h.calls[0].options.frameId,0);assert.deepEqual(h.calls.slice(1).map(c=>c.world),['ISOLATED','MAIN']);assert.ok(h.calls[1].files.includes('player-controls.js'));assert.equal(h.calls.length,3);
});
test('a healthy page is not reinjected or opened when video navigation completes',async()=>{
  const h=harness({ready:true});await h.events.updated(7,{status:'complete'},{id:7,url:'https://www.netflix.com/watch/123'});assert.equal(h.calls.length,1);assert.equal(h.calls[0].msg.type,'PLAYER_READY');
});
test('installation and browser restart repair already-open playback tabs only',async()=>{
  for(const event of ['installed','startup']){const h=harness();await h.events[event]();assert.equal(h.calls.length,3);assert.ok(h.calls.every(c=>c.id===7||c.target?.tabId===7));}
});
test('automatic startup ignores unrelated sites and rechecks tabs that navigate away',async()=>{
  const h=harness({current:'https://example.com/'});await h.events.updated(7,{url:'https://example.com/watch/123'},{id:7});assert.equal(h.calls.length,0);await h.events.updated(7,{url:'https://www.netflix.com/watch/123'},{id:7});assert.equal(h.calls.length,1);
});
test('concurrent Netflix startup events share one installation',async()=>{
  const h=harness(),tab={id:7,url:'https://www.netflix.com/watch/123'};await Promise.all([h.events.updated(7,{url:tab.url},tab),h.events.updated(7,{status:'complete'},tab)]);assert.equal(h.calls.filter(c=>c.world==='ISOLATED').length,1);
});
test('fullscreen indicator preference defaults on and accepts only a saved boolean',()=>{
  const C=require('../extension/core.js');assert.equal(C.cleanSettings().showIndicator,true);assert.equal(C.cleanSettings({showIndicator:false}).showIndicator,false);assert.equal(C.cleanSettings({showIndicator:'false'}).showIndicator,true);
});
