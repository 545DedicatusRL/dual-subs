/* Local fixtures only. Never loaded by manifest.json. No network or Netflix session. */
(() => {
  const url = id => `https://fixtures.nflxvideo.net/${id}.vtt`;
  const en = {trackId:'en',bcp47:'en',displayName:'English',rawTrackType:'subtitles'};
  const zh = {trackId:'zh',bcp47:'zh-Hans',displayName:'Simplified Chinese',rawTrackType:'subtitles'};
  const es = {trackId:'es',bcp47:'es',displayName:'Spanish',rawTrackType:'subtitles'};
  const broken = {trackId:'broken',bcp47:'de',displayName:'Image-only fixture',rawTrackType:'subtitles'};
  let movie = location.pathname.match(/^\/watch\/(\d+)/)?.[1] || '123', current = en;
  const all = [en,zh,es,broken];
  const files = {
    [url('en')]: 'WEBVTT\n\n00:01.000 --> 00:04.000\nMain Netflix line\nSecond original line\n\n00:06.000 --> 00:08.000\nAnother original cue',
    [url('zh')]: '<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000"><body><div><p begin="11000000t" end="41000000t">那是因为你仍带着初恋时的幻想</p><p begin="61000000t" end="81000000t">第二条字幕</p></div></body></tt>',
    [url('es')]: 'WEBVTT\n\n00:01.000 --> 00:04.000\nOtra voz.\n\n00:06.000 --> 00:08.000\nOtra línea.',
    [url('broken')]: 'BINARY IMAGE SUBTITLE FIXTURE'
  };
  const hydrated = ['en','zh','broken'].map(id=>({trackId:id,profile:'webvtt-lssdh-ios8',urls:[{url:url(id)}]}));
  const media = {nested:{obfuscated:{entries:hydrated}}};
  const changes=[], listeners=[];
  let saved = {settings:{enabled:true,secondary:{language:'zh-Hans',type:'subtitles',forced:false,variant:''}}};
  const api = {
    getMovieId:()=>movie,
    getTimedTextTrack:()=>current,
    getTimedTextTrackList:()=>all,
    setTimedTextTrack:track=>{
      current=track;
      if (track.trackId==='es' && !hydrated.some(e=>e.trackId==='es')) setTimeout(()=>hydrated.push({trackId:'es',profile:'webvtt-lssdh-ios8',urls:[{url:url('es')}]}),100);
    }
  };
  window.netflix={appContext:{state:{playerApp:{getAPI:()=>({videoPlayer:{getAllPlayerSessionIds:()=>['preview','watch-fixture'],getVideoPlayerBySessionId:()=>api}})}}},player:{MediaSession:media}};
  window.chrome={
    runtime:{id:'fixture-extension',getURL:file=>location.origin+'/extension/'+file,onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async request=>{
      if (request.type==='FETCH_SUBTITLE') { window.fetchCount++; if (!files[request.url]) return {error:'Fixture not found'}; return {text:files[request.url]}; }
    }},
    storage:{local:{get:async()=>saved,set:async update=>{const old=saved.settings;saved={...saved,...update};for(const fn of changes)fn({settings:{oldValue:old,newValue:saved.settings}},'local');}},onChanged:{addListener:fn=>changes.push(fn)}}
  };
  window.fetchCount=0;window.fixtureTime=1.5;
  window.fixture={api,en,zh,es,broken,files,url,hydrated,
    request:message=>new Promise(resolve=>{for(const fn of listeners)fn(message,{id:'fixture-extension'},resolve);}),
    setMain:track=>{current=track;},setMovie:id=>{movie=id;}
  };
  window.addEventListener('DOMContentLoaded',()=>{
    const v=document.querySelector('video');
    Object.defineProperties(v,{currentTime:{get:()=>window.fixtureTime},ended:{get:()=>false},paused:{get:()=>true}});
  });
})();
