import "./style.css";
import {createBallRooms} from "./pass-the-ball.js";
import {V2_BACKGROUNDS} from './v2-assets.js';
import {wordsReview} from './words-review.js';
import {openPaintingGuide} from './painting-guide-dialog.js';
import {installLocalizedValidation} from './form-validation.js';
installLocalizedValidation(document);
import {modeSwitch,setupQuizEntry,setupItemEntry} from './manual-entry.js';
let quizEntryState={},itemEntryState={};
import {setupPaintingForm,paintingDraft,openPaintingDemo,validateDescription} from './painting-presets.js';
import {createPaintingRoom, preloadPainting, paintingHostForm, renderPainting} from './painting.js';
let hostType = 'v1', paintingImage = '', itemPending = false;
import { ResponseClock } from "./response-clock.js";
const responseClock = new ResponseClock();
import { PodiumInteraction } from "./podium.js";
const podiumInteraction = new PodiumInteraction();
import { loadCharacters, roomCharacters, characterFile, usesPlush } from "./characters.js";
import {
  characters,
  themes,
  validateQuestions,
  ordinal,
  rankingMarkers,
} from "./rules.js";
import { rpc } from "./api.js";
import { setAtmosphere, reward, itemReward } from "./effects.js";
import { RoomMusic, MUSIC_TRACKS } from "./music.js";
import {
  loadLanguages,
  locale,
  setLanguage,
  t,
  translatedRank,
  errorText,
} from "./i18n.js";
const music = new RoomMusic();
const audioToggle = document.querySelector("#audio-toggle");
audioToggle.addEventListener("click", () => {
  const enabled = music.toggle();
  audioToggle.setAttribute("aria-pressed", String(!enabled));
  audioToggle.setAttribute("aria-label", enabled ? t("mute") : t("unmute"));
  audioToggle.title = enabled ? t("mute") : t("unmute");
});
document.addEventListener("pointerdown", () => music.unlock(), {
  passive: true,
});
document.addEventListener("keydown", () => music.unlock());
// Click/touchend also provide Chrome's activation after a touch or early load tap.
document.addEventListener("click", () => music.unlock(), { capture: true });
document.addEventListener("touchend", () => music.unlock(), { passive: true });
const app = document.querySelector("#app");
const asset = (name) => `${import.meta.env.BASE_URL}assets/${name}`;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const avatar = (character, extra = "") =>
  `<img class="avatar ${extra} ${Number(character)>=40?'plush-avatar':''}" src="${asset(characterFile(character))}" alt="" draggable="false">`;
let roomId = new URLSearchParams(location.search).get("room") || "",
  snapshot = null,
  offset = 0,
  pollTimer,
  signature = "",
  busy = false,
  selected = 0,
  selectedTheme = "forest",
  questions = null,
  positions = new Map(),
  lastSession = "",
  answerPending = false,
  feedback = "",
  answerRevealUntil = 0,
  guestRoom = null,
  currentView = "loading";
const call = rpc;
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 4500);
}
function clearRoom() {
  responseClock.reset();
  podiumInteraction.dispose();
  clearTimeout(pollTimer);
  snapshot = null;
  signature = "";
  lastSession = "";
  positions.clear();
  answerPending = false;
  feedback = "";
  answerRevealUntil = 0;
  document.body.classList.remove("themed", "podium", "v2-results", "room-v2");
  document.querySelector("#background").style.backgroundImage = "";
  setAtmosphere("");
  music.setTrack("lobby");
}
function back() {
  return `<button class="back" data-action="home">${t("back")}</button>`;
}
function roleSelection() {
  clearRoom();
  currentView = "roles";
  app.innerHTML = `<section class="hero"><p class="eyebrow">${t("eyebrow")}</p><h1>${t("spark")}<br>${t("lot")} <em>Plouf.</em></h1><p class="home-description">${t("description")}</p></section><section class="roles" aria-label="${t("joiningHow")}"><button class="role" data-action="guest"><span class="symbol" aria-hidden="true"><img src="${asset("role-guest.png")}" alt=""></span><strong>${t("guest")}</strong><small>${t("guestNote")}</small><span class="arrow">↗</span></button><button class="role host" data-action="host"><span class="symbol" aria-hidden="true"><img src="${asset("role-host.png")}" alt=""></span><strong>${t("host")}</strong><small>${t("hostNote")}</small><span class="arrow">↗</span></button></section><p class="home-footer">${t("footer")}</p><p class="word-note">${t("wordNote")}</p>`;
  if (roomId)
    app.querySelector(".hero").innerHTML =
      `<p class="eyebrow">${esc(roomId)}</p><h1>${t("comeIn")}</h1><p class="muted">${t("joiningHow")}</p>`;
}
const ballRooms=createBallRooms({app,esc,avatar,music,setAtmosphere,onExit:()=>{roomId='';history.replaceState(null,'',location.pathname);home();}});
function home(){
  ballRooms.dispose();
  roleSelection();
  if(roomId)return;
  currentView='home';
  app.querySelector('.hero').classList.add('version-hero');
  app.querySelector('.roles').outerHTML=`<section class="room-versions" aria-label="${t('v3ChooseRoom')}">${['v1','v2','v3'].map((version,i)=>`<button type="button" class="try-v2 version-card" data-action="choose-${version}"><span class="version-number">0${i+1}</span><span><strong>${t('v3Room'+(i+1))}</strong><small>${t('v3RoomNote'+(i+1))}</small></span><span class="version-arrow">↗</span></button>`).join('')}</section>`;
}
function characterPicker() {
  const group = guestRoom ? roomCharacters(guestRoom) : [];
  if (!group.length) return `<p class="muted">${t("roomFirst")}</p>`;
  return `<div><span class="field-label">${t("chooseCharacter")}${usesPlush(guestRoom)?'':' · '+t(guestRoom.theme)}</span><div class="characters ${usesPlush(guestRoom)?'plush-characters':''}">${group.map((c) => `<button type="button" class="character ${c.id === selected ? "selected" : ""}" data-character="${c.id}" aria-pressed="${c.id === selected}">${avatar(c.id)}<span>${esc(c.name[locale()])}</span></button>`).join("")}</div></div>`;
}
const roomDigits = value => String(value ?? '').replace(/\D/g, '');
const guestRoomCode = value => roomDigits(value) ? `PID-${roomDigits(value)}` : '';
function roomNumberInput() {
  return `<div class="room-number-input"><span id="room-prefix">PID-</span><input id="room" name="room" type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" required value="${roomDigits(roomId)}" placeholder="10020" aria-describedby="room-prefix" autocomplete="off" spellcheck="false"></div>`;
}
function guestForm() {
  currentView = "guest";
  app.innerHTML = `<section class="panel guest-join-panel">${back()}<h2>${t("entrance")}</h2><p class="muted">${t("entranceNote")}</p><form id="guest-form" class="stack"><div><label for="room">${t("roomId")}</label><div class="room-lookup">${roomNumberInput()}<button type="button" class="secondary" data-action="find-room">${t("checkRoom")}</button></div></div><div><label for="name">${t("yourName")}</label><input id="name" name="name" type="text" required maxlength="32" placeholder="${t("namePlaceholder")}" autocomplete="nickname"></div><div id="character-picker">${characterPicker()}</div><p class="error" id="form-error" hidden></p><button class="primary wide" type="submit" >${t("join")}</button></form></section>`;
}
async function refreshGuestRoom(room) {
  const {data}=await call('room_info',{p_room:room});
  if(currentView!=='guest' || guestRoomCode(app.querySelector('#room').value)!==room)return null;
  if((data.type||'v1')!==hostType)throw Error(`Room has other type: ${(data.type||'v1').toUpperCase()}`);
  const changed=guestRoom?.id!==room || guestRoom?.theme!==data.theme || guestRoom?.type!==data.type;
  guestRoom={id:room,...data};roomId=room;
  if(changed){
    selected=roomCharacters(data)[0].id;
    app.querySelector('#character-picker').innerHTML=characterPicker();
  }
  return data;
}
async function findGuestRoom() {
  if (busy) return;
  const room = guestRoomCode(app.querySelector("#room").value);
  if (!room) return;
  const button = app.querySelector('[data-action="find-room"]');
  button.disabled = true;
  busy = true;
  try {
    const data=await refreshGuestRoom(room);
    if(!data)return;
    const error = app.querySelector("#form-error");
    error.hidden = data.can_join;
    error.textContent = data.can_join ? "" : t("notOpen");
  } catch (error) {
    guestRoom = null;
    const el = app.querySelector("#form-error");
    if (el) {
      el.textContent = errorText(error);
      el.hidden = false;
    }
  } finally {
    busy = false;
    if (button.isConnected) button.disabled = false;
  }
}
function hostForm(reset = true) {
  if (roomId) return unlockForm();
  currentView = "host";
  if (reset) { questions = null; quizEntryState={}; itemEntryState={}; }
  if (hostType === 'v2') { app.innerHTML = paintingHostForm(esc,back());app.querySelector('.panel').insertAdjacentHTML('beforeend',`<button class="back" data-action="unlock" style="margin:20px 0 0">${t('existing')}</button>`); const form=app.querySelector('#host-v2-form');setupItemEntry(form,itemEntryState,esc);setupPaintingForm(form);return; }
  app.innerHTML = `<section class="panel quiz-host-panel">${back()}<h2>${t("hostTitle")}</h2><p class="muted">${t("hostNoteForm")}</p><form id="host-form" class="stack"><div><span class="field-label">${t("chooseWorld")}</span><div class="themes">${themes.map((theme) => `<button type="button" data-theme="${theme.id}" class="theme ${theme.id === selectedTheme ? "selected" : ""}" aria-pressed="${theme.id === selectedTheme}"><img src="${asset(theme.id + ".png")}" alt=""><span>${t(theme.id)}</span></button>`).join("")}</div></div>${modeSwitch()}<div id="manual-quiz" class="manual-quiz stack"></div><div id="quiz-import" class="stack"><label class="upload"><span id="upload-label">${t("upload")}</span><input id="questions" type="file" accept="application/json,.json" required></label><a class="back" href="${import.meta.env.BASE_URL}example-questions${locale()==='frr'?'-fr':''}.json" download style="margin:0">${t("example")}</a><button type="button" class="back" data-action="json-guide-v1" style="margin:0">${t("jsonGuide")}</button></div><button type="button" class="back" data-action="demo" ${questions?.length ? "" : "disabled"} style="margin:0">${t("demoQuestions")}</button><div><label for="password">${t("password")}</label><input id="password" name="password" type="password" required minlength="4" placeholder="${t("passwordHint")}" autocomplete="new-password"></div><p class="error" id="form-error" hidden></p><button class="primary wide" type="submit">${t("create")}</button></form><button class="back" data-action="unlock" style="margin:20px 0 0">${t("existing")}</button></section>`;
  setupQuizEntry(app.querySelector('#host-form'),quizEntryState,esc,value=>{questions=value;const demo=app.querySelector('[data-action="demo"]');if(demo)demo.disabled=!questions?.length;});
}

async function openQuestionDemo() {
  const data = questions;
  if (!data?.length) return;
  const previousTrack = music.track;
  const dialog = document.createElement("dialog");
  dialog.className = "question-demo";
  dialog.style.backgroundImage = `linear-gradient(#ffffff33,#ffffff33), url("${themeFile(selectedTheme)}")`;
  let index = 0, transition;
  const close = () => { clearTimeout(transition); dialog.close(); };
  dialog.addEventListener("close", () => { clearTimeout(transition); music.setTrack(previousTrack); dialog.remove(); });
  const draw = () => {
    const q = data[index];
    const answers = [q.C, q.W1, q.W2, q.W3].map((text, i) => ({ text, correct: i === 0 }));
    for (let i = answers.length - 1; i > 0; i--) {
      const range = i + 1, limit = Math.floor(4294967296 / range) * range;
      let random;
      do { random = crypto.getRandomValues(new Uint32Array(1))[0]; } while (random >= limit);
      const j = random % range;
      [answers[i], answers[j]] = [answers[j], answers[i]];
    }
    dialog.innerHTML = `<button type="button" class="back" data-close>${t("back")}</button><section class="question"><div class="question-top"><span>${index + 1} / ${data.length}</span></div><div class="question-card"><h2>${esc(q.Q)}</h2></div><div class="answers">${answers.map((a,i) => `<button type="button" class="answer" data-demo-answer="${i}"><span class="answer-copy"><span class="letter">${["A","B","C","D"][i]}</span>${esc(a.text)}</span></button>`).join("")}</div></section>`;
    const sound = audioToggle.cloneNode(true);
    sound.removeAttribute("id");
    sound.onclick = () => {
      const enabled = music.toggle();
      audioToggle.setAttribute("aria-pressed", String(!enabled));
      updateLanguageControls();
      sound.setAttribute("aria-pressed", String(!enabled));
      sound.setAttribute("aria-label", enabled ? t("mute") : t("unmute"));
      sound.title = enabled ? t("mute") : t("unmute");
    };
    dialog.append(sound);
    dialog.querySelector("[data-close]").onclick = close;
    dialog.querySelectorAll("[data-demo-answer]").forEach((button) => {
      button.onclick = () => {
        dialog.querySelectorAll("[data-demo-answer]").forEach((b) => b.disabled = true);
        const correct = answers[Number(button.dataset.demoAnswer)].correct;
        button.classList.add(correct ? "is-correct" : "is-incorrect");
        button.insertAdjacentHTML("beforeend", `<span class="answer-result" aria-hidden="true">${correct ? "✓" : "×"}</span>`);
        if (!correct) {
          const right = dialog.querySelector(`[data-demo-answer="${answers.findIndex((a) => a.correct)}"]`);
          right.classList.add("is-correct");
          right.insertAdjacentHTML("beforeend", '<span class="answer-result" aria-hidden="true">✓</span>');
        }
        transition = setTimeout(() => { index++; if (index === data.length) close(); else draw(); }, 1400);
      };
    });
  };
  document.body.append(dialog);
  draw();
  dialog.showModal();
  music.setTrack(selectedTheme);
}

function openUploadGuide(action) {
  const dialog = document.createElement('dialog');
  dialog.className = 'upload-guide';
  const mode = action === 'painting-guide' ? 'photo' : action.endsWith('v2') ? 'v2' : 'v1';
  dialog.innerHTML = `<button type="button" class="back">${t('back')}</button><h2>${t(mode === 'photo' ? 'paintingGuide' : 'jsonGuide')}</h2><p>${t('guide'+mode)}</p>${mode === 'photo' ? '' : `<pre>${esc(mode === 'v2' ? JSON.stringify([t('exampleItemOne'),t('exampleItemTwo'),t('exampleItemThree')]) : JSON.stringify([{Q:t('exampleQuestion'),C:t('fieldC'),W1:t('fieldW1'),W2:t('fieldW2'),W3:t('fieldW3')}],null,2))}</pre><p>${t('guideSave')}</p>`}`;
  dialog.querySelector('button').onclick = () => dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.append(dialog);
  dialog.showModal();
  const sound = audioToggle.cloneNode(true); sound.removeAttribute('id');
  sound.onclick = () => { audioToggle.click(); sound.setAttribute('aria-pressed',audioToggle.getAttribute('aria-pressed')); sound.setAttribute('aria-label',audioToggle.getAttribute('aria-label')); };
  dialog.append(sound);
}
function unlockForm() {
  currentView = "unlock";
  app.innerHTML = `<section class="panel">${back()}<h2>${t("welcomeHost")}</h2><form id="unlock-form" class="stack"><div><label for="room">${t("roomId")}</label>${roomNumberInput()}</div><div><label for="password">${t("password")}</label><input type="password" id="password" name="password" required minlength="4" autocomplete="current-password"></div><p class="error" id="form-error" hidden></p><button type="submit" class="primary">${t("enter")}</button></form></section>`;
}
function updateLanguageControls() {
  document.title=t("pageTitle");
  document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-label',t(button.dataset.language==='frr'?'quizFrench':'quizEnglish')));
  document.querySelector(".logo").setAttribute("aria-label",t("homeLabel"));
  document.querySelector("#header-tagline").textContent = t("header");
  document
    .querySelector(".language-toggle")
    .setAttribute("aria-label", t("language"));
  document
    .querySelectorAll("[data-language]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.language === locale()),
      ),
    );
  const label = music.enabled ? t("mute") : t("unmute");
  audioToggle.title = label;
  audioToggle.setAttribute("aria-label", label);
}
function redrawLanguage() {
  updateLanguageControls();
  const fields = [...app.querySelectorAll("input,select")].map((input) => ({
    id: input.id,
    value: input.value,
    element: input.type === "file" ? input : null,
  }));
  if (currentView === "room") {
    if (snapshot?.phase === 'painting') app.innerHTML = '';
    signature = "";
    renderRoom();
  } else if (currentView === "v3") ballRooms.redraw();
  else if (currentView === "roles") roleSelection();
  else if (currentView === "guest") guestForm();
  else if (currentView === "host") hostForm(false);
  else if (currentView === "unlock") unlockForm();
  else if (currentView === "home") home();
  else if (currentView === "loading") {
    const heading = app.querySelector(".loader h2"),
      message = app.querySelector(".loader p");
    if (heading) heading.textContent = t("loadingTitle");
    if (message) message.textContent = t("loading");
  }
  for (const field of fields) {
    const replacement = document.getElementById(field.id);
    if (!replacement) continue;
    if (field.element) replacement.replaceWith(field.element);
    else if (field.id === 'preset') {
      app.querySelector('#host-v2-form').dataset.selectedPreset = field.value;
    } else replacement.value = field.value;
  }
  app.querySelector('#host-form')?.syncEntryMode?.();
  app.querySelector('#host-v2-form')?.syncEntryMode?.();
  app.querySelector('#host-v2-form')?.refreshPaintingDemo?.();
  const file = app.querySelector("#questions")?.files?.[0];
  if (file && questions)
    document.querySelector("#upload-label").textContent = t("questionFile", {
      count: questions.length,
      name: file.name,
    });
}
document.querySelectorAll("[data-language]").forEach((button) =>
  button.addEventListener("click", () => {
    setLanguage(button.dataset.language);
    redrawLanguage();
  }),
);
async function loadImage(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}
const versionLoads=new Map(), decodedImages=new Map();
const audioUrl=track=>`${import.meta.env.BASE_URL}audio/${track}-v2.mp3`;
async function preload(type) {
  if(versionLoads.has(type))return versionLoads.get(type);
  currentView='loading';
  app.innerHTML = `<section class="loader"><h2>${t("loadingTitle")}</h2><div class="loader-track" role="progressbar" aria-label="${t("loading")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="loader-fill" style="width:0%"></div></div><p>${t("loading")}</p></section>`;
  const images=[...characters.filter(c=>type==='v1'?c.id<40:c.id>=40).map(c=>c.file),
    ...(type==='v1'?themes.flatMap(({id})=>[`${id}.png`,`${id}-mobile.png`]):type==='v2'?Object.values(V2_BACKGROUNDS):['volleyball-v3.svg']),
    'role-guest.png','role-host.png','medal-gold.svg','medal-silver.svg','medal-bronze.svg'];
  const tracks=MUSIC_TRACKS.filter(track=>type==='v1'||['lobby','forest','podium'].includes(track));
  const total=images.length+tracks.length;let done=0;
  const loaded=()=>{const progress=Math.round(++done/total*100);document.querySelector('.loader-fill')?.style.setProperty('width',`${progress}%`);document.querySelector('.loader-track')?.setAttribute('aria-valuenow',progress);};
  const promise=Promise.all([...images.map(async name=>{if(!decodedImages.has(name))decodedImages.set(name,await loadImage(asset(name)));loaded();}),music.preload(audioUrl,loaded,tracks)]).catch(()=>{versionLoads.delete(type);throw Error(t('loadError'));});
  versionLoads.set(type,promise);await promise;
}
async function chooseVersion(type){
  try{await preload(type);if(type==='v3'){clearRoom();currentView='v3';ballRooms.enter(roomId);}else{hostType=type;roleSelection();}}
  catch(error){home();toast(errorText(error,'loadError'));}
}
async function poll() {
  clearTimeout(pollTimer);
  if (!roomId) return;
  const id = roomId;
  try {
    const result = await call("room_snapshot", { p_room: id });
    if (id !== roomId) return;
    if (
      (answerPending || Date.now() < answerRevealUntil) &&
      snapshot?.phase === "question" &&
      (result.data.phase !== "question" ||
        result.data.question_index !== snapshot.question_index)
    ) {
      pollTimer = setTimeout(
        poll,
        Math.max(50, answerRevealUntil - Date.now()),
      );
      return;
    }
    if (result.data.type === 'v2' && result.data.image_path && result.data.phase !== 'finished') {
      paintingImage = await preloadPainting(result.data.image_path);
      if (id !== roomId) return;
    }
    snapshot = result.data;
    offset = result.offset;
    if (lastSession && lastSession !== snapshot.session_id) {
      positions.clear();
      feedback = "";
      answerPending = false;
      signature = "";
    }
    lastSession = snapshot.session_id;
    renderRoom();
  } catch (e) {
    if (/Join this room first/.test(e.message)) {
      clearRoom();
      guestForm();
      toast(t("freshRoom"));
      return;
    }
    toast(errorText(e));
    if (!snapshot) return;
  }
  pollTimer = setTimeout(
    poll,
    snapshot?.phase === "waiting" || snapshot?.phase === "closed" ? 1000 :
      snapshot?.type === 'v2' && snapshot?.host && snapshot.phase === 'painting' ? 3000 : snapshot?.type === 'v2' && snapshot.phase === 'painting' ? 1000 : 500,
  );
}
function themeFile(theme) {
  const portrait = matchMedia(
    "(max-width: 900px) and (orientation: portrait)",
  ).matches;
  return asset(`${theme}${portrait ? "-mobile" : ""}.png`);
}
function v2BackgroundFile() {
 return asset(matchMedia('(max-width: 900px) and (orientation: portrait)').matches?V2_BACKGROUNDS.mobile:V2_BACKGROUNDS.desktop);
}
function setWorld() {
  const podium = snapshot.phase === "finished";
  document.body.classList.add("themed");
  document.body.classList.toggle("room-v2",snapshot.type==='v2'&&!podium);
  document.body.classList.toggle("podium", podium);
  document.body.classList.toggle("v2-results",podium&&snapshot.type==='v2');
  document.querySelector("#background").style.backgroundImage = podium
    ? ""
    : `url("${snapshot.type==='v2'?v2BackgroundFile():themeFile(snapshot.theme)}")`;
  setAtmosphere(podium ? "confetti" : snapshot.type==='v2'?'':snapshot.theme);
  music.setTrack(podium ? "podium" : snapshot.theme);
}
function renderRoom() {
  currentView = "room";
  setWorld();
  const s = snapshot;
  if (s.type !== "v2" && (s.phase === "countdown" || s.phase === "question") && s.deadline) {
    // Anchor zero to the countdown deadline, independently of question loading.
    const countdownEnd = new Date(s.deadline).getTime() -
      (s.phase === "question" ? 15000 : 0);
    responseClock.arm(`${roomId}:${s.session_id}:${s.question_index}`,
      countdownEnd - Date.now() - offset);
  }
  const sig = JSON.stringify([
    s.phase,
    s.question_index,
    s.session_id,
    s.phase === "waiting"
      ? s.members.map((m) => [m.id, m.character])
      : s.members.map((m) => [m.id, m.points]),
    s.answer,
    s.host,
    s.found_items,
    s.words,
    locale(),
  ]);
  if (sig === signature) {
    updateTimer();
    return;
  }
  signature = sig;
  if (s.phase !== "finished") podiumInteraction.dispose();
  if (s.phase === "waiting" || s.phase === "closed") renderWaiting();
  else if (s.phase === "countdown") renderCountdown();
  else if (s.phase === "painting") renderPainting(app,s,esc,avatar,paintingImage,translatedRank);
  else if (s.phase === "question") renderQuestion();
  else if (s.phase === "finished") renderPodium();
  updateTimer();
}
function roomHeader() {
  return `<div class="room-head"><span class="room-code">${esc(snapshot.id)}</span><span class="pill">${snapshot.host ? t("host") : t("guest")}</span></div>`;
}
function renderWaiting() {
  const s = snapshot;
  const showTheme=s.type==='v2' && s.phase==='waiting';
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", s.id);
  app.innerHTML = `<section class="${showTheme ? 'v2-waiting' : ''}" style="max-width:650px;margin:auto">${roomHeader()}<div class="waiting-title"><p class="eyebrow">${s.started ? t("more") : t("ready")}</p><h1>${s.started ? t("company") : t("makeRoom")}</h1></div>${s.host ? `<div class="share"><input type="text" id="share-url" aria-label="${t("roomId")}" readonly value="${esc(url.href)}"><button class="secondary" data-action="copy">${t("copy")}</button></div>` : ""}<div class="arena" id="arena">${s.members.length ? "" : `<span class="empty">${s.started ? t("waitingCompany") : t("startWelcome")}</span>`}</div><p class="room-meta">${t(s.members.length === 1 ? "guestCount" : "guestsCount", { count: s.members.length })}${s.started ? " · " + t("waitingHost") : ""}</p><div class="room-actions">${s.host ? `<button class="primary" data-action="${s.started ? "play" : "start"}">${s.started ? t("play") : t("start")}</button>${s.started ? `<button class="secondary" data-action="start">${t("reset")}</button>` : ""}` : `<span class="muted"><span class="spinner"></span> ${t("comfortable")}</span>`}</div></section>`;
  if(showTheme)app.insertAdjacentHTML('beforeend',`<aside class="waiting-theme-banner">${t('waitingThemeNotice',{theme:`<strong>${esc(s.hint)}</strong>`})}</aside>`);
  placeMembers();
}
function placeMembers() {
  const arena = document.querySelector("#arena");
  if (!arena) return;
  const size = 48,
    pad = 7,
    cols = Math.max(1, Math.floor((arena.clientWidth - pad * 2) / (size + 2))),
    rows = Math.max(1, Math.floor((arena.clientHeight - pad * 2) / (size + 2)));
  const valid = new Set(snapshot.members.map((m) => m.id));
  for (const id of positions.keys()) if (!valid.has(id)) positions.delete(id);
  const used = new Set([...positions.values()].map((p) => p.slot));
  for (const m of snapshot.members) {
    if (!positions.has(m.id)) {
      const available = Array.from({ length: cols * rows }, (_, i) => i).filter(
        (i) => !used.has(i),
      );
      const slot = available.length
        ? available[Math.floor(Math.random() * available.length)]
        : Math.floor(Math.random() * cols * rows);
      used.add(slot);
      positions.set(m.id, { slot });
    }
    const { slot } = positions.get(m.id);
    const x = pad + ((slot % cols) * (arena.clientWidth - pad * 2)) / cols;
    const y =
      pad + (Math.floor(slot / cols) * (arena.clientHeight - pad * 2)) / rows;
    const el = document.createElement("div");
    el.className = "waiting-avatar";
    el.style.setProperty("--plush-delay",`${-(slot%9)*.37}s`);
    el.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;animation-delay:-${Math.random() * 3}s`;
    el.innerHTML = avatar(m.character);
    arena.append(el);
  }
}
function renderCountdown() {
  const s = snapshot;
  feedback = "";
  answerPending = false;
  const me = s.members.find((m) => m.id === s.member_id);
  const markers = rankingMarkers(s.members, s.host ? null : s.member_id);
  app.innerHTML = `<section class="countdown-screen"><div class="${s.question_index > 0 ? "ranking-panel" : ""}">${s.question_index > 0 ? `${!s.host ? `<div class="points">${(me?.points || 0).toLocaleString()} <small>${t("points")}</small></div>` : ""}<div class="road" aria-label="${t("ranking")}">${markers.map((p) => `<div class="marker ${p.id === s.member_id ? "me" : ""}" style="left:${p.position}%"><strong>${translatedRank(p.rank)}</strong><span>${esc(p.name)}</span>${avatar(p.character)}</div>`).join("")}</div>` : `<div style="text-align:center;margin-top:9vh"><p class="eyebrow">${esc(s.id)}</p><h2>${t("hereComes")}</h2></div>`}</div><div class="countdown-number"><p>${s.question_index === 0 ? t("getReady") : t("next")}</p><b id="timer">5</b>${s.type === 'v2' ? `<p class="red-x-notice">${t('redXNotice')}</p>` : ''}</div></section>`;
}
function renderQuestion() {
  const s = snapshot;
  answerPending = false;
  feedback = s.answer
    ? s.answer.correct
      ? t("correctFeedback", { rank: translatedRank(s.answer.position) })
      : t("wrongFeedback")
    : "";
  app.innerHTML = `<section class="question"><div class="question-top"><span>${s.question_index + 1} <span class="muted">/ ${s.question_count}</span></span><span class="timer"><span id="timer">15</span><small style="font-size:12px"> s</small></span></div><div class="question-card"><h2>${esc(s.question)}</h2></div><div class="answers">${(
    s.answers || []
  )
    .map((text, i) => {
      const chosen = s.answer?.choice === i;
      const hostColor = s.host && Number.isInteger(s.correct_choice) ? (s.correct_choice === i ? "host-correct" : "host-wrong") : "";
      return `<button class="answer ${hostColor} ${chosen ? "chosen " + (s.answer.correct ? "is-correct" : "is-incorrect") : ""}" data-answer="${i}" ${s.host || s.answer ? "disabled" : ""} aria-label="${chosen ? t(s.answer.correct ? "correct" : "incorrect") : esc(text)}"><span class="answer-copy"><span class="letter">${["A", "B", "C", "D"][i]}</span>${esc(text)}</span>${chosen ? `<span class="answer-result" aria-hidden="true">${s.answer.correct ? "✓" : "×"}</span>` : ""}</button>`;
    })
    .join(
      "",
    )}</div><p class="feedback" id="feedback">${s.host ? t("hostWatching") : esc(feedback)}</p></section>`;
}
function renderPodium() {
  const winners = snapshot.members.slice(0, 3);
  const order = [1, 0, 2].filter((i) => winners[i]);
  app.innerHTML = `<section class="podium-screen"><div class="podium-title"><p class="eyebrow">${t("wrap")}</p><h1>${t("legendary")}</h1></div><div class="podium-row">${order
    .map((i) => {
      const m = winners[i];
      return `<div class="winner ${["gold", "silver", "bronze"][i]}" data-place="${i + 1}" data-member="${esc(m.id)}">${avatar(m.character)}<span class="winner-name">${esc(m.name)}</span><span class="winner-points">${m.points.toLocaleString()} ${t("points")}</span><div class="step"><span class="podium-place"><img class="podium-medal" src="${asset(`medal-${["gold", "silver", "bronze"][i]}.svg`)}" alt="" aria-hidden="true" draggable="false"><span>${i + 1}</span></span></div></div>`;
    })
    .join(
      "",
    )}</div>${winners.length ? "" : `<p class="muted" style="text-align:center">${t("noPlayers")}</p>`}<div class="room-actions podium-actions">${snapshot.host ? `<button class="primary" data-action="start">${t("freshStart")}</button>` : `<button class="primary" data-action="home">${t("home")}</button>`}</div></section><div class="podium-floor" aria-label="${t("podiumPlayers")}"></div>`;
  const me = snapshot.members.find(
    (member) => member.id === snapshot.member_id,
  );
  if (!snapshot.host && [1, 2].includes(Number(me?.rank))) {
    app.querySelector(".podium-floor").classList.add("above-winner-banner");
    app.insertAdjacentHTML(
      "beforeend",
      `<aside class="winner-banner"><strong>${t(Number(me.rank) === 1 ? "wonFirst" : "wonSecond")}</strong><span>${t("dragLower")}</span></aside>`,
    );
  }
  if (snapshot.type === 'v2' && !snapshot.host && Number(me?.rank)>3) {
    app.insertAdjacentHTML('beforeend', `<div class="painting-final-rank">${translatedRank(Number(me.rank))} · ${me.points} ${t('points')}</div>`);
  }
  if(snapshot.type==='v2'&&!snapshot.host)app.insertAdjacentHTML('beforeend',wordsReview(snapshot.words,esc));
  podiumInteraction.mount(app, snapshot);
  placePodiumPlayers();
}
function placePodiumPlayers() {
  const floor = app.querySelector(".podium-floor");
  if (!floor) return;
  const size = 44,
    pad = 6,
    cols = Math.max(1, Math.floor((floor.clientWidth - pad * 2) / (size + 4))),
    rows = Math.max(1, Math.floor((floor.clientHeight - pad * 2) / (size + 4)));
  const used = new Set();
  const placed = [];
  const gridX = (slot) => pad + (slot % cols) * Math.max(0, (floor.clientWidth - size - pad * 2) / Math.max(1, cols - 1));
  const gridY = (slot) => pad + Math.floor(slot / cols) * Math.max(0, (floor.clientHeight - size - pad * 2) / Math.max(1, rows - 1));
  for (const member of snapshot.members.slice(3)) {
    const slots = Array.from({ length: cols * rows }, (_, i) => i).filter(
      (i) => !used.has(i),
    );
    // Choose the free slot farthest from its nearest occupied neighbor.
    // Randomize ties so the crowd still has a fresh arrangement each time.
    const available = slots.length ? slots : Array.from({ length: cols * rows }, (_, i) => i);
    const distance = (slot) => placed.length ? Math.min(...placed.map((p) => Math.hypot(gridX(slot) - p.x, gridY(slot) - p.y))) : 0;
    const best = Math.max(...available.map(distance));
    const candidates = available.filter((slot) => distance(slot) === best);
    const slot = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(slot);
    const x = Math.min(
        floor.clientWidth - size - pad,
        gridX(slot),
      ),
      y = Math.min(
        floor.clientHeight - size - pad,
        gridY(slot),
      );
    placed.push({ x, y });
    const el = document.createElement("div");
    el.className = "podium-roamer";
    el.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px`;
    el.innerHTML = avatar(member.character);
    floor.append(el);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const points = Array.from({ length: 7 }, (_, i) =>
        i === 0
          ? { x: 0, y: 0 }
          : {
              x: Math.max(pad, Math.min(floor.clientWidth - size - pad,
                x + (Math.random() - 0.5) * 14)) - x,
              y: Math.max(pad, Math.min(floor.clientHeight - size - pad,
                y + (Math.random() - 0.5) * 14)) - y,
            },
      );
      points.push(points[0]);
      let total = 0;
      const distances = [0];
      for (let i = 1; i < points.length; i++) {
        total += Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y,
        );
        distances.push(total);
      }
      const frames = points.map((point, i) => ({
        transform: `translate(${point.x}px,${point.y}px)`,
        offset: total ? distances[i] / total : i / (points.length - 1),
      }));
      el.animate(frames, {
        duration: Math.max(45000, (total / 12) * 1000),
        iterations: Infinity,
        easing: "linear",
      });
    }
  }
}
function updateTimer() {
  const el = document.querySelector("#timer");
  if (!el || !snapshot?.deadline) return;
  const left = Math.max(
    0,
    Math.ceil(
      (new Date(snapshot.deadline).getTime() - Date.now() - offset) / 1000,
    ),
  );
  el.textContent = `${left}${snapshot.type==='v2'&&snapshot.phase==='painting'?' s':''}`;
  if (snapshot.type === 'v2' && snapshot.phase === 'painting' && left === 0)
    app.querySelectorAll('#guess-form input,#guess-form button').forEach(b=>b.disabled=true);
  if (snapshot.phase === "question" && left === 0)
    app.querySelectorAll("[data-answer]").forEach((b) => (b.disabled = true));
}
setInterval(updateTimer, 100);
async function submitItem(form) {
  if (itemPending || snapshot?.phase !== 'painting' || snapshot.host) return;
  const input = form.querySelector('input');
  const guess = input.value;
  if (!guess.trim()) return;
  itemPending = true;
  form.querySelector('button').disabled = true;
  const session = snapshot.session_id, id = roomId;
  try {
    const {data} = await call('submit_item',{p_room:id,p_session:session,p_guess:guess});
    if (roomId !== id || snapshot.session_id !== session) return;
    input.value = '';
    if (!data.duplicate) {
      itemReward(data.correct);
    } else toast(t('itemRepeated'));
    await poll();
  } catch(error) { toast(errorText(error)); }
  finally {
    itemPending = false;
    if (form.isConnected) {
      form.querySelector('button').disabled = input.disabled;
      if (!input.disabled) input.focus();
    }
  }
}
async function submitAnswer(choice, elapsedMs) {
  if (answerPending || snapshot.host || snapshot.answer) return;
  answerPending = true;
  app.querySelectorAll("[data-answer]").forEach((b) => (b.disabled = true));
  try {
    const { data } = await call("submit_answer", {
      p_room: roomId,
      p_session: snapshot.session_id,
      p_question: snapshot.question_index,
      p_choice: choice,
      p_elapsed_ms: elapsedMs,
    });
    snapshot.answer = data;
    answerRevealUntil = Date.now() + 1000;
    signature = "";
    renderRoom();
    if (data.correct) reward(data.position);
  } catch (e) {
    toast(errorText(e));
    answerPending = false;
    await poll();
  }
}
app.addEventListener("click", async (e) => {
  if(currentView==='v3')return;
  const elapsedMs = responseClock.elapsed();
  const character = e.target.closest("[data-character]");
  if (character) {
    selected = Number(character.dataset.character);
    app.querySelectorAll("[data-character]").forEach((b) => {
      b.classList.toggle("selected", Number(b.dataset.character) === selected);
      b.setAttribute("aria-pressed", Number(b.dataset.character) === selected);
    });
    return;
  }
  const theme = e.target.closest("[data-theme]");
  if (theme) {
    selectedTheme = theme.dataset.theme;
    app.querySelectorAll("[data-theme]").forEach((b) => {
      b.classList.toggle("selected", b.dataset.theme === selectedTheme);
      b.setAttribute("aria-pressed", b.dataset.theme === selectedTheme);
    });
    return;
  }
  const answer = e.target.closest("[data-answer]");
  if (answer) return submitAnswer(Number(answer.dataset.answer), elapsedMs);
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if(action.startsWith('choose-')){await chooseVersion(action.slice(7));return;}
  if(action==='chatgpt-painting-guide'){openPaintingGuide({esc,audioToggle});return;}
  if (action === 'painting-guide' || action?.startsWith('json-guide-')) { openUploadGuide(action); return; }
  if (action === 'rooms-v2' || action === 'rooms-v1') {
    hostType = action === 'rooms-v2' ? 'v2' : 'v1';
    hostForm(false); window.scrollTo({top:0}); return;
  }
  if (action === 'demo-v2') {
    const button=e.target.closest('button');button.disabled=true;
    try { await openPaintingDemo(app.querySelector('#host-v2-form'),{esc,music,audioToggle,itemReward,avatar,setAtmosphere,background:v2BackgroundFile()}); }
    catch(error){toast(errorText(error));}
    finally{if(button.isConnected)app.querySelector('#host-v2-form')?.refreshPaintingDemo?.();}
    return;
  }
  if (action === "demo") return openQuestionDemo();
  if (action === "home") {
    roomId = "";
    history.replaceState(null, "", location.pathname);
    return home();
  }
  if (action === "find-room") return findGuestRoom();
  if (action === "guest") {
    guestRoom = null;
    guestForm();
    return;
  }
  if (action === "host") return hostForm();
  if (action === "unlock") return unlockForm();
  if (action === "copy") {
    try {
      await navigator.clipboard.writeText(
        document.querySelector("#share-url").value,
      );
      toast(t("linkCopied"));
    } catch {
      document.querySelector("#share-url").select();
      toast(t("copyManual"));
    }
    return;
  }
  if ((action === "start" || action === "play") && !busy) {
    busy = true;
    try {
      await call(`${action}_room`, { p_room: roomId });
      await poll();
    } catch (e) {
      toast(errorText(e));
    } finally {
      busy = false;
    }
  }
});
app.addEventListener("input", (event) => {
  if (!["guest","unlock"].includes(currentView) || event.target.id !== "room") return;
  const input=event.target, digits=roomDigits(input.value);
  if(input.value!==digits){
    const caret=roomDigits(input.value.slice(0,input.selectionStart??input.value.length)).length;
    input.value=digits;input.setSelectionRange(caret,caret);
  }
  app.querySelector('#form-error').hidden=true;
  if (currentView === "guest" && guestRoom && guestRoomCode(digits) !== guestRoom.id) {
    guestRoom = null;
    app.querySelector("#character-picker").innerHTML = characterPicker();
  }
});

app.addEventListener("change", async (e) => {
  if (e.target.id === 'painting' || e.target.id === 'items-json') {
    const label = app.querySelector(e.target.id === 'painting' ? '#painting-label' : '#items-label');
    label.textContent = e.target.files[0]?.name || t(e.target.id === 'painting' ? 'paintingUpload' : 'itemsUpload');
    return;
  }
  if (e.target.id !== "questions") return;
  const state=quizEntryState, file=e.target.files[0];
  app.querySelector('#host-form').setImportedQuestions(null);
  try {
    if (!file) return;
    const imported=validateQuestions(JSON.parse(await file.text()));
    if(quizEntryState!==state || e.target.files[0]!==file)return;
    state.imported=imported;
    const form=app.querySelector('#host-form');
    if(!form)return;
    form.setImportedQuestions(imported);
    form.querySelector('#upload-label').textContent=t('questionFile',{count:imported.length,name:file.name});
  } catch (error) {
    if(quizEntryState!==state || e.target.files[0]!==file)return;
    e.target.value = "";
    const label=app.querySelector('#upload-label');
    if(label)label.textContent = t("upload");
    toast(errorText(error));
  }
});
app.addEventListener("submit", async (e) => {
  if(currentView==='v3')return;
  e.preventDefault();
  if (e.target.id === 'guess-form') { await submitItem(e.target); return; }
  if (busy) return;
  busy = true;
  const button = e.target.querySelector("[type=submit]");
  button.disabled = true;
  const errorEl = document.querySelector("#form-error");
  errorEl.hidden = true;
  try {
    const fields = new FormData(e.target);
    if(['host-form','host-v2-form'].includes(e.target.id)){
      const password=String(fields.get('password')||'');
      if(password.length<4 || !password.trim())throw Error('Use at least four password characters.');
    }
    if (e.target.id === 'host-v2-form') {
      const draft = await paintingDraft(e.target);
      if(draft.presetId) {
        roomId=(await call('create_room_from_preset',{p_preset:draft.presetId,p_password:fields.get('password')})).data;
      } else {
        const hint=validateDescription(fields.get('hint'));
        roomId = await createPaintingRoom({...draft,password:fields.get('password'),hint,duration:Number(fields.get('duration')),quizLanguage:fields.get('quiz-language'),objectTheme:draft.hint});
      }
    } else if (e.target.id === "host-form") {
      if (!questions) throw Error(e.target.dataset.entryMode === 'manual' ? t('createQuizFirst') : 'Upload your questions first.');
      const { data } = await call("create_room", {
        p_theme: selectedTheme,
        p_password: fields.get("password"),
        p_questions: validateQuestions(questions),
      });
      roomId = data;
    } else if (e.target.id === "guest-form") {
      roomId = guestRoomCode(fields.get("room"));
      const data=await refreshGuestRoom(roomId);
      if(!data)return;
      if(!data.can_join)throw Error(t('notOpen'));
      await call("join_room", {
        p_room: roomId,
        p_name: String(fields.get("name")),
        p_character: selected,
      });
    } else {
      roomId = guestRoomCode(fields.get("room"));
      const info=(await call('room_info',{p_room:roomId})).data;
      if((info.type||'v1')!==hostType)throw Error(`Room has other type: ${(info.type||'v1').toUpperCase()}`);
      await call("unlock_host", {
        p_room: roomId,
        p_password: fields.get("password"),
      });
    }
    const url = new URL(location.href);
    url.searchParams.set("room", roomId);
    history.replaceState(null, "", url);
    await poll();
  } catch (error) {
    const message=errorText(error, ['host-form','host-v2-form'].includes(e.target.id)?'createRoomError':undefined);
    if (errorEl.isConnected) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    } else toast(message);
  } finally {
    busy = false;
    if (button.isConnected) button.disabled = false;
  }
});
document.querySelector(".logo").addEventListener("click", (e) => {
  e.preventDefault();
  roomId = "";
  history.replaceState(null, "", location.pathname);
  home();
});
addEventListener("resize", () => {
  if (snapshot) setWorld();
  if (snapshot?.phase === "waiting" || snapshot?.phase === "finished") {
    positions.clear();
    signature = "";
    renderRoom();
  }
});
async function boot() {
  setLanguage(locale());updateLanguageControls();
  try {
    await Promise.all([
      loadLanguages(`${import.meta.env.BASE_URL}lang.json`),
      loadCharacters(`${import.meta.env.BASE_URL}characters.json`),
    ]);
    updateLanguageControls();
    home();
    music.setTrack('lobby');
    music.preload(audioUrl,()=>{},['lobby']).catch(()=>{});
    if(new URLSearchParams(location.search).get('version')==='v3')await chooseVersion('v3');
    else if(roomId){const info=await call('room_info',{p_room:roomId});await chooseVersion(info.data.type||'v1');}
  } catch (error) {
    app.innerHTML = `<section class="loader"><p class="error">${esc(errorText(error,"loadError"))}</p><button class="primary" id="retry">${t("retry")}</button></section>`;
    document.querySelector("#retry").onclick = () => location.reload();
  }
}
boot();
