import { connect } from './api.js';
import { t, locale } from './i18n.js';
import {modeSwitch} from './manual-entry.js';
export { normalizeItem, itemKey, validateItems } from './painting-rules.js';
export async function validatePainting(file) {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (file.size > 5242880 || header.join(',') !== '137,80,78,71,13,10,26,10') throw Error(t('paintingInvalid'));
  const bitmap = await createImageBitmap(file);
  bitmap.close();
}
export async function createPaintingRoom({file, items, password, hint, duration, quizLanguage='en', objectTheme}) {
  await validatePainting(file);
  const c = await connect();
  const { data: { user } } = await c.auth.getUser();
  const path = `${user.id}/${crypto.randomUUID()}.png`;
  const {error} = await c.storage.from('paintings').upload(path, file, {contentType:'image/png', upsert:false});
  if (error) throw error;
  const result = await c.rpc('create_painting_room', {p_password:password, p_hint:hint, p_image_path:path, p_items:items, p_duration:duration,p_quiz_language:quizLanguage,p_object_theme:objectTheme});
  if (result.error) {
    await c.storage.from('paintings').remove([path]);
    throw result.error;
  }
  return result.data;
}
const paintingCache = new Map();
export async function preloadPainting(path) {
  const cached = paintingCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.image.src;
  const c = await connect();
  const {data,error} = await c.storage.from('paintings').createSignedUrl(path,3600);
  if (error) throw error;
  const image = new Image(); image.src=data.signedUrl; await image.decode();
  paintingCache.set(path,{image,expires:Date.now()+3300000});
  return image.src;
}
export function paintingHostForm(esc, back) {
  return `<section class="panel">${back}<h2>${t('paintingHostTitle')}</h2><form id="host-v2-form" class="stack"><p class="muted painting-upload-note">${t('paintingUploadNote')}</p><label for="preset">${t('presetLabel')}</label><select id="preset" name="preset"><option value="">${t('presetNone')}</option></select><label id="painting-description-field">${t('paintingDescription')}<input type="text" id="hint" name="hint" maxlength="160" required placeholder="${t('descriptionPlaceholder')}"></label><p id="description-status" class="description-status" aria-live="polite"></p><label id="painting-theme-field">${t('objectThemeLabel')}<input id="object-theme" name="object-theme" type="text" maxlength="160" required placeholder="${t('objectThemePlaceholder')}"></label><label id="painting-language-field">${t('quizLanguage')}<select id="quiz-language" name="quiz-language" required><option value="en">${t('quizEnglish')}</option><option value="fr">${t('quizFrench')}</option></select></label><div id="painting-imports" class="stack"><label class="upload"><span id="painting-label">${t('paintingUpload')}</span><input id="painting" name="painting" type="file" accept="image/png,.png" required></label><button class="back" type="button" data-action="painting-guide">${t('paintingGuide')}</button>${modeSwitch()}<div id="manual-items" class="stack"></div><div id="items-import" class="stack"><label class="upload"><span id="items-label">${t('itemsUpload')}</span><input id="items-json" name="items" type="file" accept="application/json,.json" required></label><a class="back" href="${import.meta.env.BASE_URL}example-items${locale()==='frr'?'-fr':''}.json" download>${t('example')}</a><button class="back" type="button" data-action="json-guide-v2">${t('jsonGuide')}</button></div></div><button class="back" type="button" data-action="demo-v2" disabled>${t('paintingDemo')}</button><label id="painting-duration-field">${t('duration')}<select id="duration" name="duration">${[30,60,120,300].map(v=>`<option value="${v}" ${v===120?'selected':''}>${t('duration'+v)}</option>`).join('')}</select></label><label>${t('password')}<input id="password" name="password" type="password" required minlength="4" autocomplete="new-password"></label><button class="back" type="button" data-action="rooms-v1">${t('backV1')}</button><p id="form-error" class="error" hidden></p><button class="primary wide" type="submit">${t('create')}</button></form></section>`;
}
export function renderPainting(app, s, esc, avatar, image, rank) {
  if (!app.querySelector('.painting-game')) {
    app.innerHTML = `<section class="painting-game"><div class="painting-stats"><span>${t('guestsCount',{count:s.guest_count})}</span><span id="painting-score" class="${s.host ? '' : 'painting-score-badge'}" aria-live="polite"></span></div><div class="painting-heading"><h2>${esc(s.hint)}</h2><span class="timer" id="timer">${s.duration_seconds}</span></div><img class="painting-canvas" src="${esc(image)}" alt="${esc(s.hint)}">${s.host ? '<div class="painting-leaders"></div>' : `<form id="guess-form" class="guess-form"><input id="guess" name="guess" type="text" required autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t('guessItem')}" placeholder="${t('guessItem')}"><button class="primary" type="submit">↵</button></form><p class="painting-progress" aria-live="polite"></p><div class="found-items"></div>`}</section>`;
  }
  const canvas = app.querySelector('.painting-canvas');
  if (canvas.getAttribute('src') !== image) canvas.src = image;
  app.querySelector('#painting-score').textContent = s.host ? t('hostWatching') : `${s.points ?? 0} ${t('points')}`;
  if (s.host) {
    app.querySelector('.painting-leaders').innerHTML = s.members.map(m=>`<div>${avatar(m.character)}<strong>${rank(m.rank)} · ${esc(m.name)}</strong><span>${m.points} ${t('points')}</span></div>`).join('');
  } else {
    const done = s.found_items.length >= s.total_items;
    app.querySelector('.painting-progress').textContent = done ? t('itemsDone') : t('itemsFound',{count:s.found_items.length,total:s.total_items});
    app.querySelector('.found-items').innerHTML = s.found_items.map(v=>`<span>✓ ${esc(v)}</span>`).join('');
    app.querySelectorAll('#guess-form input,#guess-form button').forEach(e=>e.disabled=done);
  }
}
