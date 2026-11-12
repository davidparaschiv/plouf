import {rpc} from './api.js';
import {t,locale,errorText} from './i18n.js';
import {roomCharacters} from './characters.js';
import {validateQuestions} from './rules.js';

// The V3 controller owns its forms and polling; V1/V2 keep their existing renderer.
export function createBallRooms({app,esc,avatar,music,setAtmosphere,onExit}) {
 let workspace=null, options={classrooms:[],presets:[]}, room='', state=null, page='workspace', creating=false, selected=40;
 let timer, epoch=0, signature='', positions=new Map(), previousHolder=null, pending=false, busy=false;
 let draft={classroom:'',classroomName:'',preset:'',presetName:'',questions:null,fileName:''};
 const msg=key=>t('v3'+key);
 const errors={
  'Workspace access required.':'AccessRequired','Enter a workspace name.':'WorkspaceRequired','This workspace name is already used.':'WorkspaceTaken',
  'Workspace or password is incorrect.':'WorkspaceWrong','Enter a classroom name.':'ClassroomRequired','This classroom name is already used.':'ClassroomTaken',
  'Choose a classroom.':'ClassroomRequired','Enter a preset name.':'PresetRequired','This preset name is already used.':'PresetTaken',
  'This room is full (30 players).':'Full','Choose a plush character.':'ChoosePlush','Wait for at least two guests.':'TwoPlayers',
  'Wait for the ball.':'WaitBall','Choose another player.':'ChooseOther','Invalid action.':'ActionError','Use different Guest and Host passwords.':'DifferentPasswords'
 };
 const errorMessage=e=>errors[e.message]?msg(errors[e.message]):errorText(e);
 function showError(error){const el=app.querySelector('.v3-error');if(el){el.textContent=errorMessage(error);el.hidden=false;}}
 const field=(label,name,extra='')=>`<label>${label}<input name="${name}" ${extra.includes('type=')?'':'type="text"'} ${extra}></label>`;
 const back=()=>`<button type="button" class="back" data-v3="back">${t('back')}</button>`;
 function dispose(){clearTimeout(timer);epoch++;state=null;signature='';positions.clear();previousHolder=null;document.body.classList.remove('room-v3','podium');}
 function enter(linkRoom=''){dispose();workspace=null;room=linkRoom;page='workspace';creating=false;music.setTrack('lobby');setAtmosphere('');draw();}
 function workspaceForm(){
  app.innerHTML=`<section class="panel v3-form">${back()}<p class="eyebrow">${msg('Version')}</p><h2>${msg('Title')}</h2><form data-v3-form="workspace" class="stack">${field(msg('Workspace'),'workspace',`required maxlength="80" autocomplete="organization" value="${esc(new URLSearchParams(location.search).get('workspace')||'')}"`)}${creating?`${field(msg('GuestPassword'),'guestPassword','type="password" required minlength="4" autocomplete="new-password"')}${field(msg('HostPassword'),'hostPassword','type="password" required minlength="4" autocomplete="new-password"')}`:field(msg('WorkspacePassword'),'password','type="password" required minlength="4" autocomplete="current-password"')}<p class="v3-error error" hidden role="alert"></p><button class="primary wide" type="submit">${creating?msg('CreateWorkspace'):msg('Continue')}</button><button type="button" class="back" data-v3="create-workspace">${creating?msg('HaveWorkspace'):msg('NoWorkspace')}</button></form></section>`;
 }
 async function workspaceHome(){
  if(workspace.role==='host'){if(room){await rpc('unlock_host_v3',{p_room:room});await openRoom(room);}else await host();}
  else {page='guest';draw();}
 }
 const roomInput=()=>`<label>${t('roomId')}<div class="room-number-input"><span>PID-</span><input name="room" type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" required value="${esc(room.replace(/\D/g,''))}" placeholder="10020" autocomplete="off"></div></label>`;
 function joinForm(host=false){
  app.innerHTML=`<section class="panel v3-form">${back()}<p class="eyebrow">${esc(workspace.name)}</p><h2>${t(host?'welcomeHost':'entrance')}</h2><form class="stack" data-v3-form="${host?'unlock':'join'}">${roomInput()}${host?'':`${field(t('yourName'),'name','required maxlength="32" autocomplete="nickname"')}<div><span class="field-label">${t('chooseCharacter')}</span><div class="characters plush-characters">${roomCharacters({type:'v2'}).map(c=>`<button type="button" data-v3-character="${c.id}" class="character ${selected===c.id?'selected':''}" aria-pressed="${selected===c.id}">${avatar(c.id)}<span>${esc(c.name[locale()])}</span></button>`).join('')}</div></div>`}<p class="error v3-error" hidden role="alert"></p><button class="primary wide" type="submit">${t(host?'enter':'join')}</button></form></section>`;
 }
 function hostForm(){
  app.innerHTML=`<section class="panel v3-form">${back()}<p class="eyebrow">${esc(workspace.name)}</p><h2>${msg('Title')}</h2><form class="stack" data-v3-form="create"><label>${msg('Classroom')}<select name="classroom">${options.classrooms.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="">${msg('NewClassroom')}</option></select></label><div data-new-classroom>${field(msg('ClassroomName'),'classroomName',`maxlength="80" value="${esc(draft.classroomName)}"`)}</div><label>${t('presetLabel')}<select name="preset"><option value="">${t('presetNone')}</option>${options.presets.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><div class="stack" data-new-preset>${field(msg('PresetName'),'presetName',`maxlength="80" value="${esc(draft.presetName)}"`)}<label class="upload"><span data-v3-file>${esc(draft.fileName)||t('upload')}</span><input name="quiz" type="file" accept="application/json,.json"></label><a class="back" download href="${import.meta.env.BASE_URL}example-questions${locale()==='frr'?'-fr':''}.json">${t('example')}</a><details class="v3-guide"><summary>${t('jsonGuide')}</summary><p>${msg('JsonHelp')}</p><pre>${esc(JSON.stringify([{Q:t('exampleQuestion'),C:t('fieldC'),W1:t('fieldW1'),W2:t('fieldW2'),W3:t('fieldW3')}],null,2))}</pre></details><p class="v3-info">${msg('Shuffle')}</p></div><p class="error v3-error" hidden role="alert"></p><button class="primary wide" type="submit">${t('create')}</button></form><button type="button" class="back" data-v3="unlock">${t('existing')}</button></section>`;
  const form=app.querySelector('form');form.elements.classroom.value=draft.classroom;form.elements.preset.value=draft.preset;syncForm();
 }
 function syncForm(){
  const form=app.querySelector('[data-v3-form="create"]');if(!form)return;
  const newClass=!form.elements.classroom.value,newPreset=!form.elements.preset.value;
  app.querySelector('[data-new-classroom]').hidden=!newClass;form.elements.classroomName.required=newClass;
  app.querySelector('[data-new-preset]').hidden=!newPreset;form.elements.presetName.required=newPreset;
  form.elements.quiz.required=newPreset&&!draft.questions;
 }
 function draw(){
  if(page==='workspace')workspaceForm();else if(page==='roles')workspaceForm();else if(page==='host')hostForm();else if(page==='guest'||page==='unlock')joinForm(page==='unlock');else if(state)render(true);
 }
 async function host(){page='host';app.innerHTML=`<section class="panel"><p>${t('loading')}</p></section>`;try{options=(await rpc('workspace_options_v3',{p_workspace:workspace.id})).data;draft={classroom:options.classrooms[0]?.id||'',classroomName:'',preset:options.presets[0]?.id||'',presetName:'',questions:null,fileName:''};draw();}catch(e){page='workspace';draw();app.querySelector('section').insertAdjacentHTML('beforeend',`<p class="v3-error error">${esc(errorMessage(e))}</p>`);}}
 async function loadRoom(){
  const generation=epoch;
  try{const result=await rpc('snapshot_v3',{p_room:room});if(generation!==epoch)return;state=result.data;state.offset=result.offset;render();}
  catch(e){if(generation!==epoch)return;if(e.message==='Join this room first.'){epoch++;state=null;page='guest';draw();showError(e);return;}showError(e);}
  if(generation===epoch)timer=setTimeout(loadRoom,500);
 }
 async function openRoom(id){dispose();room=id;page='room';history.replaceState(null,'',`${location.pathname}?room=${encodeURIComponent(id)}&version=v3&workspace=${encodeURIComponent(workspace.name)}`);app.innerHTML=`<section class="panel"><p>${t('loading')}</p><p class="v3-error error" hidden></p></section>`;await loadRoom();}
 function rosterPositions(members){
  const cols=matchMedia('(max-width:600px)').matches?(app.clientWidth&&app.clientWidth<320?4:5):6,rows=Math.max(1,Math.ceil(30/cols));
  positions.height=Math.max(520,rows*88);
  if(!positions.size){const slots=Array.from({length:cols*rows},(_,i)=>i);for(let i=slots.length-1;i>0;i--){const j=secureIndex(i+1);[slots[i],slots[j]]=[slots[j],slots[i]];}positions.slots=slots;}
  for(const m of members)if(!positions.has(m.id)){const slot=positions.slots[positions.size]??0;positions.set(m.id,{x:(slot%cols+.5)*100/cols,y:(Math.floor(slot/cols)+.5)*100/rows});}
 }
 function board(){
  const s=state;rosterPositions(s.members);
  return `<div class="v3-arena" style="height:${positions.height}px" aria-label="${msg('Players')}">${s.members.map(m=>{const p=positions.get(m.id);return `<button type="button" class="v3-player ${s.holder===m.id?'has-ball':''} ${s.member_id===m.id?'is-you':''}" data-v3-target="${m.id}" style="left:${p.x}%;top:${p.y}%" ${!canPass()||m.id===s.holder?'disabled':''}>${avatar(m.character)}${s.playing?`<span>${esc(m.name)}</span>`:''}</button>`;}).join('')}<img class="v3-ball" src="${import.meta.env.BASE_URL}assets/volleyball-v3.svg" alt="" aria-hidden="true" hidden>${s.members.length?'':`<p class="empty">${t('waitingCompany')}</p>`}</div>`;
 }
 function canPass(){return state?.phase==='passing'&&!state.host&&state.member_id===state.holder;}
 function announcement(){const s=state,name=s.members.find(m=>m.id===s.holder)?.name||'';
  if(s.phase==='restart')return msg(s.event==='timeout'?'Timeout':'Wrong');
  if(s.phase==='passing')return canPass()?msg('PassPrompt'):t('v3Choosing',{name});
  if(s.phase==='question')return `${s.event==='random'?msg('Random')+' ':''}${t('v3Received',{name})}`;
  return msg('Waiting');
 }
 function render(force=false){
  const s=state;document.body.classList.add('room-v3');document.body.classList.remove('themed','room-v2','v2-results');
  const finished=s.phase==='finished';document.body.classList.toggle('podium',finished);setAtmosphere(finished?'confetti':'');music.setTrack(finished?'podium':s.started?'forest':'lobby');
  const nextSignature=JSON.stringify([locale(),s.phase,s.turn_id,s.event_id,s.host,s.member_id,s.members,s.ranking,s.best_score,s.score]);
  if(force||nextSignature!==signature){
   signature=nextSignature;
   if(finished){renderResults();return;}
   app.innerHTML=`<section class="v3-game"><div class="v3-game-head"><div class="v3-glass"><p class="eyebrow">${esc(room)}</p><h1>${msg('Title')}</h1></div><div class="v3-stats"><div class="v3-stat"><small>${esc(s.classroom)}</small><strong>${s.best_score} <span>p</span></strong><small>${msg('Best')}</small></div><div class="v3-stat"><small>${msg('Score')}</small><strong>${s.score} <span>p</span></strong></div></div></div><p class="v3-announcement v3-glass" role="status">${esc(announcement())}</p>${s.phase==='question'?`<div class="v3-question v3-glass"><div class="v3-question-head"><span>${s.question_index+1} / ${s.question_count}</span><strong class="v3-timer" aria-label="${msg('TimeLeft')}"></strong></div>${s.question?`<h2>${esc(s.question)}</h2><div class="answers">${s.answers.map((a,i)=>`<button class="answer ${s.host?(i===Number(s.correct_choice)?'is-correct':'is-incorrect'):''}" data-v3-color="${s.answer_colors?.[i]??i}" data-v3-answer="${i}" ${s.host?'disabled':''}><span class="answer-copy">${esc(a)}</span></button>`).join('')}</div>`:`<p>${msg('Watch')}</p>`}</div>`:''}${board()}<div class="room-actions">${s.host? s.playing?`<button class="secondary" data-v3="finish">${msg('Finish')}</button>`:`<button class="primary" data-v3="${s.started?'play':'start'}" ${s.started&&s.members.length<2?'disabled':''}>${t(s.started?'play':'start')}</button>${s.started?`<button class="secondary" data-v3="start">${t('reset')}</button>`:''}`:''}</div><p class="v3-count">${s.members.length} / 30 · ${t('guestsCount',{count:s.members.length})}</p>${s.host?`<div class="share v3-glass"><input aria-label="${msg('RoomLink')}" readonly value="${esc(location.href)}"><button class="secondary" data-v3="copy">${t('copy')}</button></div>`:''}<p class="v3-error error" hidden role="alert"></p></section>`;
   animateBall();
  }
  updateClock();
 }
 function updateClock(){const el=app.querySelector('.v3-timer');if(el&&state?.deadline)el.textContent=`${Math.max(0,Math.ceil((Date.parse(state.deadline)-Date.now()-state.offset)/1000))} s`;}
 function animateBall(){
  const ball=app.querySelector('.v3-ball'),target=positions.get(state.holder);if(!ball||!target)return;
  ball.hidden=false;ball.style.left=`${target.x}%`;ball.style.top=`${target.y}%`;
  const from=positions.get(previousHolder);if(from&&previousHolder!==state.holder&&ball.animate){const arena=app.querySelector('.v3-arena').getBoundingClientRect(),dx=(from.x-target.x)*arena.width/100,dy=(from.y-target.y)*arena.height/100;ball.animate([{transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) rotate(-180deg)`},{transform:`translate(calc(-50% + ${dx/2}px),calc(-50% + ${dy/2-95}px)) rotate(0deg)`},{transform:'translate(-50%,-50%) rotate(180deg)'}],{duration:850,easing:'ease-in-out'});}
  previousHolder=state.holder;
 }
 function renderResults(){
  const ranking=state.ranking||[];app.innerHTML=`<section class="v3-results"><div class="v3-glass v3-result-title"><p class="eyebrow">${msg('ClassroomRanking')}</p><h1>${msg('Champions')}</h1><p>${msg('AllTime')}</p><div class="v3-final-score"><span>${msg('CurrentScore')} · ${esc(state.classroom)}</span><strong>${state.score} p</strong></div></div><div class="v3-podium">${[1,0,2].filter(i=>ranking[i]).map(i=>`<div class="v3-podium-place place-${i+1}"><img class="v3-medal" src="${import.meta.env.BASE_URL}assets/medal-${['gold','silver','bronze'][i]}.svg" alt=""><h2>${esc(ranking[i].name)}</h2><strong>${ranking[i].points} p</strong><div class="v3-podium-block">${i+1}</div></div>`).join('')}</div><div class="v3-glass v3-ranking">${ranking.map((c,i)=>`<div class="${c.name===state.classroom?'current-classroom':''}"><span>${i+1}</span><strong>${esc(c.name)}</strong><span>${c.points} p</span></div>`).join('')}</div><div class="room-actions">${state.host?`<button class="primary" data-v3="start">${t('freshStart')}</button>`:''}<button class="secondary" data-v3="roles">${t('home')}</button></div><p class="v3-error error" hidden></p></section>`;
 }
 app.addEventListener('input',e=>{if(!e.target.closest('[data-v3-form]'))return;if(e.target.name==='room')e.target.value=e.target.value.replace(/\D/g,'');if(page==='host'&&e.target.name in draft)draft[e.target.name]=e.target.value;});
 app.addEventListener('change',async e=>{
  if(!e.target.closest('[data-v3-form]'))return;
  if(['classroom','preset'].includes(e.target.name)){draft[e.target.name]=e.target.value;syncForm();}
  if(e.target.name==='quiz'){
   const file=e.target.files[0];draft.questions=null;draft.fileName='';
   try{if(file){draft.questions=validateQuestions(JSON.parse(await file.text()));draft.fileName=file.name;}}catch(error){showError(error);e.target.value='';}
   app.querySelector('[data-v3-file]').textContent=draft.fileName||t('upload');syncForm();
  }
 });
 app.addEventListener('submit',async e=>{
  const form=e.target;if(!form.matches('[data-v3-form]'))return;e.preventDefault();if(busy)return;busy=true;const generation=epoch;
  form.querySelector('[type="submit"]').disabled=true;form.querySelector('.v3-error').hidden=true;
  const f=new FormData(form),kind=form.dataset.v3Form;
  try{
   if(kind==='workspace'){const result=await rpc('access_workspace_v3',{p_name:f.get('workspace'),p_password:f.get('password'),p_create:creating,p_guest_password:f.get('guestPassword'),p_host_password:f.get('hostPassword')});if(generation!==epoch)return;workspace=result.data;creating=false;await workspaceHome();}
   else if(kind==='create'){
    const id=(await rpc('create_room_v3',{p_workspace:workspace.id,p_classroom:f.get('classroom')||null,p_classroom_name:f.get('classroomName')||null,p_preset:f.get('preset')||null,p_preset_name:f.get('presetName')||null,p_questions:draft.questions})).data;if(generation===epoch)await openRoom(id);
   }else{
    const id=`PID-${String(f.get('room')).replace(/\D/g,'')}`;
    if(kind==='unlock')await rpc('unlock_host_v3',{p_room:id});else await rpc('join_room_v3',{p_room:id,p_name:f.get('name'),p_character:selected});
    if(generation===epoch)await openRoom(id);
   }
  }catch(error){if(generation===epoch)showError(error);}finally{busy=false;if(form.isConnected)form.querySelector('[type="submit"]').disabled=false;}
 });
 app.addEventListener('click',async e=>{
  const character=e.target.closest('[data-v3-character]');if(character){selected=Number(character.dataset.v3Character);app.querySelectorAll('[data-v3-character]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.v3Character)===selected);b.setAttribute('aria-pressed',String(Number(b.dataset.v3Character)===selected));});return;}
  const action=e.target.closest('[data-v3]')?.dataset.v3;
  if(action==='back'){if(page==='workspace'){dispose();onExit();}else if(page==='guest'||page==='host'){room='';page='workspace';draw();}else{await host();}return;}
  if(action==='create-workspace'){creating=!creating;draw();return;}
  if(action==='host'){await host();return;}
  if(action==='guest'||action==='unlock'){page=action;draw();return;}
  if(action==='roles'){dispose();history.replaceState(null,'',location.pathname);room='';music.setTrack('lobby');setAtmosphere('');await workspaceHome();return;}
  if(action==='copy'){const input=app.querySelector('.share input');try{await navigator.clipboard.writeText(input.value);}catch{input.select();}return;}
  const answer=e.target.closest('[data-v3-answer]'),target=e.target.closest('[data-v3-target]');
  if(!action&&!answer&&!target)return;if(pending||!state)return;pending=true;
  try{
   if(['start','play','finish'].includes(action))await rpc('control_room_v3',{p_room:room,p_action:action});
   else if(answer&&!state.host){app.querySelectorAll('[data-v3-answer]').forEach(b=>b.disabled=true);await rpc('answer_v3',{p_room:room,p_session:state.session_id,p_turn:state.turn_id,p_choice:Number(answer.dataset.v3Answer)});}
   else if(target&&canPass()&&target.dataset.v3Target!==state.holder)await rpc('pass_ball_v3',{p_room:room,p_session:state.session_id,p_turn:state.turn_id,p_target:target.dataset.v3Target});
   else return;
   clearTimeout(timer);epoch++;await loadRoom();
  }catch(error){showError(error);signature='';}finally{pending=false;}
 });
 window.addEventListener('resize',()=>{if(page==='room'&&state){positions.clear();signature='';render(true);}});
 return {enter,dispose,redraw(){const values=[...app.querySelectorAll('[data-v3-form] input')].filter(e=>e.type!=='file').map(e=>[e.name,e.value]);draw();for(const [name,value]of values){const field=app.querySelector(`[name="${name}"]`);if(field)field.value=value;}}};
}
export function secureIndex(length){const limit=Math.floor(4294967296/length)*length;let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=limit);return n%length;}
