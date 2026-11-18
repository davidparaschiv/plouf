import {t} from './i18n.js';

// Shared server event IDs are deduplicated by the V3 controller, independently of renders.
export function showAnswerFeedback(correct) {
 document.querySelectorAll('.answer-result-notice').forEach(el=>el.remove());
 const notice=document.createElement('div');
 notice.className=`answer-result-notice ${correct?'is-correct':'is-wrong'}`;
 notice.setAttribute('role','status');
 const emoji=document.createElement('span');emoji.className='answer-result-emoji';emoji.setAttribute('aria-hidden','true');emoji.textContent=correct?'🎉':'🙈';
 const text=document.createElement('strong');text.textContent=t(correct?'answerCorrect':'answerWrong');
 notice.append(emoji,text);document.body.append(notice);
 notice.addEventListener('animationend',()=>notice.remove(),{once:true});
 setTimeout(()=>notice.remove(),2400);
}
