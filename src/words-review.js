import {t} from './i18n.js';
export function wordsReview(words,esc) {
 if(!Array.isArray(words))return '';
 const ordered=[...words].sort((a,b)=>Number(b.correct)-Number(a.correct));
 return `<section class="words-review" aria-label="${t('words')}"><h2>${t('words')}</h2><div class="words-table-wrap"><table><thead><tr><th scope="col">${t('word')}</th><th scope="col">${t('wordResult')}</th></tr></thead><tbody>${ordered.map(item=>`<tr class="${item.correct?'word-found':'word-missed'}"><td>${esc(item.word)}</td><td><span class="word-result-icon" role="img" aria-label="${t(item.correct?'wordFound':'wordMissed')}">${item.correct?'✓':'×'}</span></td></tr>`).join('')}</tbody></table></div></section>`;
}
