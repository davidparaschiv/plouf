import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {wordsReview} from '../src/words-review.js';
import {setLanguage} from '../src/i18n.js';
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('Words table puts found targets first, preserves accents, escapes content and translates statuses',()=>{
 setLanguage('frr');
 try{
  const dom=new JSDOM(wordsReview([{word:'une fenêtre',correct:false},{word:'cœur',correct:true},{word:'<script>bad</script>',correct:false}],esc));
  const d=dom.window.document;
  assert.equal(d.querySelector('h2').textContent,'Mots');
  assert.deepEqual([...d.querySelectorAll('tbody td:first-child')].map(td=>td.textContent),['cœur','une fenêtre','<script>bad</script>']);
  assert.equal(d.querySelector('.word-found [role=img]').getAttribute('aria-label'),'Trouvé');
  assert.equal(d.querySelector('.word-missed [role=img]').getAttribute('aria-label'),'Non trouvé');
  assert.equal(d.querySelector('script'),null);dom.window.close();
 }finally{setLanguage('en');}
 assert.equal(wordsReview(undefined,esc),'');
});
