(async () => {
  const results = [], output = document.getElementById('results');
  const assert = (value, message) => { if (!value) throw new Error(message || 'Assertion failed'); };
  const eq = (a,b) => assert(a===b,`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  const wait = async condition => {
    const until = Date.now()+14000;
    while (Date.now()<until) { if (await condition()) return; await new Promise(r=>setTimeout(r,50)); }
    throw new Error('Timed out');
  };
  const test = async (name, fn) => {
    try { await fn(); results.push({name,pass:true}); }
    catch(error) { results.push({name,pass:false,error:error.message}); }
    output.textContent=results.map(r=>`${r.pass?'PASS':'FAIL'} ${r.name}${r.error?' — '+r.error:''}`).join('\n');
  };
  const F=window.fixture, S=window.DualSubsSubtitles;
  const state=()=>F.request({type:'GET_STATE'});
  const shadow=()=>document.querySelector('#netflix-dual-subs')?.shadowRoot;
  const line=which=>shadow()?.querySelector('.'+which);
  await test('TTML ticks, explicit line breaks, nested offsets, and timed spans',()=>{
    const text='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000"><body begin="1s"><div begin="1s"><p begin="10000000t" dur="3s">Hello<br/>世界 <span begin="1s" dur="1s">timed</span></p></div></body></tt>';
    const t=S.parse(text);eq(t.at(3.5),'Hello\n世界');eq(t.at(4.5),'Hello\n世界 timed');eq(t.at(5.5),'Hello\n世界');eq(t.at(6),'');
  });
  await test('TTML frame timing, entities and invalid XML',()=>{
    const t=S.parse('<tt xmlns:ttp="urn:parameter" ttp:frameRate="25"><body><p begin="00:00:01:12" end="00:00:02:00">A &amp; B</p></body></tt>');eq(t.at(1.5),'A & B');
    let failed=false;try{S.parse('<tt><body>')}catch{failed=true}assert(failed);
  });
  await test('loaded player data yields actual title tracks and selected main language',async()=>{
    await wait(async()=>{const s=await state();return s.phase==='ready'&&s.primaryRendered;});
    const s=await state();eq(s.tracks.length,4);eq(s.primary,'English');eq(s.selectedId,'zh');
  });
  await test('secondary appears below main at 80% size with original Unicode text',async()=>{
    await wait(()=>line('secondary')?.textContent.includes('初恋'));
    eq(line('primary').textContent,'Main Netflix line\nSecond original line');
    const main=line('primary').getBoundingClientRect(),sub=line('secondary').getBoundingClientRect();
    assert(sub.top>=main.bottom+7,'Secondary overlaps the main line');
    const ratio=parseFloat(getComputedStyle(line('secondary')).fontSize)/parseFloat(getComputedStyle(line('primary')).fontSize);
    assert(Math.abs(ratio-.8)<.001);assert(document.querySelector('.watch-video--player-view').classList.contains('nds-own-primary'));
  });
  await test('introducing the second language preserves Netflix’s original main font size',()=>{
    const native=document.querySelector('.player-timedtext-text-container');
    eq(parseFloat(getComputedStyle(line('primary')).fontSize),parseFloat(getComputedStyle(native).fontSize));
  });
  await test('small subtitle timing differences align on both start and end, with original timing available',async()=>{
    window.fixtureTime=1.05;
    await wait(()=>line('primary').textContent.includes('Main Netflix')&&line('secondary').textContent.includes('初恋'));
    window.fixtureTime=4.05;await wait(()=>line('primary').textContent===''&&line('secondary').textContent==='');
    await F.request({type:'UPDATE_SETTINGS',settings:{alignTimings:false}});
    window.fixtureTime=1.05;await wait(()=>line('primary').textContent.includes('Main Netflix')&&line('secondary').textContent==='');
    window.fixtureTime=4.05;await wait(()=>line('primary').textContent===''&&line('secondary').textContent.includes('初恋'));
    await F.request({type:'UPDATE_SETTINGS',settings:{alignTimings:true}});
    window.fixtureTime=1.5;await wait(()=>line('primary').textContent.includes('Main Netflix')&&line('secondary').textContent.includes('初恋'));
  });
  await test('first-language slider changes only the first language',async()=>{
    const beforeMain=parseFloat(getComputedStyle(line('primary')).fontSize),beforeSecond=parseFloat(getComputedStyle(line('secondary')).fontSize);
    await F.request({type:'UPDATE_SETTINGS',settings:{primaryScale:150}});
    await wait(()=>parseFloat(getComputedStyle(line('primary')).fontSize)===beforeMain*1.5);
    eq(parseFloat(getComputedStyle(line('secondary')).fontSize),beforeSecond);
    await F.request({type:'UPDATE_SETTINGS',settings:{primaryScale:100}});
    await wait(()=>parseFloat(getComputedStyle(line('primary')).fontSize)===beforeMain);
  });
  await test('No background removes both subtitle boxes without losing saved opacity',async()=>{
    await F.request({type:'UPDATE_SETTINGS',settings:{noBackground:true,background:55}});
    await wait(()=>getComputedStyle(line('primary')).backgroundColor==='rgba(0, 0, 0, 0)');
    eq(getComputedStyle(line('secondary')).backgroundColor,'rgba(0, 0, 0, 0)');
    eq(getComputedStyle(line('primary')).borderTopWidth,'0px');eq(getComputedStyle(line('secondary')).boxShadow,'none');
    eq((await state()).settings.background,55);
    await F.request({type:'UPDATE_SETTINGS',settings:{noBackground:false}});
    await wait(()=>getComputedStyle(line('primary')).backgroundColor==='rgba(0, 0, 0, 0.55)');
    await F.request({type:'UPDATE_SETTINGS',settings:{background:35}});
  });
  await test('pause, seek, and cue gaps keep both languages synchronized',async()=>{
    window.fixtureTime=4.5;await wait(()=>line('secondary').textContent===''&&line('primary').textContent==='');
    window.fixtureTime=6.5;await wait(()=>line('secondary').textContent==='第二条字幕');eq(line('primary').textContent,'Another original cue');
    window.fixtureTime=1.5;await wait(()=>line('primary').textContent.startsWith('Main Netflix'));
  });
  await test('configurable size, zero spacing, background, and positive secondary delay',async()=>{
    await F.request({type:'UPDATE_SETTINGS',settings:{secondaryScale:60,gap:0,background:0,offset:1}});
    window.fixtureTime=1.5;await wait(()=>line('secondary').textContent==='');assert(line('primary').textContent);
    eq(shadow().querySelector('.stack').style.gap,'0px');
    window.fixtureTime=2.5;await wait(()=>line('secondary').textContent.includes('初恋'));
    await F.request({type:'UPDATE_SETTINGS',settings:{secondaryScale:80,gap:8,background:35,offset:0}});
  });
  await test('lazy secondary capture restores Netflix’s original main track',async()=>{
    await F.request({type:'SELECT_TRACK',id:'es'});
    await wait(async()=>{const s=await state();return s.phase==='ready'&&s.selectedId==='es'&&!s.capturing;});
    eq(F.api.getTimedTextTrack().trackId,'en');await wait(()=>line('secondary').textContent==='Otra voz.');
    eq(line('primary').textContent,'Main Netflix line\nSecond original line');
  });
  await test('unsupported subtitle file gives an error and restores native subtitles',async()=>{
    await F.request({type:'SELECT_TRACK',id:'broken'});
    await wait(async()=>(await state()).phase==='error');
    assert((await state()).status.includes('Image and binary'));
    await wait(()=>!document.querySelector('.watch-video--player-view').classList.contains('nds-own-primary'));
    await F.request({type:'SELECT_TRACK',id:'zh'});
    await wait(async()=>(await state()).primaryRendered);
  });
  await test('native primary remains visible when its file is unsupported',async()=>{
    F.setMain(F.broken);
    await wait(async()=>{const s=await state();return s.primary==='Image-only fixture'&&s.phase==='ready'&&!s.primaryRendered;});
    await wait(()=>document.querySelector('.watch-video--player-view').classList.contains('nds-native-primary'));
    eq(getComputedStyle(document.querySelector('.player-timedtext')).visibility,'visible');
    await F.request({type:'UPDATE_SETTINGS',settings:{primaryScale:150,noBackground:true}});
    await wait(()=>getComputedStyle(document.querySelector('.player-timedtext-text-container')).scale==='1.5');
    await F.request({type:'UPDATE_SETTINGS',settings:{primaryScale:100,noBackground:false}});
    F.setMain(F.en);await wait(async()=>(await state()).primaryRendered);
  });
  await test('same-language selection and disabling restore Netflix subtitles',async()=>{
    await F.request({type:'SELECT_TRACK',id:'en'});eq((await state()).phase,'waiting');
    await F.request({type:'SELECT_TRACK',id:'zh'});await wait(async()=>(await state()).phase==='ready');
    await F.request({type:'UPDATE_SETTINGS',settings:{enabled:false}});await wait(()=>!document.querySelector('.watch-video--player-view').classList.contains('nds-own-primary'));
    eq((await state()).phase,'off');
    await F.request({type:'UPDATE_SETTINGS',settings:{enabled:true}});await wait(async()=>(await state()).primaryRendered);
  });
  await test('Netflix Off hides secondary; reenabling main restores stack',async()=>{
    F.setMain({trackId:'none',isNoneTrack:true});await wait(async()=>(await state()).primary==='Off');
    await wait(()=>document.querySelector('#netflix-dual-subs').hidden);
    F.setMain(F.en);await wait(async()=>(await state()).primaryRendered);
  });
  await test('JSON observation preserves revivers and frozen requests',()=>{
    eq(JSON.parse('{"a":2}',(k,v)=>k==='a'?v*2:v).a,4);
    const params=Object.freeze({profiles:Object.freeze(['simplesdh']),showAllSubDubTracks:false});const req=Object.freeze({params});
    const parsed=JSON.parse(JSON.stringify(req));assert(parsed.params.profiles.includes('webvtt-lssdh-ios8'));eq(req.params.showAllSubDubTracks,false);
  });
  await test('fullscreen container changes keep the overlay inside the player',async()=>{
    const root=document.querySelector('.watch-video--player-view');
    const wrapper=document.createElement('div');wrapper.style.cssText='position:fixed;inset:0;z-index:999;background:#101819';
    const anchor=document.createComment('player');root.before(anchor);document.body.append(wrapper);wrapper.append(root);
    const previous=Object.getOwnPropertyDescriptor(document,'fullscreenElement');
    Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>wrapper});
    document.dispatchEvent(new Event('fullscreenchange'));
    await wait(()=>wrapper.contains(document.querySelector('#netflix-dual-subs')));
    assert(line('secondary').getBoundingClientRect().top>=line('primary').getBoundingClientRect().bottom);
    if(previous)Object.defineProperty(document,'fullscreenElement',previous);else delete document.fullscreenElement;
    anchor.replaceWith(root);wrapper.remove();document.dispatchEvent(new Event('fullscreenchange'));
    await wait(()=>root.contains(document.querySelector('#netflix-dual-subs')));
  });
  await test('episode navigation clears old subtitles and keeps the saved exact language',async()=>{
    const next=(await state()).movieId==='456'?'123':'456';
    history.pushState({},'', '/watch/'+next);F.setMovie(next);
    await wait(async()=>{const s=await state();return s.movieId===next&&s.phase==='ready'&&s.primaryRendered;});
    eq((await state()).selectedId,'zh');
  });
  window.fixtureTime=1.5;
  window.testResults={done:true,passed:results.filter(r=>r.pass).length,total:results.length,results};
  output.textContent+='\n\n'+`${window.testResults.passed}/${results.length} passed`;
  document.title=`${window.testResults.passed}/${results.length} PASS — Dual Subs`;
})();
