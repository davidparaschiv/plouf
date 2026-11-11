import { t } from './i18n.js';
export function normalizeItem(value) {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
export function itemKey(value) {
  return normalizeItem(value).normalize('NFD').replace(/\p{M}/gu, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}
// Only ASCII guesses may omit accents. Unicode guesses preserve their exact spelling.
export function itemMatches(guess,answer) {
 const text=normalizeItem(guess);
 return /^[\x00-\x7F]*$/u.test(text) ? text===itemKey(answer) : text===normalizeItem(answer);
}
export function validateItems(value) {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !normalizeItem(v))) throw Error(t('itemsInvalid'));
  const items = value.map(normalizeItem);
  if (new Set(items.map(itemKey)).size !== items.length) throw Error(t('itemsUnique'));
  return items;
}

export function validateDescription(value) {
 const clean=value.trim().replace(/\s+/gu,' ');
 if(!clean || clean.split(' ').length>4 || clean.length>160) throw Error(t('descriptionLimit'));
 return clean;
}

export class PaintingDemo {
 constructor(items) { this.items=validateItems(items);this.found=new Set();this.wrong=new Set();this.score=0; }
 get complete() { return this.found.size===this.items.length; }
 guess(value) {
  const text=normalizeItem(value);
  if(!text)return null;
  const answer=this.items.find(item=>itemMatches(text,item));
  const correct=answer!==undefined,key=correct?itemKey(answer):text;
  if(correct?this.found.has(key):this.wrong.has(key))return {correct,duplicate:true,points:this.score};
  if(this.complete)return null;
  (correct?this.found:this.wrong).add(key);this.score+=correct?500:-100;
  return {correct,duplicate:false,points:this.score};
 }
}
