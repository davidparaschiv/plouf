import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {showAnswerFeedback} from '../src/answer-feedback.js';
import {setLanguage} from '../src/i18n.js';

test('shared answer notices have translated text, emoji and cleanup',()=>{
 const dom=new JSDOM('<body></body>');const previous={document:globalThis.document,setTimeout:globalThis.setTimeout};
 globalThis.document=dom.window.document;globalThis.setTimeout=()=>{};
 try{
  for(const [lang,correct,label]of [['en',true,'Correct!'],['en',false,'Wrong!'],['frr',true,'Bonne réponse !'],['frr',false,'Mauvaise réponse !']]){
   setLanguage(lang);showAnswerFeedback(correct);
   const notice=document.querySelector('[role=status]');assert.equal(notice.querySelector('strong').textContent,label);assert.ok(notice.querySelector('[aria-hidden=true]').textContent);
   assert.equal(document.querySelectorAll('.answer-result-notice').length,1);
  }
  document.querySelector('.answer-result-notice').dispatchEvent(new dom.window.Event('animationend'));
  assert.equal(document.querySelector('.answer-result-notice'),null);
 }finally{setLanguage('en');Object.assign(globalThis,previous);dom.window.close();}
});
