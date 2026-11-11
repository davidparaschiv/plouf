import {t,errorText} from './i18n.js';
import {validateQuestions} from './rules.js';
import {validateItems} from './painting-rules.js';
const blank=()=>({Q:'',C:'',W1:'',W2:'',W3:''});
export function modeSwitch() {
 return `<div class="entry-switch" role="group" aria-label="${t('entryMethod')}"><button type="button" data-entry-mode="manual" aria-pressed="true">${t('manual')}</button><button type="button" data-entry-mode="json" aria-pressed="false">${t('importJson')}</button></div>`;
}
function connectMode(form,state,manual,imported,onMode=()=>{}) {
 state.mode??='manual';
 const sync=()=>{
  const json=state.mode==='json';manual.hidden=json;imported.hidden=!json;
  imported.querySelectorAll('input').forEach(el=>{el.disabled=!json;el.required=json;});
  manual.querySelectorAll('input').forEach(el=>el.disabled=json);
  form.querySelectorAll('[data-entry-mode]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.entryMode===state.mode)));
  form.dataset.entryMode=state.mode;onMode();
 };
 form.querySelectorAll('[data-entry-mode]').forEach(btn=>btn.onclick=()=>{state.mode=btn.dataset.entryMode;sync();});
 sync();form.syncEntryMode=sync;
}
export function setupQuizEntry(form,state,esc,onChange) {
 state.rows??=[blank()];state.index??=0;
 const panel=form.querySelector('#manual-quiz'),imports=form.querySelector('#quiz-import');
 const notify=()=>onChange(state.mode==='manual'?(state.finalized?validateQuestions(state.rows.filter(row=>Object.values(row).some(v=>v.trim()))):null):state.imported??null);
 const render=()=>{
  const note=`<div class="quiz-shuffle-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h3c5 0 7 12 12 12h3M18 15l3 3-3 3M3 18h3c2 0 3.5-2 5-5M14 8c1.3-1.3 2.5-2 4-2h3M18 3l3 3-3 3"/></svg><span>${t('answersShuffleNote')}</span></div>`;
  if(state.finalized){panel.innerHTML=`<p class="quiz-summary">${t('quizReady',{count:state.rows.filter(row=>Object.values(row).some(v=>v.trim())).length})}</p>${note}<button class="secondary" type="button" data-edit>${t('editQuiz')}</button>`;panel.querySelector('[data-edit]').onclick=()=>{state.finalized=false;render();notify();};return;}
  const row=state.rows[state.index];
  panel.innerHTML=`<h3>${t('questionNumber',{number:state.index+1})}</h3>${['Q','C','W1','W2','W3'].map(key=>`<label>${t('field'+key)}<input type="text" data-quiz-field="${key}" value="${esc(row[key])}"></label>`).join('')}${note}<p class="error" data-manual-error hidden></p><div class="quiz-editor-actions">${state.index?`<button class="secondary" type="button" data-prev>${t('previousQuestion')}</button>`:''}<button class="secondary" type="button" data-next>${t('nextQuestion')}</button><button class="primary" type="button" data-finalize>${t('createQuiz')}</button></div>`;
  panel.querySelectorAll('[data-quiz-field]').forEach(input=>input.oninput=()=>{row[input.dataset.quizField]=input.value;});
  const fail=(e,index)=>{const el=panel.querySelector('[data-manual-error]');el.hidden=false;el.textContent=errorText(index===undefined?e:Error(e.message.replace(/^Question 1:/,`Question ${index+1}:`)));};
  panel.querySelector('[data-prev]')?.addEventListener('click',()=>{state.index--;render();});
  panel.querySelector('[data-next]').onclick=()=>{try{validateQuestions([row]);state.index++;state.rows[state.index]??=blank();render();panel.querySelector('input').focus();}catch(e){fail(e,state.index);}};
  panel.querySelector('[data-finalize]').onclick=()=>{try{validateQuestions(state.rows.filter(r=>Object.values(r).some(v=>v.trim())));state.finalized=true;render();notify();}catch(e){fail(e);}};
 };
 render();connectMode(form,state,panel,imports,notify);
 form.setImportedQuestions=value=>{state.imported=value;notify();};
}
export function setupItemEntry(form,state,esc) {
 state.correct??=[];
 const panel=form.querySelector('#manual-items'),imports=form.querySelector('#items-import');
 const render=()=>{
  panel.innerHTML=`<div class="manual-item-group"><div class="manual-item-heading"><h3>${t('correctItems')}</h3><button type="button" class="secondary add-item" data-add aria-label="${t('addCorrect')}">+</button></div><div>${state.correct.map((value,index)=>`<div class="manual-item-row"><input type="text" data-index="${index}" value="${esc(value)}" aria-label="${t('correctItem')} ${index+1}"><button type="button" class="back" data-remove data-index="${index}" aria-label="${t('removeItem')}">×</button></div>`).join('')}</div></div>`;
  panel.querySelectorAll('input').forEach(input=>input.oninput=()=>{state.correct[Number(input.dataset.index)]=input.value;form.refreshPaintingDemo?.();});
  panel.querySelector('[data-add]').onclick=()=>{state.correct.push('');render();panel.querySelectorAll('input')[state.correct.length-1].focus();};
  panel.querySelectorAll('[data-remove]').forEach(btn=>btn.onclick=()=>{state.correct.splice(Number(btn.dataset.index),1);render();form.refreshPaintingDemo?.();});
 };
 form.readManualItems=()=>({items:validateItems(state.correct.filter(v=>v.trim()))});
 render();connectMode(form,state,panel,imports,()=>form.refreshPaintingDemo?.());
}
