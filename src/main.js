import "./style.css";
import { PodiumInteraction } from "./podium.js";
const podiumInteraction = new PodiumInteraction();
import { loadCharacters, themeCharacters } from "./characters.js";
import {
  characters,
  themes,
  validateQuestions,
  ordinal,
  rankingMarkers,
} from "./rules.js";
import { rpc } from "./api.js";
import { setAtmosphere, reward } from "./effects.js";
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
  `<img class="avatar ${extra}" src="${asset(`character-${character}.png`)}" alt="" draggable="false">`;
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
  currentView = "loading",
  preloadPromise;
const call = rpc;
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 4500);
}
function clearRoom() {
  podiumInteraction.dispose();
  clearTimeout(pollTimer);
  snapshot = null;
  signature = "";
  lastSession = "";
  positions.clear();
  answerPending = false;
  feedback = "";
  answerRevealUntil = 0;
  document.body.classList.remove("themed", "podium");
  document.querySelector("#background").style.backgroundImage = "";
  setAtmosphere("");
  music.setTrack("lobby");
}
function back() {
  return `<button class="back" data-action="home">${t("back")}</button>`;
}
function home() {
  clearRoom();
  currentView = "home";
  app.innerHTML = `<section class="hero"><p class="eyebrow">${t("eyebrow")}</p><h1>${t("spark")}<br>${t("lot")} <em>Plouf.</em></h1><p class="home-description">${t("description")}</p></section><section class="roles" aria-label="${t("joiningHow")}"><button class="role" data-action="guest"><span class="symbol" aria-hidden="true"><img src="${asset("role-guest.png")}" alt=""></span><strong>${t("guest")}</strong><small>${t("guestNote")}</small><span class="arrow">↗</span></button><button class="role host" data-action="host"><span class="symbol" aria-hidden="true"><img src="${asset("role-host.png")}" alt=""></span><strong>${t("host")}</strong><small>${t("hostNote")}</small><span class="arrow">↗</span></button></section><p class="home-footer">${t("footer")}</p><p class="word-note">${t("wordNote")}</p>`;
  if (roomId)
    app.querySelector(".hero").innerHTML =
      `<p class="eyebrow">${esc(roomId)}</p><h1>${t("comeIn")}</h1><p class="muted">${t("joiningHow")}</p>`;
}
function characterPicker() {
  const group = guestRoom ? themeCharacters(guestRoom.theme) : [];
  if (!group.length) return `<p class="muted">${t("roomFirst")}</p>`;
  return `<div><span class="field-label">${t("chooseCharacter")} · ${t(guestRoom.theme)}</span><div class="characters">${group.map((c) => `<button type="button" class="character ${c.id === selected ? "selected" : ""}" data-character="${c.id}" aria-pressed="${c.id === selected}">${avatar(c.id)}<span>${esc(c.name[locale()])}</span></button>`).join("")}</div></div>`;
}
function guestForm() {
  currentView = "guest";
  app.innerHTML = `<section class="panel">${back()}<h2>${t("entrance")}</h2><p class="muted">${t("entranceNote")}</p><form id="guest-form" class="stack"><div><label for="room">${t("roomId")}</label><div class="room-lookup"><input id="room" name="room" type="text" required value="${esc(roomId)}" placeholder="PID-10020" autocapitalize="characters" autocomplete="off"><button type="button" class="secondary" data-action="find-room">${t("checkRoom")}</button></div></div><div><label for="name">${t("yourName")}</label><input id="name" name="name" type="text" required maxlength="32" placeholder="${t("namePlaceholder")}" autocomplete="nickname"></div><div id="character-picker">${characterPicker()}</div><p class="error" id="form-error" hidden></p><button class="primary wide" type="submit" ${guestRoom?.can_join ? "" : "disabled"}>${t("join")}</button></form></section>`;
}
async function findGuestRoom() {
  if (busy) return;
  const room = app.querySelector("#room").value.trim().toUpperCase();
  if (!room) return;
  const button = app.querySelector('[data-action="find-room"]');
  button.disabled = true;
  busy = true;
  try {
    const { data } = await call("room_info", { p_room: room });
    if (
      currentView !== "guest" ||
      app.querySelector("#room").value.trim().toUpperCase() !== room
    )
      return;
    guestRoom = { id: room, ...data };
    roomId = room;
    selected = themeCharacters(data.theme)[0].id;
    app.querySelector("#character-picker").innerHTML = characterPicker();
    app.querySelector("[type=submit]").disabled = !data.can_join;
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
  if (reset) questions = null;
  app.innerHTML = `<section class="panel">${back()}<h2>${t("hostTitle")}</h2><p class="muted">${t("hostNoteForm")}</p><form id="host-form" class="stack"><div><span class="field-label">${t("chooseWorld")}</span><div class="themes">${themes.map((theme) => `<button type="button" data-theme="${theme.id}" class="theme ${theme.id === selectedTheme ? "selected" : ""}" aria-pressed="${theme.id === selectedTheme}"><img src="${asset(theme.id + ".png")}" alt=""><span>${t(theme.id)}</span></button>`).join("")}</div></div><label class="upload"><span id="upload-label">${t("upload")}</span><input id="questions" type="file" accept="application/json,.json" required></label><a class="back" href="${import.meta.env.BASE_URL}example-questions.json" download style="margin:0">${t("example")}</a><div><label for="password">${t("password")}</label><input id="password" name="password" type="password" required minlength="4" placeholder="${t("passwordHint")}" autocomplete="new-password"></div><p class="error" id="form-error" hidden></p><button class="primary wide" type="submit">${t("create")}</button></form><button class="back" data-action="unlock" style="margin:20px 0 0">${t("existing")}</button></section>`;
}
function unlockForm() {
  currentView = "unlock";
  app.innerHTML = `<section class="panel">${back()}<h2>${t("welcomeHost")}</h2><form id="unlock-form" class="stack"><div><label for="room">${t("roomId")}</label><input type="text" id="room" name="room" value="${esc(roomId)}" placeholder="PID-10020" required></div><div><label for="password">${t("password")}</label><input type="password" id="password" name="password" required minlength="4" autocomplete="current-password"></div><p class="error" id="form-error" hidden></p><button type="submit" class="primary">${t("enter")}</button></form></section>`;
}
function updateLanguageControls() {
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
  const fields = [...app.querySelectorAll("input")].map((input) => ({
    id: input.id,
    value: input.value,
    element: input.type === "file" ? input : null,
  }));
  if (currentView === "room") {
    signature = "";
    renderRoom();
  } else if (currentView === "guest") guestForm();
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
    else replacement.value = field.value;
  }
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
async function preload() {
  if (preloadPromise) return preloadPromise;
  app.innerHTML = `<section class="loader"><h2>${t("loadingTitle")}</h2><div class="loader-track" role="progressbar" aria-label="${t("loading")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="loader-fill" style="width:0%"></div></div><p>${t("loading")}</p></section>`;
  const images = [
    ...characters.map((character) => character.file),
    ...themes.flatMap(({ id }) => [`${id}.png`, `${id}-mobile.png`]),
    "role-guest.png",
    "role-host.png",
  ];
  const total = images.length + MUSIC_TRACKS.length;
  let done = 0;
  const loaded = () => {
    const progress = Math.round((++done / total) * 100);
    document
      .querySelector(".loader-fill")
      ?.style.setProperty("width", `${progress}%`);
    document
      .querySelector(".loader-track")
      ?.setAttribute("aria-valuenow", progress);
  };
  // Keep decoded images and music in memory across room and orientation changes.
  preloadPromise = Promise.all([
    ...images.map((name) =>
      loadImage(asset(name)).then((image) => {
        loaded();
        return image;
      }),
    ),
    music.preload(
      (track) => `${import.meta.env.BASE_URL}audio/${track}.mp3`,
      loaded,
    ),
  ]);
  try {
    return await preloadPromise;
  } catch {
    preloadPromise = null;
    throw Error(t("loadError"));
  }
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
    snapshot?.phase === "waiting" || snapshot?.phase === "closed" ? 1000 : 500,
  );
}
function themeFile(theme) {
  const portrait = matchMedia(
    "(max-width: 900px) and (orientation: portrait)",
  ).matches;
  return asset(`${theme}${portrait ? "-mobile" : ""}.png`);
}
function setWorld() {
  const podium = snapshot.phase === "finished";
  document.body.classList.add("themed");
  document.body.classList.toggle("podium", podium);
  document.querySelector("#background").style.backgroundImage = podium
    ? ""
    : `url("${themeFile(snapshot.theme)}")`;
  setAtmosphere(podium ? "confetti" : snapshot.theme);
  music.setTrack(podium ? "podium" : snapshot.theme);
}
function renderRoom() {
  currentView = "room";
  setWorld();
  const s = snapshot;
  const sig = JSON.stringify([
    s.phase,
    s.question_index,
    s.session_id,
    s.phase === "waiting"
      ? s.members.map((m) => [m.id, m.character])
      : s.members.map((m) => [m.id, m.points]),
    s.answer,
    s.host,
  ]);
  if (sig === signature) {
    updateTimer();
    return;
  }
  signature = sig;
  if (s.phase !== "finished") podiumInteraction.dispose();
  if (s.phase === "waiting" || s.phase === "closed") renderWaiting();
  else if (s.phase === "countdown") renderCountdown();
  else if (s.phase === "question") renderQuestion();
  else if (s.phase === "finished") renderPodium();
  updateTimer();
}
function roomHeader() {
  return `<div class="room-head"><span class="room-code">${esc(snapshot.id)}</span><span class="pill">${snapshot.host ? t("host") : t("guest")}</span></div>`;
}
function renderWaiting() {
  const s = snapshot;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", s.id);
  app.innerHTML = `<section style="max-width:650px;margin:auto">${roomHeader()}<div class="waiting-title"><p class="eyebrow">${s.started ? t("more") : t("ready")}</p><h1>${s.started ? t("company") : t("makeRoom")}</h1></div>${s.host ? `<div class="share"><input type="text" id="share-url" aria-label="${t("roomId")}" readonly value="${esc(url.href)}"><button class="secondary" data-action="copy">${t("copy")}</button></div>` : ""}<div class="arena" id="arena">${s.members.length ? "" : `<span class="empty">${s.started ? t("waitingCompany") : t("startWelcome")}</span>`}</div><p class="room-meta">${t(s.members.length === 1 ? "guestCount" : "guestsCount", { count: s.members.length })}${s.started ? " · " + t("waitingHost") : ""}</p><div class="room-actions">${s.host ? `<button class="primary" data-action="${s.started ? "play" : "start"}">${s.started ? t("play") : t("start")}</button>${s.started ? `<button class="secondary" data-action="start">${t("reset")}</button>` : ""}` : `<span class="muted"><span class="spinner"></span> ${t("comfortable")}</span>`}</div></section>`;
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
  app.innerHTML = `<section class="countdown-screen"><div class="${s.question_index > 0 ? "ranking-panel" : ""}">${s.question_index > 0 ? `${!s.host ? `<div class="points">${(me?.points || 0).toLocaleString()} <small>${t("points")}</small></div>` : ""}<div class="road" aria-label="${t("ranking")}">${markers.map((p) => `<div class="marker ${p.id === s.member_id ? "me" : ""}" style="left:${p.position}%"><strong>${translatedRank(p.rank)}</strong><span>${esc(p.name)}</span>${avatar(p.character)}</div>`).join("")}</div>` : `<div style="text-align:center;margin-top:9vh"><p class="eyebrow">${esc(s.id)}</p><h2>${t("hereComes")}</h2></div>`}</div><div class="countdown-number"><p>${s.question_index === 0 ? t("getReady") : t("next")}</p><b id="timer">5</b></div></section>`;
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
      return `<button class="answer ${chosen ? "chosen " + (s.answer.correct ? "is-correct" : "is-incorrect") : ""}" data-answer="${i}" ${s.host || s.answer ? "disabled" : ""} aria-label="${chosen ? t(s.answer.correct ? "correct" : "incorrect") : esc(text)}"><span class="answer-copy"><span class="letter">${["A", "B", "C", "D"][i]}</span>${esc(text)}</span>${chosen ? `<span class="answer-result" aria-hidden="true">${s.answer.correct ? "✓" : "×"}</span>` : ""}</button>`;
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
      return `<div class="winner ${["gold", "silver", "bronze"][i]}" data-place="${i + 1}" data-member="${esc(m.id)}">${avatar(m.character)}<span class="winner-name">${esc(m.name)}</span><span class="winner-points">${m.points.toLocaleString()} ${t("points")}</span><div class="step">${i + 1}</div></div>`;
    })
    .join(
      "",
    )}</div>${winners.length ? "" : `<p class="muted" style="text-align:center">${t("noPlayers")}</p>`}<div class="room-actions" style="margin-top:35px">${snapshot.host ? `<button class="primary" data-action="start">${t("freshStart")}</button>` : `<button class="primary" data-action="home">${t("home")}</button>`}</div></section><div class="podium-floor" aria-label="${t("podiumPlayers")}"></div>`;
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
  for (const member of snapshot.members) {
    const slots = Array.from({ length: cols * rows }, (_, i) => i).filter(
      (i) => !used.has(i),
    );
    const slot = slots.length
      ? slots[Math.floor(Math.random() * slots.length)]
      : Math.floor(Math.random() * cols * rows);
    used.add(slot);
    const x = Math.min(
        floor.clientWidth - size - pad,
        pad + (slot % cols) * (size + 4),
      ),
      y = Math.min(
        floor.clientHeight - size - pad,
        pad + Math.floor(slot / cols) * (size + 4),
      );
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
              x:
                Math.random() *
                  Math.max(0, floor.clientWidth - size - pad * 2) +
                pad -
                x,
              y:
                Math.random() *
                  Math.max(0, floor.clientHeight - size - pad * 2) +
                pad -
                y,
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
  el.textContent = left;
  if (snapshot.phase === "question" && left === 0)
    app.querySelectorAll("[data-answer]").forEach((b) => (b.disabled = true));
}
setInterval(updateTimer, 100);
async function submitAnswer(choice) {
  if (answerPending || snapshot.host || snapshot.answer) return;
  answerPending = true;
  app.querySelectorAll("[data-answer]").forEach((b) => (b.disabled = true));
  try {
    const { data } = await call("submit_answer", {
      p_room: roomId,
      p_session: snapshot.session_id,
      p_question: snapshot.question_index,
      p_choice: choice,
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
  if (answer) return submitAnswer(Number(answer.dataset.answer));
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
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
  if (
    currentView === "guest" &&
    event.target.id === "room" &&
    guestRoom &&
    event.target.value.trim().toUpperCase() !== guestRoom.id
  ) {
    guestRoom = null;
    app.querySelector("#character-picker").innerHTML = characterPicker();
    app.querySelector("[type=submit]").disabled = true;
  }
});
app.addEventListener("change", async (e) => {
  if (e.target.id !== "questions") return;
  questions = null;
  try {
    const file = e.target.files[0];
    if (!file) return;
    questions = validateQuestions(JSON.parse(await file.text()));
    document.querySelector("#upload-label").textContent = t("questionFile", {
      count: questions.length,
      name: file.name,
    });
  } catch (error) {
    e.target.value = "";
    document.querySelector("#upload-label").textContent = t("upload");
    toast(errorText(error));
  }
});
app.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  busy = true;
  const button = e.target.querySelector("[type=submit]");
  button.disabled = true;
  const errorEl = document.querySelector("#form-error");
  errorEl.hidden = true;
  try {
    const fields = new FormData(e.target);
    if (e.target.id === "host-form") {
      if (!questions) throw Error("Upload your questions first.");
      const { data } = await call("create_room", {
        p_theme: selectedTheme,
        p_password: fields.get("password"),
        p_questions: questions,
      });
      roomId = data;
    } else if (e.target.id === "guest-form") {
      roomId = String(fields.get("room")).trim().toUpperCase();
      if (!guestRoom || guestRoom.id !== roomId) throw Error(t("roomFirst"));
      await call("join_room", {
        p_room: roomId,
        p_name: String(fields.get("name")),
        p_character: selected,
      });
    } else {
      roomId = String(fields.get("room")).trim().toUpperCase();
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
    if (errorEl.isConnected) {
      errorEl.textContent = errorText(error);
      errorEl.hidden = false;
    } else toast(errorText(error));
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
  try {
    await Promise.all([
      loadLanguages(`${import.meta.env.BASE_URL}lang.json`),
      loadCharacters(`${import.meta.env.BASE_URL}characters.json`),
    ]);
    updateLanguageControls();
    await preload();
    home();
  } catch (error) {
    app.innerHTML = `<section class="loader"><p class="error">${esc(error.message)}</p><button class="primary" id="retry">${t("retry")}</button></section>`;
    document.querySelector("#retry").onclick = () => location.reload();
  }
}
boot();
