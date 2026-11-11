import {t} from './i18n.js';
export function installLocalizedValidation(root) {
 root.addEventListener('invalid',event=>{
  const field=event.target;
  if(!field.matches('input,select,textarea')||field.validity.customError)return;
  const key=field.validity.valueMissing
   ?field.type==='file'?'chooseFileError':field.tagName==='SELECT'?'chooseOptionError':'completeField'
   :field.validity.tooShort?'minimumCharacters':'checkField';
  field.dataset.validationText=t(key,{count:field.minLength});
  field.setCustomValidity(field.dataset.validationText);
 },true);
 root.addEventListener('input',event=>{
  const field=event.target;
  if(field.dataset?.validationText){
   if(field.validationMessage===field.dataset.validationText)field.setCustomValidity('');
   delete field.dataset.validationText;
  }
 });
 root.addEventListener('change',event=>{
  const field=event.target;
  if(field.dataset?.validationText){
   if(field.validationMessage===field.dataset.validationText)field.setCustomValidity('');
   delete field.dataset.validationText;
  }
 });
}
