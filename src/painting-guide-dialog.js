import guide from './painting-guide.txt?raw';
import {t} from './i18n.js';

export function openPaintingGuide({esc,audioToggle}) {
 const dialog=document.createElement('dialog');
 dialog.className='upload-guide painting-chatgpt-guide';
 dialog.setAttribute('aria-labelledby','painting-chatgpt-title');
 dialog.innerHTML=`<button type="button" class="back" data-close>${t('back')}</button><h2 id="painting-chatgpt-title">${t('chatgptGuideTitle')}</h2><p>${t('chatgptGuideInstructions')}</p><button type="button" class="primary copy-painting-guide" data-copy><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>${t('copyGuide')}</span></button><p class="guide-copy-status" role="status"></p><details class="painting-guide-preview"><summary>${t('viewGuide')}</summary><textarea readonly aria-label="${t('guideContents')}" spellcheck="false">${esc(guide)}</textarea></details>`;
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();
 dialog.querySelector('[data-copy]').onclick=async()=>{
  const status=dialog.querySelector('[role=status]');
  try{
   await navigator.clipboard.writeText(guide);
   if(dialog.isConnected){dialog.querySelector('[data-copy] span').textContent=t('guideCopied');status.textContent=t('guideCopied');}
  }catch{
   if(!dialog.isConnected)return;
   dialog.querySelector('details').open=true;
   const text=dialog.querySelector('textarea');text.focus();text.select();text.setSelectionRange(0,text.value.length);
   status.textContent=t('guideCopyManually');
  }
 };
 const sound=audioToggle.cloneNode(true);sound.removeAttribute('id');
 sound.onclick=()=>{audioToggle.click();sound.setAttribute('aria-pressed',audioToggle.getAttribute('aria-pressed'));sound.setAttribute('aria-label',audioToggle.getAttribute('aria-label'));};
 dialog.append(sound);
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 document.body.append(dialog);dialog.showModal();
}
