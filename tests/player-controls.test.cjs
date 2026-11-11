const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const manifest=require('../extension/manifest.json');
test('player build loads its in-player interface and has no toolbar popup',()=>{
  assert.equal(manifest.version,'1.2.0');assert.equal(manifest.action.default_popup,undefined);
  assert.ok(manifest.content_scripts.find(s=>s.world==='ISOLATED').js.includes('player-controls.js'));
  assert.deepEqual(manifest.web_accessible_resources[0].resources,['player-panel.html']);
});
function harness(existing=false) {
  let action;const calls=[];
  const code=fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8');
  const chrome={runtime:{onMessage:{addListener(){}}},action:{onClicked:{addListener:fn=>action=fn}},
    scripting:{executeScript:async options=>calls.push(options)},tabs:{sendMessage:async(id,message)=>{
      calls.push({id,message});if(!existing){existing=true;throw new Error('No page script');}return {ok:true};
    }}};
  vm.runInNewContext(code,{importScripts(){},DualSubsCore:require('../extension/core.js'),chrome,URL});
  return {calls,click:tab=>action(tab)};
}
test('toolbar action opens the player panel without navigating or creating a popup',async()=>{
  const h=harness(true);await h.click({id:1,url:'https://www.netflix.com/watch/123'});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].message.type,'OPEN_PLAYER_SETTINGS');
});
test('toolbar repairs a pre-existing Netflix tab before opening player settings',async()=>{
  const h=harness();await h.click({id:1,url:'https://www.netflix.com/watch/123'});
  assert.equal(h.calls[1].world,'ISOLATED');assert.ok(h.calls[1].files.includes('player-controls.js'));
  assert.equal(h.calls[2].world,'MAIN');assert.equal(h.calls[3].message.type,'OPEN_PLAYER_SETTINGS');
});
test('toolbar action never injects player controls into unrelated tabs',async()=>{
  const h=harness();await h.click({id:1,url:'https://example.com/watch/123'});assert.equal(h.calls.length,0);
});
