import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'vite';
import {JSDOM} from 'jsdom';

test('V3 first-screen selection, workspace login, host creation, passing and classroom podium',async()=>{
 const result=await build({configFile:false,logLevel:'silent',plugins:[{name:'ui-test-services',enforce:'pre',load(id){
  if(id.endsWith('/src/api.js'))return `export const rpc=(...args)=>window.testServer.rpc(...args);export const connect=async()=>({});`;
  if(id.endsWith('/src/effects.js'))return `export const setAtmosphere=()=>{};export const reward=()=>{};export const itemReward=()=>{};`;
  if(id.endsWith('/src/music.js'))return `export const MUSIC_TRACKS=[];export class RoomMusic{constructor(){this.enabled=true}preload(){return Promise.resolve()}unlock(){}setTrack(value){this.track=value}toggle(){return this.enabled=!this.enabled}}`;
 }}],build:{write:false,minify:false,rollupOptions:{input:'src/main.js',output:{format:'iife',inlineDynamicImports:true}}}});
 const dom=new JSDOM(await readFile('index.html','utf8'),{url:'https://plouf.space/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document;
 const languages=JSON.parse(await readFile('public/lang.json','utf8')),catalog=JSON.parse(await readFile('public/characters.json','utf8'));
 w.scrollTo=()=>{};w.matchMedia=()=>({matches:true});w.Image=class{set src(v){this._src=v}decode(){return Promise.resolve()}};
 w.fetch=async url=>({ok:true,json:async()=>String(url).includes('characters.json')?catalog:languages});
 const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timeout(fn,ms===500?20:ms,...args);
 const people=Array.from({length:30},(_,i)=>({id:'p'+i,name:'Player '+i,character:40+i%6}));
 let snapshot={id:'PID-10020',type:'v3',phase:'waiting',host:true,started:false,playing:false,member_id:null,holder:null,session_id:'session',turn_id:'turn',event_id:'waiting',event:'waiting',score:0,best_score:100,classroom:'Class A',members:people,question_index:0,question_count:2};
 const calls=[];let workspacesExist=false,lookupType='v3',sameClass=true;
 w.testServer={async rpc(name,args){calls.push([name,args]);if(name==='list_workspaces_v3')return {data:workspacesExist?[{id:'workspace',name:'School'}]:[]};
  if(name==='access_workspace_v3'){assert.equal(args.p_name,'School');assert.equal(args.p_password,'secret');workspacesExist=true;return {data:{id:'workspace',name:'School'}};}
  if(name==='list_classrooms_v3'){assert.equal(args.p_workspace,'workspace');return {data:[{id:'class',name:'Class A',workspace_id:'workspace',workspace_name:'School'}]};}
  if(name==='join_classroom_v3'){assert.equal(args.p_classroom,'class');assert.equal(args.p_password,'guest-secret');return {data:{id:'class',name:'Class A',workspace_id:'workspace',workspace_name:'School'}};}
  if(name==='room_info')return {data:{type:lookupType,can_join:true}};
  if(name==='find_room_v3'){assert.equal(args.p_classroom,'class');if(!sameClass)throw Error('Room created for different classroom.');return {data:{type:'v3',can_join:true}};}
  if(name==='workspace_options_v3')return {data:{classrooms:[{id:'class',name:'Class A'}],presets:[{id:'preset',name:'Quiz A'}]}};
  if(name==='create_room_v3'){assert.equal(args.p_preset,null);assert.equal(args.p_questions.length,1);assert.equal(args.p_questions[0].Q,'Manual question?');assert.equal(args.p_classroom,'class');assert.equal('p_password' in args,false);return {data:'PID-10020'};}
  if(name==='snapshot_v3')return {data:structuredClone(snapshot),offset:0};
  if(name==='control_room_v3'){if(args.p_action==='start')snapshot={...snapshot,started:true,phase:'waiting',event_id:'start'};if(args.p_action==='play')snapshot={...snapshot,playing:true,phase:'question',holder:'p0',turn_id:'turn1',event_id:'question',event:'random',question:'A question?',answers:['C','A','B','D'],answer_colors:[2,0,3,1],correct_choice:0,deadline:new Date(Date.now()+20000).toISOString()};if(args.p_action==='finish')snapshot={...snapshot,started:false,playing:false,phase:'finished',event_id:'finish',ranking:[{id:'class',name:'Class A',points:500},{id:'class2',name:'Class B',points:300},{id:'class3',name:'Class C',points:100},{id:'class4',name:'Class D',points:0}]};return {data:null};}
  if(name==='pass_ball_v3'){assert.equal(args.p_target,'p2');snapshot={...snapshot,phase:'question',holder:'p2',question:'Next question',event_id:'pass',turn_id:'turn2',event:'received',answers:['1','2','3','4']};return {data:null};}
  if(name==='join_room_v3')return {data:'p0'};
  throw Error('Unexpected '+name);
 }};
 const wait=async fn=>{const end=Date.now()+5000;while(!fn()){if(Date.now()>end)throw Error('Timed out: '+d.querySelector('#app').textContent);await new Promise(r=>setTimeout(r,10));}};
 const click=s=>{assert.ok(d.querySelector(s),s);d.querySelector(s).click();};
 const submit=s=>d.querySelector(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 try{
  w.eval(result.output.find(o=>o.type==='chunk'&&o.isEntry).code);
  await wait(()=>d.querySelector('[data-action=choose-v3]'));assert.equal(d.querySelectorAll('.version-card').length,3);
  click('[data-action=choose-v3]');await wait(()=>d.querySelector('[data-v3=host]'));click('[data-v3=host]');await wait(()=>d.querySelector('[name=workspace] option'));assert.equal(d.querySelector('[name=workspace]').tagName,'SELECT');assert.equal(d.querySelector('[name=workspace] option').textContent,'Empty');click('[data-v3=create-workspace]');d.querySelector('[name=workspace]').value='School';
  d.querySelector('[name=password]').value='secret';submit('form');
  await wait(()=>d.querySelector('[data-v3-form=create]'));assert.equal(d.querySelector('[data-new-classroom]').hidden,true);assert.equal(d.querySelector('[name=classroomPassword]').disabled,true);
  assert.equal(d.querySelector('[data-new-preset]').hidden,true);assert.equal(d.querySelector('[name=quiz]').required,false);assert.equal(d.querySelector('[name=password]'),null);
  const preset=d.querySelector('[name=preset]');preset.value='';preset.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(d.querySelector('form').dataset.entryMode,'manual');
  for(const [key,value]of Object.entries({Q:'Manual question?',C:'Correct',W1:'Wrong one',W2:'Wrong two',W3:'Wrong three'})){const input=d.querySelector(`[data-quiz-field=${key}]`);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));}
  click('[data-finalize]');assert.ok(d.querySelector('.quiz-summary'));
  click('[data-entry-mode=json]');assert.equal(d.querySelector('#quiz-import').hidden,false);
  assert.ok(d.querySelector('#quiz-import a').href.endsWith('/example-questions-v3.json'));
  const example=JSON.parse(await readFile('public/example-questions-v3.json','utf8'));assert.equal(example.length,4);
  const upload=d.querySelector('[name=quiz]');Object.defineProperty(upload,'files',{value:[{name:'example-v3.json',text:async()=>JSON.stringify(example)}]});upload.dispatchEvent(new w.Event('change',{bubbles:true}));await wait(()=>d.querySelector('[data-v3-file]').textContent==='example-v3.json');
  click('[data-entry-mode=manual]');d.querySelector('[name=presetName]').value='Manual quiz';submit('form');
  await wait(()=>d.querySelector('[data-v3=start]'));assert.equal(d.querySelectorAll('.v3-player').length,30);assert.ok(d.querySelector('.v3-arena.is-waiting'));assert.equal(d.querySelectorAll('.v3-player span').length,0);
  const coords=[...d.querySelectorAll('.v3-player')].map(el=>el.style.left+el.style.top);assert.equal(new Set(coords).size,30);
  const firstWaitingPlayer=d.querySelector('.v3-player');w.innerHeight-=80;w.dispatchEvent(new w.Event('resize'));
  assert.equal(d.querySelector('.v3-player'),firstWaitingPlayer,'Mobile address-bar resizing must not redraw or reorder the waiting room');
  w.innerWidth-=20;w.dispatchEvent(new w.Event('resize'));assert.deepEqual([...d.querySelectorAll('.v3-player')].map(el=>el.style.left+el.style.top),coords,'A width change must preserve assigned player positions');
  click('[data-v3=start]');await wait(()=>d.querySelector('[data-v3=play]'));click('[data-v3=play]');await wait(()=>d.querySelector('.v3-question h2'));
  assert.ok(d.querySelector('.v3-arena.is-playing'));const firstPlayingPlayer=d.querySelector('.v3-player');w.innerHeight+=80;w.dispatchEvent(new w.Event('resize'));assert.equal(d.querySelector('.v3-player'),firstPlayingPlayer,'Scrolling must not redraw players during the game');assert.equal(d.querySelector('.v3-question h2').textContent,'A question?');assert.deepEqual([...d.querySelectorAll('[data-v3-answer]')].map(b=>b.dataset.v3Color),['2','0','3','1']);assert.equal(d.querySelectorAll('[data-v3-answer]:disabled').length,4);assert.equal(d.querySelectorAll('.v3-player span').length,30);assert.match(d.querySelector('.v3-timer').textContent,/^\d+ s$/);
  click('[data-language=frr]');assert.match(d.querySelector('.v3-announcement').textContent,/MAINTENANT/);assert.match(d.querySelector('.v3-announcement').textContent,/hasard/);
  click('[data-v3=finish]');await wait(()=>d.querySelector('.v3-podium'));assert.equal(d.querySelectorAll('.v3-podium-place').length,3);assert.equal(d.querySelectorAll('.v3-ranking>div').length,4);assert.equal(d.querySelector('.place-1 h2').textContent,'Class A');assert.ok(d.querySelector('.v3-final-score'));assert.equal(d.querySelector('.v3-final-score strong').textContent,snapshot.score+' p');
  // Guest sees targets only when they hold the ball and have answered correctly.
  click('[data-v3=roles]');await wait(()=>d.querySelector('[data-v3=guest]'));click('[data-v3=guest]');await wait(()=>d.querySelector('[name=classroom] option[value=class]'));assert.equal(d.querySelector('[name=guestWorkspace]').tagName,'SELECT');assert.equal(d.querySelectorAll('input[type=password]').length,1);d.querySelector('[name=password]').value='guest-secret';submit('form');await wait(()=>d.querySelector('[data-v3-form=join]'));d.querySelector('[name=room]').value='10020';d.querySelector('[name=name]').value='Player 0';
  lookupType='v2';click('[data-v3=find]');await wait(()=>d.querySelector('.v3-error').textContent===languages.frr.otherRoomType.replace('{type}','V2'));
  lookupType='v3';sameClass=false;click('[data-v3=find]');await wait(()=>d.querySelector('.v3-error').textContent===languages.frr.v3OtherClassroom);
  sameClass=true;click('[data-v3=find]');await wait(()=>d.querySelector('.v3-room-status').textContent===languages.frr.v3RoomReady);
  snapshot={...snapshot,host:false,member_id:'p0',phase:'passing',started:true,playing:true,holder:'p0',event_id:'correct',event:'correct',score:100};submit('form');
  await wait(()=>d.querySelector('[data-v3-target=p2]:not(:disabled)'));assert.equal(d.querySelector('[data-v3-target=p0]').disabled,true);click('[data-v3-target=p2]');
  await wait(()=>calls.some(([name])=>name==='pass_ball_v3'));await wait(()=>d.querySelector('.has-ball')?.dataset.v3Target==='p2');
 }finally{dom.window.close();}
});
