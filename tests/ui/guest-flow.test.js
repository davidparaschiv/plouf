import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'vite';
import {JSDOM} from 'jsdom';

// Run the real app and DOM event handlers; replace only network, audio and graphics.
test('guest can retry Join after a closed room opens, then sees the podium when all guests finish',async()=>{
 const result=await build({configFile:false,logLevel:'silent',plugins:[{
  name:'ui-test-services',enforce:'pre',load(id){
   if(id.endsWith('/src/api.js'))return `export const rpc=(...args)=>window.testServer.rpc(...args);export const connect=async()=>({storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'data:image/png;base64,iVBORw0KGgo='}})})}});`;
   if(id.endsWith('/src/effects.js'))return `export const setAtmosphere=()=>{};export const reward=()=>{};export const itemReward=()=>{};`;
   if(id.endsWith('/src/music.js'))return `export const MUSIC_TRACKS=[];export class RoomMusic{constructor(){this.enabled=true}preload(){return Promise.resolve()}unlock(){}setTrack(value){this.track=value}toggle(){return this.enabled=!this.enabled}}`;
  }
 }],build:{write:false,minify:false,rollupOptions:{input:'src/main.js',output:{format:'iife',inlineDynamicImports:true}}}});
 const code=result.output.find(file=>file.type==='chunk'&&file.isEntry).code;
 const html=await readFile('index.html','utf8');
 const languages=JSON.parse(await readFile('public/lang.json','utf8'));
 const catalog=JSON.parse(await readFile('public/characters.json','utf8'));
 const packagedGuide=await readFile('src/painting-guide.txt','utf8');
 let copiedGuide='',denyClipboard=false;
 const dom=new JSDOM(html,{url:'https://plouf.space/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document;
 const state={open:false,phase:'waiting',meDone:false,otherDone:false,infoCalls:0,joins:0};
 const me={id:'alice',name:'Alice',character:23,points:500,rank:1};
 const bob={id:'bob',name:'Bob',character:24,points:500,rank:2};
 w.scrollTo=()=>{};
 w.open=()=>{throw Error('The guide must never open an external app or tab');};
 Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{if(denyClipboard)throw Error('Clipboard permission denied');copiedGuide=text;}}});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.matchMedia=()=>({matches:true});
 w.Image=class{decode(){return Promise.resolve()}};
 w.fetch=async url=>({ok:true,json:async()=>String(url).includes('characters.json')?catalog:languages});
 const timeout=w.setTimeout.bind(w);
 w.setTimeout=(fn,ms,...args)=>timeout(fn,ms>=500&&ms<=3000?30:ms,...args);
 w.testServer={async rpc(name,args){
  if(name==='painting_presets')return {data:[{id:'french',description:'Private Preset Name',quiz_language:'fr'},{id:'english',description:'Garden Objects',quiz_language:'en'}]};
  if(name==='painting_preset')return {data:{id:args.p_id,description:'Private Preset Name',quiz_language:'fr',image_path:'painting.png',items:['cœur'],duration_seconds:120,object_theme:'Classroom Items'}};
  if(name==='room_info'){state.infoCalls++;assert.equal(args.p_room,'PID-10020');return {data:{theme:'forest',type:'v2',can_join:state.open}};}
  if(name==='join_room'){assert.equal(state.open,true);assert.equal(args.p_character,24);state.joins++;return {data:null};}
  if(name==='submit_item'){assert.equal(args.p_guess,'book');state.meDone=true;return {data:{correct:true,duplicate:false,points:500}};}
  if(name==='room_snapshot'){
   const finished=state.meDone&&state.otherDone;
   return {offset:0,data:{id:'PID-10020',type:'v2',theme:'forest',host:false,member_id:'alice',session_id:'session-1',question_index:0,phase:finished?'finished':state.phase,started:!finished,playing:!finished&&state.phase==='painting',members:finished?[me,bob]:state.phase==='waiting'?[me,bob]:[{...me,points:state.meDone?500:0,rank:undefined}],guest_count:2,points:state.meDone?500:0,found_items:state.meDone?['book']:[],total_items:1,hint:'Classroom Items',image_path:'painting.png',duration_seconds:120,deadline:new Date(Date.now()+120000).toISOString()}};
  }
  throw Error('Unexpected request '+name);
 }};
 const waitFor=async predicate=>{const end=Date.now()+5000;while(!predicate()){if(Date.now()>end)throw Error('UI state timed out: '+d.querySelector('#app').textContent);await new Promise(resolve=>setTimeout(resolve,10));}};
 const click=selector=>{const element=d.querySelector(selector);assert.ok(element,selector);element.click();};
 const submit=selector=>d.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 try{
  w.eval(code);
  await waitFor(()=>d.querySelector('[data-action=guest]'));
  click('[data-action=host]');
  click('[data-language=frr]');
  assert.equal(d.querySelector('h2').textContent,languages.frr.hostTitle);
  assert.equal(d.querySelector('.quiz-shuffle-note span').textContent,languages.frr.answersShuffleNote);
  d.querySelector('[data-next]').click();
  assert.equal(d.querySelector('[data-manual-error]').textContent,'Question 1 : Saisissez la question.');
  click('[data-entry-mode=json]');click('[data-action=json-guide-v1]');
  assert.ok(d.querySelector('.upload-guide pre').textContent.includes('Votre question ?'));
  assert.ok(d.querySelector('.upload-guide pre').textContent.includes('Bonne réponse'));
  d.querySelector('.upload-guide .back').click();
  assert.ok(d.querySelector('#quiz-import a').href.endsWith('example-questions-fr.json'));
  click('[data-language=en]');click('[data-action=rooms-v2]');
  await waitFor(()=>d.querySelector('#host-v2-form').presetData);
  assert.equal(d.querySelector('#preset').options[1].textContent,'Private Preset Name (French)');
  assert.equal(d.querySelector('#preset').options[2].textContent,'Garden Objects (English)');
  assert.equal(d.querySelector('#hint').value,'Private Preset Name');
  assert.equal(d.querySelector('#painting-language-field').hidden,true);
  assert.equal(d.querySelector('#painting-description-field').hidden,true);
  assert.equal(d.querySelector('#painting-duration-field').hidden,false);
  assert.equal(d.querySelector('#duration').disabled,true);
  assert.equal(d.querySelector('#duration').value,'120');
  assert.equal(d.querySelector('#object-theme').value,'Classroom Items');
  assert.equal(d.querySelector('#object-theme').readOnly,true);
  const presets=d.querySelector('#preset');presets.value='';presets.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(d.querySelector('#painting-language-field').hidden,false);
  assert.equal(d.querySelector('#painting-description-field').hidden,false);
  assert.equal(d.querySelector('#painting-duration-field').hidden,false);
  assert.equal(d.querySelector('#object-theme').readOnly,false);
  assert.equal(d.querySelector('#object-theme').placeholder,'Set the theme of the correct objects');
  assert.equal(d.querySelector('#duration').disabled,false);
  assert.equal(d.querySelector('#quiz-language').value,'en');
  assert.deepEqual([...d.querySelector('#quiz-language').options].map(o=>o.textContent),['English','French']);
  assert.equal(d.querySelector('[data-action=chatgpt-painting-guide]').closest('#painting-imports').hidden,false);
  click('[data-action=chatgpt-painting-guide]');
  assert.equal(d.querySelector('#painting-chatgpt-title').textContent,languages.en.chatgptGuideTitle);
  assert.equal(d.querySelector('.painting-chatgpt-guide p').textContent,languages.en.chatgptGuideInstructions);
  assert.equal(d.querySelector('.painting-chatgpt-guide textarea').value,packagedGuide);
  click('.painting-chatgpt-guide [data-copy]');await waitFor(()=>copiedGuide===packagedGuide&&d.querySelector('.guide-copy-status').textContent===languages.en.guideCopied);
  assert.equal(d.querySelector('.guide-copy-status').textContent,languages.en.guideCopied);
  denyClipboard=true;click('.painting-chatgpt-guide [data-copy]');
  await waitFor(()=>d.querySelector('.painting-guide-preview').open);
  assert.equal(d.querySelector('.painting-chatgpt-guide textarea').selectionStart,0);
  assert.equal(d.querySelector('.painting-chatgpt-guide textarea').selectionEnd,packagedGuide.length);
  click('.painting-chatgpt-guide [data-close]');denyClipboard=false;

  click('[data-language=frr]');
  await waitFor(()=>d.querySelector('#preset').options.length===3);
  assert.deepEqual([...d.querySelector('#quiz-language').options].map(o=>o.textContent),['Anglais','Français']);
  assert.equal(d.querySelector('#preset').options[1].textContent,'Private Preset Name (Français)');
  assert.ok(d.querySelector('#items-import a').href.endsWith('example-items-fr.json'));
  click('[data-action=chatgpt-painting-guide]');
  assert.equal(d.querySelector('#painting-chatgpt-title').textContent,languages.frr.chatgptGuideTitle);
  assert.equal(d.querySelector('.painting-chatgpt-guide [data-copy] span').textContent,languages.frr.copyGuide);
  click('.painting-chatgpt-guide [data-close]');
  const description=d.querySelector('#hint');description.value='';assert.equal(description.checkValidity(),false);
  assert.equal(description.validationMessage,languages.frr.completeField);
  const theme=d.querySelector('#object-theme');theme.value='un deux trois quatre cinq';theme.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(theme.validationMessage,languages.frr.objectThemeLimit);
  assert.equal(d.querySelector('.logo').getAttribute('aria-label'),'Accueil Plouf');
  click('[data-language=en]');
  click('[data-action=home]');
  click('[data-action=guest]');
  assert.equal(d.querySelector('#guest-form [type=submit]').disabled,false);
  const room=d.querySelector('#room');room.value='PID-10020';room.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(room.value,'10020');
  d.querySelector('#name').value='Alice';
  click('[data-action=find-room]');await waitFor(()=>d.querySelector('#form-error').hidden===false);
  const join=d.querySelector('#guest-form [type=submit]');assert.equal(join.disabled,false);
  assert.equal(d.querySelector('#form-error').textContent,languages.en.notOpen);
  click('[data-character="24"]');
  submit('#guest-form');await waitFor(()=>state.infoCalls===2&&!join.disabled);
  assert.equal(state.joins,0);assert.equal(d.querySelector('#form-error').hidden,false);
  state.open=true;
  // No second Find Room click: Join fetches the current availability itself.
  submit('#guest-form');await waitFor(()=>d.querySelector('#arena'));
  assert.equal(state.joins,1);assert.equal(state.infoCalls,3);
  assert.equal(d.querySelector('.waiting-theme-banner').textContent,'When the room starts, identify the objects matching this theme: Classroom Items.');
  assert.equal(d.querySelector('.waiting-theme-banner strong').textContent,'Classroom Items');
  assert.ok(!d.querySelector('.waiting-theme-banner').textContent.includes('Private Preset Name'));
  click('[data-language=frr]');
  assert.equal(d.querySelector('.waiting-theme-banner').textContent,'Au début de la partie, trouvez les objets correspondant à ce thème : Classroom Items.');
  click('[data-language=en]');
  state.phase='painting';await waitFor(()=>d.querySelector('#guess-form'));
  assert.equal(d.querySelector('.waiting-theme-banner'),null);
  d.querySelector('#guess').value='book';submit('#guess-form');
  await waitFor(()=>d.querySelector('#guess')?.disabled);
  assert.equal(d.querySelector('#painting-score').textContent,'500 '+languages.en.points);
  assert.equal(d.querySelector('.painting-progress').textContent,languages.en.itemsDone);
  assert.equal(d.querySelector('.podium-screen'),null);
  state.otherDone=true;
  await waitFor(()=>d.querySelector('.podium-screen'));
  assert.equal(d.querySelector('.winner.gold .winner-name').textContent,'Alice');
  assert.equal(d.querySelector('.winner.silver .winner-name').textContent,'Bob');
  assert.equal(d.querySelector('#guess-form'),null);
 }finally{dom.window.close();}
});
