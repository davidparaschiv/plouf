import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {modeSwitch,setupQuizEntry,setupItemEntry} from '../src/manual-entry.js';
import {loadLanguages,setLanguage,t} from '../src/i18n.js';

const dictionary=JSON.parse(await readFile(new URL('../public/lang.json',import.meta.url),'utf8'));
const priorFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:true,json:async()=>dictionary});
try{await loadLanguages('/lang.json');}finally{globalThis.fetch=priorFetch;}
const esc=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function form(kind) {
 const dom=new JSDOM(`<form>${modeSwitch()}<div id="manual-${kind==='quiz'?'quiz':'items'}"></div><div id="${kind==='quiz'?'quiz-import':'items-import'}"><input type="file" required></div></form>`);
 return dom.window.document.querySelector('form');
}
function input(el,value){el.value=value;el.dispatchEvent(new el.ownerDocument.defaultView.Event('input',{bubbles:true}));}
function fillQuiz(form,label){
 for(const [key,value] of Object.entries({Q:`${label} ?`,C:'cœur',W1:'été',W2:'fenêtre',W3:'boîte'}))input(form.querySelector(`[data-quiz-field="${key}"]`),value);
}

test('manual quiz wizard validates, finalizes all questions, and keeps independent JSON and manual drafts',()=>{
 const f=form('quiz'),state={};let questions;
 setupQuizEntry(f,state,esc,value=>questions=value);
 assert.equal(f.dataset.entryMode,'manual');assert.equal(f.querySelector('input[type=file]').disabled,true);
 assert.equal(f.checkValidity(),true);assert.equal(questions,null);
 f.querySelector('[data-next]').click();assert.equal(state.index,0);assert.equal(f.querySelector('[data-manual-error]').hidden,false);
 fillQuiz(f,'Première');f.querySelector('[data-next]').click();assert.equal(state.index,1);
 fillQuiz(f,'Deuxième');f.querySelector('[data-prev]').click();assert.equal(f.querySelector('[data-quiz-field=Q]').value,'Première ?');
 f.querySelector('[data-finalize]').click();
 assert.equal(questions.length,2);assert.equal(questions[1].Q,'Deuxième ?');assert.equal(questions[0].C,'cœur');
 assert.equal(f.querySelector('[data-edit]').textContent,'Edit Quiz');
 const manual=structuredClone(questions),imported=[{Q:'Imported?',C:'Yes',W1:'No',W2:'Maybe',W3:'Never'}];
 f.querySelector('[data-entry-mode=json]').click();assert.equal(questions,null);assert.equal(f.checkValidity(),false);
 assert.equal(f.querySelector('input[type=file]').disabled,false);assert.equal(f.querySelector('#manual-quiz').hidden,true);
 f.setImportedQuestions(imported);assert.deepEqual(questions,imported);
 f.querySelector('[data-entry-mode=manual]').click();assert.deepEqual(questions,manual);assert.equal(f.checkValidity(),true);
 f.querySelector('[data-edit]').click();assert.equal(questions,null);
 input(f.querySelector('[data-quiz-field=Q]'),'Revised');f.querySelector('[data-finalize]').click();assert.equal(questions[0].Q,'Revised');
 f.querySelector('[data-entry-mode=json]').click();assert.deepEqual(questions,imported);
});

test('V2 manual answers start empty, support adding/removing Unicode entries, and ignore inactive inputs',()=>{
 const f=form('items'),state={};setupItemEntry(f,state,esc);
 assert.equal(f.dataset.entryMode,'manual');assert.equal(f.querySelectorAll('#manual-items input').length,0);
 assert.deepEqual(f.readManualItems(),{items:[]});
 for(let i=0;i<3;i++)f.querySelector('[data-add]').click();
 f.querySelectorAll('#manual-items input').forEach((el,i)=>input(el,['  UN   CŒUR  ','une boîte',''][i]));
 assert.deepEqual(f.readManualItems(),{items:['un cœur','une boîte']});
 f.querySelector('[data-entry-mode=json]').click();assert.equal(f.querySelector('input[type=file]').required,true);
 assert.ok([...f.querySelectorAll('#manual-items input')].every(el=>el.disabled));
 f.querySelector('[data-entry-mode=manual]').click();assert.deepEqual(f.readManualItems(),{items:['un cœur','une boîte']});
 f.querySelector('[data-remove][data-index="1"]').click();assert.deepEqual(f.readManualItems(),{items:['un cœur']});
 f.querySelector('[data-add]').click();input([...f.querySelectorAll('#manual-items input')].at(-1),'un coeur');
 assert.throws(()=>f.readManualItems(),/unique/);
});

test('manual drafts survive a French-language redraw with no wrong-answer list in V2',()=>{
 const state={correct:['une fenêtre','cœur'],mode:'manual'};
 setLanguage('frr');
 try{
  const f=form('items');setupItemEntry(f,state,esc);
  assert.equal(f.querySelector('h3').textContent,'Bonnes réponses');
  assert.equal(f.querySelector('[data-add]').getAttribute('aria-label'),'Ajouter une bonne réponse');
  assert.equal(f.querySelectorAll('h3').length,1);assert.deepEqual(f.readManualItems().items,state.correct);
  const quiz=form('quiz');setupQuizEntry(quiz,{rows:[{Q:'Été ?',C:'Oui',W1:'Non',W2:'Peut-être',W3:'Jamais'}]},esc,()=>{});
  assert.equal(quiz.querySelector('[data-finalize]').textContent,'Créer le quiz');
  assert.equal(quiz.querySelector('[data-quiz-field=Q]').value,'Été ?');
 }finally{setLanguage('en');}
 assert.equal(t('createQuiz'),'Create Quiz');
});
