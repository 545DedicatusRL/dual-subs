const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/core.js');
const S = require('../extension/subtitles.js');
const fs = require('node:fs');
const path = require('node:path');
const url = 'https://subtitles.nflxvideo.net/track?signature=fixture';

test('manifest assets exist and permissions stay on Netflix hosts', () => {
  const root = path.join(__dirname, '../extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.deepEqual(manifest.permissions, ['storage','scripting']);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
  for (const script of manifest.content_scripts) for (const file of script.js) assert.ok(fs.existsSync(path.join(root, file)), file);
  for (const file of Object.values(manifest.icons)) assert.ok(fs.existsSync(path.join(root, file)));
  assert.ok(manifest.host_permissions.every(p => !p.includes('<all_urls>')));
});
test('CDN URLs reject other hosts, embedded credentials, ports and lookalike domains', () => {
  assert.ok(C.safeURL(url));
  for (const v of ['http://subtitles.nflxvideo.net/a', 'https://nflxvideo.net.evil.com/a', 'https://evilnflxvideo.net/a', 'https://user:pass@nflxvideo.net/a', 'https://nflxvideo.net:8443/a', 'file:///etc/passwd', 'https://127.0.0.1/a']) assert.equal(C.safeURL(v), false, v);
});
test('normalize both Netflix URL shapes; ignore image profiles and Off', () => {
  assert.equal(C.normalizeTrack({isNoneTrack: true}), null);
  const track = C.normalizeTrack({new_track_id: 'abc', language: 'zh-Hant', languageDescription: 'Traditional Chinese', rawTrackType: 'closedcaptions', ttDownloadables: {'nflx-cmisc': {urls: [{url}]}, simplesdh: {downloadUrls: {cdn: url}}, 'webvtt-lssdh-ios8': {urls: [{url: url + '2'}]}}});
  assert.equal(track.id, 'abc'); assert.equal(track.type, 'closedcaptions'); assert.match(track.label, /CC/);
  assert.equal(track.sources.length, 2); assert.equal(track.sources[0].profile, 'webvtt-lssdh-ios8');
});
test('language selection preserves writing system and caption/forced variants', () => {
  const tracks = [C.normalizeTrack({id:'a',language:'zh-Hans'}),C.normalizeTrack({id:'b',language:'zh-Hant'}),C.normalizeTrack({id:'c',language:'en',trackType:'closedcaptions'}),C.normalizeTrack({id:'d',language:'en',isForcedNarrative:true})];
  assert.equal(C.findPreferred(tracks, C.preference(tracks[1])).id, 'b');
  assert.equal(C.findPreferred(tracks, {language:'en',type:'subtitles',forced:false,variant:''}), null);
  assert.equal(C.findPreferred(tracks, {language:'zh',type:'subtitles',forced:false,variant:''}), null);
});
test('settings are bounded, retain zero and reject CSS strings', () => {
  const settings = C.cleanSettings({secondaryScale:999,gap:0,bottom:-5,background:0,color:'red;display:none',offset:-100});
  assert.equal(settings.secondaryScale, 200); assert.equal(settings.gap, 0); assert.equal(settings.background, 0); assert.equal(settings.bottom, 2); assert.equal(settings.offset, -10); assert.equal(settings.color, '#ffffff');
});
test('first-language size and text-only appearance are saved independently', () => {
  const settings = C.cleanSettings({primaryScale:175,secondaryScale:65,noBackground:true,background:45});
  assert.equal(settings.primaryScale,175); assert.equal(settings.secondaryScale,65); assert.equal(settings.noBackground,true); assert.equal(settings.background,45);
  assert.equal(C.cleanSettings({noBackground:'false'}).noBackground,false);
  assert.equal(C.cleanSettings({primaryScale:999}).primaryScale,250);
});
test('VTT handles CRLF, cue IDs, minute timestamps, ruby, entities and line breaks', () => {
  const text = '\ufeffWEBVTT\r\n\r\nSTYLE\r\n::cue {color:red}\r\n\r\nNOTE ignore\r\n\r\nfirst\r\n00:01.000 --> 00:03.500 position:50%\r\n<v Person>你好 &amp; <b>world</b>\r\n<ruby>猫<rt>ねこ</rt></ruby>\r\n\r\n00:00:04.000 --> 00:00:05.000\r\n&#x1F30D; &lt;3';
  const t = S.parse(text);
  assert.equal(t.at(1), '你好 & world\n猫'); assert.equal(t.at(3.5), ''); assert.equal(t.at(4.2), '🌍 <3');
});
test('Netflix VTT direction entities become invisible Unicode markers', () => {
  const t = S.parse('WEBVTT\n\n00:01.000 --> 00:04.000\n&lrm;Hello &amp; welcome.&lrm;\n&rlm;مرحبا بالعالم&rlm;');
  assert.equal(t.at(2), '\u200eHello & welcome.\u200e\n\u200fمرحبا بالعالم\u200f');
  assert.doesNotMatch(t.at(2), /&(?:lrm|rlm);/);
});
test('direction markers preserve numeric references and single-pass entity decoding', () => {
  const t = S.parse('WEBVTT\n\n00:01.000 --> 00:04.000\n&#8206;English&#x200E; / &#8207;עברית&#x200F; / &amp;lrm; / &lt;b&gt;');
  assert.equal(t.at(2), '\u200eEnglish\u200e / \u200fעברית\u200f / &lrm; / <b>');
});
test('overlapping cues, arbitrary seeks, gaps and exclusive ends', () => {
  const t = new S.Timeline([{start:1,end:100,text:'long'},{start:2,end:3,text:'short'},{start:60,end:65,text:'later'}]);
  assert.equal(t.at(64), 'long\nlater'); assert.equal(t.at(2.5), 'long\nshort'); assert.equal(t.at(3), 'long'); assert.equal(t.at(100), ''); assert.equal(t.at(0), '');
});
test('time parser supports ticks, offsets, frames and decimal clock times', () => {
  const rates = {tick:10000000,frame:25,subframe:2};
  assert.equal(S.time('20000000t', rates), 2); assert.equal(S.time('500ms',rates), .5); assert.equal(S.time('1.5m',rates), 90); assert.equal(S.time('00:00:01:12.1',rates), 1.5); assert.equal(S.time('01:02:03.45'), 3723.45);
});
test('unsupported binary tracks fail with an actionable message', () => { assert.throws(() => S.parse('binary data'), /Image and binary/); });
