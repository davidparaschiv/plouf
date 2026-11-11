import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {showPointsFeedback} from '../src/points-feedback.js';

test('points feedback uses crisp DOM text, keeps the 1.2 second timing, and works over dialogs',()=>{
 const dom=new JSDOM('<body></body>');
 const before={document:globalThis.document,window:globalThis.window,setTimeout:globalThis.setTimeout};
 globalThis.document=dom.window.document;globalThis.window=dom.window;
 try{
  const tweens=[],scene={tweens:{add:config=>tweens.push(config)}};
  showPointsFeedback(true,scene);
  assert.equal(document.querySelector('.points-positive strong').textContent,'+500 p');
  assert.equal(document.querySelector('canvas'),null);
  assert.equal(tweens[0].duration,700);
  tweens[0].onComplete();assert.equal(tweens[1].delay,200);assert.equal(tweens[1].duration,300);
  tweens[1].onComplete();assert.equal(document.querySelector('.points-notice'),null);
  const dialog=document.createElement('dialog');dialog.open=true;document.body.append(dialog);
  showPointsFeedback(false,scene);
  assert.equal(dialog.querySelector('.points-negative strong').textContent,'−100 p');
  tweens[2].onComplete();tweens[3].onComplete();
  let remove,delay;
  globalThis.setTimeout=(callback,ms)=>{remove=callback;delay=ms;};
  showPointsFeedback(true,scene,true);
  assert.equal(delay,1200);assert.ok(dialog.querySelector('.points-positive'));remove();
  assert.equal(dialog.querySelector('.points-notice'),null);
 }finally{
  Object.assign(globalThis,before);dom.window.close();
 }
});
