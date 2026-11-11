const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('../extension/subtitles.js');
const C=require('../extension/core.js');
const cue=(start,end,text='line')=>({start,end,text});
test('minor early/late starts and ends share the main subtitle boundaries',()=>{
  const primary=new S.Timeline([cue(1,4,'main'),cue(6,8,'main next')]);
  const secondary=new S.Timeline([cue(1.1,4.12,'second'),cue(5.9,7.9,'second next')]);
  const aligned=S.alignToPrimary(secondary,primary);
  assert.equal(aligned.at(1.05),'second');assert.equal(aligned.at(4.05),'');
  assert.equal(aligned.at(5.95),'');assert.equal(aligned.at(6),'second next');
  assert.deepEqual(secondary.cues,[cue(1.1,4.12,'second'),cue(5.9,7.9,'second next')]);
});
test('larger intentional timing differences and split translations are preserved',()=>{
  const primary=new S.Timeline([cue(1,4)]);
  const secondary=new S.Timeline([cue(1.4,4.4,'offset')]);
  assert.deepEqual(S.alignToPrimary(secondary,primary).cues,secondary.cues);
  const split=new S.Timeline([cue(1,2.5,'first part'),cue(2.5,4,'second part')]);
  assert.deepEqual(S.alignToPrimary(split,primary).cues,split.cues);
});
test('alignment does not introduce overlapping secondary lines',()=>{
  const primary=new S.Timeline([cue(1,2.1,'one'),cue(2,3,'two')]);
  const secondary=new S.Timeline([cue(1,2,'uno'),cue(2.15,3.05,'dos')]);
  const aligned=S.alignToPrimary(secondary,primary);
  assert.equal(aligned.at(2.05),'');assert.deepEqual(aligned.cues,secondary.cues);
});
test('alignment handles empty tracks and retains manual secondary delay',()=>{
  const secondary=new S.Timeline([cue(1.1,4.1)]);
  assert.equal(S.alignToPrimary(secondary,new S.Timeline([])),secondary);
  const aligned=S.alignToPrimary(secondary,new S.Timeline([cue(1,4)]));
  assert.equal(aligned.at(1.1-.3),'');assert.equal(aligned.at(1.4-.3),'line');
});
test('alignment includes the 200 ms boundary despite floating-point representation',()=>{
  const primary=new S.Timeline([cue(.1,1.1)]);
  const aligned=S.alignToPrimary(new S.Timeline([cue(.1+.2,1.1+.2)]),primary);
  assert.equal(aligned.cues[0].start,.1);assert.equal(aligned.cues[0].end,1.1);
});
test('timing matching defaults on and can be disabled without changing stored offsets',()=>{
  assert.equal(C.cleanSettings().alignTimings,true);
  const settings=C.cleanSettings({alignTimings:false,offset:.4});
  assert.equal(settings.alignTimings,false);assert.equal(settings.offset,.4);
});
