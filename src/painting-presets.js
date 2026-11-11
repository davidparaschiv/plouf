import {rpc} from './api.js';
import {t} from './i18n.js';
import {validateItems,itemKey,PaintingDemo,validateDescription} from './painting-rules.js';
export {validateDescription} from './painting-rules.js';
import {preloadPainting,validatePainting} from './painting.js';
export function setupPaintingForm(form) {
 let seq=0,checkTimer,presetTouched=false;
 const select=form.querySelector('#preset'),hint=form.querySelector('#hint'),status=form.querySelector('#description-status');
 const demo=form.querySelector('[data-action="demo-v2"]');
 form.presetData=null;
 const refresh=()=>{demo.disabled=select.value ? !form.presetData : !form.querySelector('#painting').files.length || (form.dataset.entryMode==='json' && !form.querySelector('#items-json').files.length);};
 form.refreshPaintingDemo=refresh;
 form.syncPaintingPreset=()=>{
  const chosen=!!select.value;
  form.querySelector('#painting-description-field').hidden=chosen;
  form.querySelector('#painting-duration-field').hidden=chosen;
  form.querySelector('#painting-language-field').hidden=chosen;
  form.querySelector('#quiz-language').disabled=chosen;
  form.querySelector('#painting-imports').hidden=chosen;
  form.querySelector('#painting').disabled=chosen;form.querySelector('#painting').required=!chosen;
  if(chosen)form.querySelectorAll('#manual-items input,#items-import input').forEach(el=>el.disabled=true);else form.syncEntryMode?.();
  hint.readOnly=chosen;hint.setCustomValidity('');
  refresh();
 };
 rpc('painting_presets',{}).then(({data})=>{
  if(!form.isConnected)return;
  for(const p of data??[]){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.description} (${p.quiz_language==='fr'?'French':'English'})`;option.dataset.description=p.description;select.append(option);}
  const saved=form.dataset.selectedPreset;
  if(!presetTouched){
   const available=[...select.options];
   const choice=saved!==undefined && available.some(o=>o.value===saved)?saved:available[1]?.value;
   if(choice){select.value=choice;select.dispatchEvent(new Event('change'));}
  }
 }).catch(()=>{ /* Custom uploads remain available if the preset list cannot be loaded. */ });
 select.addEventListener('change',async()=>{
  presetTouched=true;
  const request=++seq;clearTimeout(checkTimer);form.presetData=null;status.textContent='';
  const id=select.value;
  if(!id)hint.value='';
  form.syncPaintingPreset();
  if(!id)return;
  hint.value=select.selectedOptions[0].dataset.description;
  status.textContent=t('presetLoading');
  try {
   const {data}=await rpc('painting_preset',{p_id:id});
   await preloadPainting(data.image_path);
   if(!form.isConnected||request!==seq)return;
   form.presetData=data;status.textContent='';refresh();
  } catch {if(form.isConnected&&request===seq)status.textContent=t('presetLoadError');}
 });
 hint.addEventListener('input',()=>{
  if(select.value)return;
  const request=++seq;clearTimeout(checkTimer);hint.setCustomValidity('');
  try{validateDescription(hint.value);}catch(e){hint.setCustomValidity(e.message);status.textContent=e.message;return;}
  status.textContent=t('descriptionChecking');
  checkTimer=setTimeout(async()=>{
   try{const {data}=await rpc('painting_description_available',{p_description:hint.value});
    if(!form.isConnected||request!==seq)return;
    hint.setCustomValidity(data?'':t('descriptionTaken'));status.textContent=t(data?'descriptionAvailable':'descriptionTaken');
   }catch{if(form.isConnected&&request===seq)status.textContent='';}
  },400);
 });
 form.addEventListener('change',refresh);
 refresh();
}
export async function paintingDraft(form) {
 if(form.querySelector('#preset').value){
  if(!form.presetData)throw Error(t('presetLoading'));
  return {items:validateItems(form.presetData.items),hint:form.presetData.description,image:await preloadPainting(form.presetData.image_path),presetId:form.presetData.id};
 }
 const file=form.querySelector('#painting').files[0],json=form.querySelector('#items-json').files[0];
 const manual=form.dataset.entryMode==='manual';
 if(!file)throw Error(t('paintingInvalid'));
 if(!manual&&!json)throw Error(t('paintingChooseFiles'));
 await validatePainting(file);
 const values=manual?form.readManualItems():{items:validateItems(JSON.parse(await json.text()))};
 return {file,...values,hint:form.querySelector('#hint').value};
}
export async function openPaintingDemo(form,{esc,music,audioToggle,itemReward,avatar,setAtmosphere,background}) {
 const draft=await paintingDraft(form);
 const prior=music.track||'lobby';
 const objectUrl=draft.file?URL.createObjectURL(draft.file):null;
 const image=draft.image||objectUrl;
 const decoded=new Image();decoded.src=image;try{await decoded.decode();}catch(e){if(objectUrl)URL.revokeObjectURL(objectUrl);throw e;}
 const dialog=document.createElement('dialog');dialog.className='question-demo painting-demo';
 const game=new PaintingDemo(draft.items),found=game.found;let delay,countdownTimer,locked=false;
 const close=()=>dialog.close();
 const sound=()=>{const btn=audioToggle.cloneNode(true);btn.removeAttribute('id');btn.onclick=()=>{audioToggle.click();btn.setAttribute('aria-pressed',audioToggle.getAttribute('aria-pressed'));btn.setAttribute('aria-label',audioToggle.getAttribute('aria-label'));};dialog.append(btn);};
 const podium=()=>{
  clearTimeout(delay);locked=true;
  music.setTrack('podium');setAtmosphere('confetti');dialog.style.backgroundImage='linear-gradient(150deg,#e5ceff,#bca8ea 65%,#f3b69e)';dialog.innerHTML=`<div class="podium-title"><p>${t('wrap')}</p><h2>${t('legendary')}</h2></div><div class="winner gold demo-winner">${avatar(23)}<span class="winner-name">${t('demoPlayer')}</span><span class="winner-points">${game.score} ${t('points')}</span><div class="step">1</div></div><button type="button" class="primary" data-close>${t('back')}</button>`;
  dialog.querySelector('[data-close]').onclick=close;sound();
 };
 const draw=()=>{
  dialog.innerHTML=`<button type="button" class="back" data-close>${t('back')}</button><section class="painting-game"><div class="painting-stats"><span>${t('demoPlayer')}</span><strong class="painting-score-badge">${game.score} ${t('points')}</strong></div><h2>${esc(draft.hint||t('paintingTitle'))}</h2><p class="demo-background-note">${t('redXNotice')}</p><img class="painting-canvas" src="${esc(image)}" alt="${esc(draft.hint)}"><form class="guess-form"><input type="text" required autocomplete="off" aria-label="${t('guessItem')}" placeholder="${t('guessItem')}"><button type="submit" class="primary">↵</button></form><p>${t('itemsFound',{count:found.size,total:draft.items.length})}</p><div class="found-items">${draft.items.filter(v=>found.has(itemKey(v))).map(v=>`<span>✓ ${esc(v)}</span>`).join('')}</div><button class="back" type="button" data-finish>${t('demoFinish')}</button></section>`;
  dialog.querySelector('[data-close]').onclick=close;dialog.querySelector('[data-finish]').onclick=podium;
  dialog.querySelector('form').onsubmit=e=>{
   e.preventDefault();e.stopPropagation();if(locked)return;
   const result=game.guess(e.target.querySelector('input').value);
   if(!result||result.duplicate){e.target.querySelector('input').value='';return;}
   itemReward(result.correct);
   if(found.size===draft.items.length){locked=true;draw();dialog.querySelectorAll('form input,form button').forEach(el=>el.disabled=true);delay=setTimeout(podium,1400);}else draw();
  };
  sound();dialog.querySelector('input').focus();
 };
 dialog.addEventListener('close',()=>{clearTimeout(delay);clearInterval(countdownTimer);music.setTrack(prior);setAtmosphere('');if(objectUrl)URL.revokeObjectURL(objectUrl);dialog.remove();},{once:true});
 dialog.style.backgroundImage=`linear-gradient(#ffffff55,#ffffff55),url("${background}")`;
 dialog.innerHTML=`<button type="button" class="back" data-close>${t('back')}</button><div class="countdown-number"><p>${t('getReady')}</p><b data-demo-countdown>3</b><p class="red-x-notice">${t('redXNotice')}</p></div>`;
 dialog.querySelector('[data-close]').onclick=close;sound();
 document.body.append(dialog);dialog.showModal();music.setTrack('forest');setAtmosphere('forest');
 const countdownEnd=performance.now()+3000;
 countdownTimer=setInterval(()=>{
  const left=Math.max(0,Math.ceil((countdownEnd-performance.now())/1000));
  if(!left){clearInterval(countdownTimer);if(draft.items.length)draw();else podium();}
  else dialog.querySelector('[data-demo-countdown]').textContent=left;
 },100);
}
