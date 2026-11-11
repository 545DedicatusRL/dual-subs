(async()=>{
  const wait=async condition=>{const deadline=Date.now()+20000;while(Date.now()<deadline){if(await condition())return;await new Promise(r=>setTimeout(r,40));}throw new Error('Timed out');};
  const assert=(value,message)=>{if(!value)throw new Error(message||'Assertion failed');};
  await wait(()=>window.testResults?.done);
  const results=[...window.testResults.results],output=document.querySelector('#results');
  const test=async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(error){results.push({name,pass:false,error:error.message});}output.textContent=results.map(r=>`${r.pass?'PASS':'FAIL'} ${r.name}${r.error?' — '+r.error:''}`).join('\n');};
  const control=()=>document.querySelector('#dual-subs-player-launcher');
  const host=()=>document.querySelector('#dual-subs-player-settings');
  const frame=()=>document.querySelector('#dual-subs-player-panel');
  const doc=()=>frame()?.contentDocument;
  const $=id=>doc()?.getElementById(id);
  const anchor=()=>document.querySelector('[data-uia="control-audio-subtitle"]');
  const native=()=>document.querySelector('[data-uia="audio-subtitle-menu"]');
  const input=(id,value)=>{if(typeof value==='boolean')$(id).checked=value;else $(id).value=value;$(id).dispatchEvent(new (frame().contentWindow.Event)('input',{bubbles:true,composed:true}));};
  const ready=()=>doc()?.getElementById('secondary')?.options.length===5;
  const originalFullscreen=Object.getOwnPropertyDescriptor(document,'fullscreenElement');
  Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>document.querySelector('.watch-video--player-view')});document.dispatchEvent(new Event('fullscreenchange'));
  await test('fullscreen CC² hit target is immediately left of Netflix’s CC button',async()=>{
    await wait(()=>control()&&!control().hidden);
    const a=anchor().getBoundingClientRect(),b=control().getBoundingClientRect();
    assert(b.width>=52&&b.height>=52,'Button is too small');assert(b.width>=a.width,'Button is smaller than Netflix CC');assert(b.right<=a.left,'Button is not left of CC');
    const ni=anchor().querySelector('svg').getBoundingClientRect(),own=control().querySelector('svg').getBoundingClientRect();assert(Math.abs(own.top+own.height/2-ni.top-ni.height/2)<1,'Icons are vertically misaligned');assert(Math.abs(own.height-ni.height)<1,'Icon sizes differ');
    assert(document.querySelectorAll('.nds-player-control-slot').length===1);
  });
  await test('caption glyphs align even when the native SVG has extra viewBox padding',async()=>{
    const svg=anchor().querySelector('svg'),old=svg.getAttribute('viewBox');svg.setAttribute('viewBox','0 0 32 40');
    const center=node=>{const b=node.getBBox(),m=node.getScreenCTM();return new DOMPoint(b.x+b.width/2,b.y+b.height/2).matrixTransform(m).y;};
    await wait(()=>Math.abs(center(svg)-center(control().firstChild))<.5);svg.setAttribute('viewBox',old);await wait(()=>Math.abs(center(svg)-center(control().firstChild))<.5);
  });
  await test('icon exponent stays inside the caption bubble',()=>{const r=control().querySelectorAll('text')[1].getBBox();assert(r.x>=3&&r.x+r.width<=29&&r.y>=5&&r.y+r.height<=25);});
  if(originalFullscreen)Object.defineProperty(document,'fullscreenElement',originalFullscreen);else delete document.fullscreenElement;document.dispatchEvent(new Event('fullscreenchange'));
  const clock=()=>document.querySelector('.time-remaining__time');
  const aboveClock=()=>{const c=control()?.getBoundingClientRect(),t=clock()?.getBoundingClientRect();return c&&t&&c.bottom<=t.top-7&&Math.abs(c.left+c.width/2-t.left-t.width/2)<1;};
  await test('windowed CC² sits directly above remaining time with no overlap or reserved CC slot',async()=>{
    await wait(()=>control().dataset.placement==='above-time'&&aboveClock());assert(!document.querySelector('.nds-player-control-slot'),'Windowed mode changed the native CC row');
    const r=clock().getBoundingClientRect();assert(clock().contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),'Button covers the clock');
  });
  await test('windowed icon follows clock position and changed Netflix clock classes',async()=>{
    const t=clock();t.style.right='30px';await wait(aboveClock);t.className='renamed-clock';t.style.right='40px';
    await wait(()=>{const c=control().getBoundingClientRect(),r=t.getBoundingClientRect();return c.bottom<=r.top-7&&Math.abs(c.left+c.width/2-r.left-r.width/2)<1;});
    t.className='time-remaining__time';t.style.right='0';await wait(aboveClock);
  });
  await test('CC² remains the pointer hit target above a Netflix-style overlay',()=>{
    const r=control().getBoundingClientRect(),overlay=document.createElement('div');
    overlay.style.cssText=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:2147483647;pointer-events:auto`;
    document.querySelector('.watch-video--player-view').append(overlay);
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);assert(hit===control()||control().contains(hit),'Overlay intercepts the button');overlay.remove();
  });
  await test('CC² opens a clickable isolated settings surface inside the player',async()=>{
    control().click();await wait(()=>host()&&!host().hidden&&ready());
    const r=frame().getBoundingClientRect();assert(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===frame(),'Panel is covered by another element');
    assert(document.querySelector('.watch-video--player-view').contains(frame()));
  });
  await test('Netflix’s original menu stays intact and its new entry opens settings',async()=>{
    $('close').click();await wait(()=>host().hidden);
    anchor().click();await wait(()=>native().querySelector('.nds-native-menu-entry'));
    assert(native().style.maxHeight==='');assert(!native().classList.contains('nds-enhanced-audio-menu'));
    native().querySelector('.nds-native-menu-entry').click();await wait(()=>!host().hidden&&ready());
  });
  await test('settings events cannot bubble into Netflix’s player handlers',async()=>{
    let calls=0;const spy=()=>calls++;
    document.addEventListener('input',spy,true);document.addEventListener('click',spy,true);
    input('primaryScale',160);input('secondaryScale',70);
    await wait(()=>DualSubsPlayerApi.getState().settings.primaryScale===160&&DualSubsPlayerApi.getState().settings.secondaryScale===70);
    assert(calls===0,'A settings event reached the parent player');
    document.removeEventListener('input',spy,true);document.removeEventListener('click',spy,true);
  });
  await test('both sizes and all advanced settings persist from the isolated panel',async()=>{
    input('noBackground',true);input('alignTimings',false);input('gap',5);input('bottom',10);input('background',55);input('color','#ffeedd');input('offset',.3);
    await wait(()=>DualSubsPlayerApi.getState().settings.offset===.3);
    const s=DualSubsPlayerApi.getState().settings;
    assert(s.noBackground&&s.alignTimings===false&&s.gap===5&&s.bottom===10&&s.background===55&&s.color==='#ffeedd');
    const lines=document.querySelector('#netflix-dual-subs').shadowRoot;
    await wait(()=>getComputedStyle(lines.querySelector('.primary')).backgroundColor==='rgba(0, 0, 0, 0)');
  });
  await test('second-language selection and reset work inside the panel',async()=>{
    $('secondary').value='es';$('secondary').dispatchEvent(new (frame().contentWindow.Event)('change',{bubbles:true}));
    await wait(()=>DualSubsPlayerApi.getState().selectedId==='es'&&DualSubsPlayerApi.getState().phase==='ready');
    $('reset').click();await wait(()=>DualSubsPlayerApi.getState().settings.primaryScale===100&&DualSubsPlayerApi.getState().settings.alignTimings&&DualSubsPlayerApi.getState().settings.offset===0);
    assert(DualSubsPlayerApi.getState().selectedId==='es');
  });
  await test('close and keyboard activation work without changing playback',async()=>{
    const time=fixtureTime;$('close').click();await wait(()=>host().hidden);
    control().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,composed:true}));await wait(()=>!host().hidden&&ready());
    doc().dispatchEvent(new (frame().contentWindow.KeyboardEvent)('keydown',{key:'Escape',bubbles:true}));await wait(()=>host().hidden);assert(fixtureTime===time);
  });
  await test('button repositions after Netflix rerenders its control wrapper',async()=>{
    const old=anchor(),replacement=old.cloneNode(true);old.replaceWith(replacement);
    await wait(()=>!control().hidden&&aboveClock());
    assert(document.querySelectorAll('#dual-subs-player-launcher').length===1);
  });
  await test('CC² follows the visibility of Netflix’s control bar',async()=>{
    const bar=document.querySelector('.watch-video--bottom-controls-container');bar.style.opacity='0';await wait(()=>control().hidden);
    bar.style.opacity='1';await wait(()=>!control().hidden);
  });
  await test('settings surface follows fullscreen container changes',async()=>{
    control().click();await wait(()=>!host().hidden&&ready());
    const player=document.querySelector('.watch-video--player-view'),wrap=document.createElement('div'),marker=document.createComment('player');
    wrap.style.cssText='position:fixed;inset:0;z-index:999;background:#111';player.before(marker);document.body.append(wrap);wrap.append(player);
    const old=Object.getOwnPropertyDescriptor(document,'fullscreenElement');Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>wrap});document.dispatchEvent(new Event('fullscreenchange'));
    await wait(()=>wrap.contains(host())&&wrap.contains(control())&&ready());
    if(old)Object.defineProperty(document,'fullscreenElement',old);else delete document.fullscreenElement;
    marker.replaceWith(player);wrap.remove();document.dispatchEvent(new Event('fullscreenchange'));await wait(ready);
  });
  await test('hidden fullscreen controls show only the optional non-clickable enabled mark',async()=>{
    __dualSubsPlayerControlsV110.close();const old=Object.getOwnPropertyDescriptor(document,'fullscreenElement'),player=document.querySelector('.watch-video--player-view');Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>player});
    const bar=document.querySelector('.watch-video--bottom-controls-container');bar.style.opacity='0';
    const mark=()=>document.querySelector('#dual-subs-enabled-indicator');await DualSubsPlayerApi.updateSettings({enabled:true,showIndicator:true});await wait(()=>!mark().hidden&&control().hidden);
    assert(mark().tagName==='DIV'&&getComputedStyle(mark()).pointerEvents==='none'&&!mark().hasAttribute('tabindex'));const r=mark().getBoundingClientRect();assert(!mark().contains(document.elementFromPoint(r.left+16,r.top+16)));
    await DualSubsPlayerApi.updateSettings({showIndicator:false});await wait(()=>mark().hidden);await DualSubsPlayerApi.updateSettings({showIndicator:true,enabled:false});await wait(()=>mark().hidden);
    await DualSubsPlayerApi.updateSettings({enabled:true});await wait(()=>!mark().hidden);bar.style.opacity='1';await wait(()=>!control().hidden&&mark().hidden);
    if(old)Object.defineProperty(document,'fullscreenElement',old);else delete document.fullscreenElement;document.dispatchEvent(new Event('fullscreenchange'));
  });
  await test('C toggles subtitles and ignores typing, repeats, modifiers and other pages',async()=>{
    const key=(target,options={})=>target.dispatchEvent(new KeyboardEvent('keydown',{key:'c',bubbles:true,composed:true,...options}));
    await DualSubsPlayerApi.updateSettings({enabled:true});key(document);await wait(()=>!DualSubsPlayerApi.getState().settings.enabled);key(document);await wait(()=>DualSubsPlayerApi.getState().settings.enabled);
    const field=document.createElement('input');document.body.append(field);key(field);key(document,{ctrlKey:true});key(document,{repeat:true});assert(DualSubsPlayerApi.getState().settings.enabled);field.remove();
    const path=location.pathname;history.pushState({},'','/browse');key(document);assert(DualSubsPlayerApi.getState().settings.enabled);history.replaceState({},'',path);
  });
  await test('hover opens, stays open on the panel, then closes after leaving',async()=>{
    __dualSubsPlayerControlsV110.close();document.querySelector('h1').focus();control().dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));await wait(()=>!host().hidden);
    control().dispatchEvent(new PointerEvent('pointerleave'));host().dispatchEvent(new PointerEvent('pointerenter'));await new Promise(r=>setTimeout(r,400));assert(!host().hidden,'Menu closed while hovering its panel');
    host().dispatchEvent(new PointerEvent('pointerleave'));await wait(()=>host().hidden);
    __dualSubsPlayerControlsV110.open();await wait(()=>!host().hidden&&ready());input('showIndicator',false);await wait(()=>!DualSubsPlayerApi.getState().settings.showIndicator);input('showIndicator',true);await wait(()=>DualSubsPlayerApi.getState().settings.showIndicator);
  });
  await test('windowed clock keeps the button available while native CC rerenders',async()=>{
    __dualSubsPlayerControlsV110.close();const a=anchor(),parent=a.parentNode,next=a.nextSibling;a.remove();await wait(()=>!control().hidden&&aboveClock());parent.insertBefore(a,next);await wait(()=>!control().hidden);
    __dualSubsPlayerControlsV110.open();await wait(()=>!host().hidden&&ready());
  });
  await test('settings stay on screen when the page has scrolled',async()=>{
    window.scrollTo(0,250);
    await wait(()=>host().getBoundingClientRect().top>=0&&host().getBoundingClientRect().bottom<=document.querySelector('video').getBoundingClientRect().bottom-70);
    const rect=host().getBoundingClientRect();assert(rect.bottom<=innerHeight,'Settings extend past the viewport');
    window.scrollTo(0,0);
  });
  await DualSubsPlayerApi.selectTrack('zh');await DualSubsPlayerApi.updateSettings({noBackground:true});native().hidden=true;
  window.testResults={done:true,passed:results.filter(r=>r.pass).length,total:results.length,results};
  output.textContent+='\n\n'+`${window.testResults.passed}/${results.length} passed`;document.title=`${window.testResults.passed}/${results.length} PASS — Dual Subs 1.2.0`;
})();
