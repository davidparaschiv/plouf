// Render text as native DOM so it stays crisp on high-density phone screens.
export function showPointsFeedback(correct,scene,reduced=false) {
 const layer=document.createElement('div');layer.className='points-notice';
 layer.setAttribute('role','status');
 layer.innerHTML=`<div class="points-notice-card ${correct?'points-positive':'points-negative'}"><span class="points-notice-icon" aria-hidden="true">${correct?'✓':'×'}</span><strong>${correct?'+500 p':'−100 p'}</strong></div>`;
 (document.querySelector('dialog[open]')||document.body).append(layer);
 const card=layer.firstElementChild;
 if(reduced){setTimeout(()=>layer.remove(),1200);return;}
 if(scene){
  const motion={y:-window.innerHeight*.3,alpha:0};
  const draw=()=>{card.style.transform=`translateY(${motion.y}px)`;card.style.opacity=motion.alpha;};draw();
  scene.tweens.add({targets:motion,y:0,alpha:1,duration:700,ease:'Cubic.Out',onUpdate:draw,
   onComplete:()=>scene.tweens.add({targets:motion,alpha:0,delay:200,duration:300,onUpdate:draw,onComplete:()=>layer.remove()})});
 }else{
  const animation=card.animate([{transform:'translateY(-30vh)',opacity:0},{transform:'translateY(0)',opacity:1,offset:.58},{transform:'translateY(0)',opacity:1,offset:.75},{transform:'translateY(0)',opacity:0}],{duration:1200,easing:'ease-out'});
  animation.onfinish=()=>layer.remove();
 }
}
