import "./style.css";
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
const music = new RoomMusic();
const audioToggle = document.querySelector("#audio-toggle");
audioToggle.addEventListener("click", () => {
  const enabled = music.toggle();
  audioToggle.setAttribute("aria-pressed", String(!enabled));
  audioToggle.setAttribute(
    "aria-label",
    enabled ? "Mute music" : "Unmute music",
  );
  audioToggle.title = enabled ? "Mute music" : "Unmute music";
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
  currentView = "home",
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
  clearTimeout(pollTimer);
  snapshot = null;
  signature = "";
  lastSession = "";
  positions.clear();
  answerPending = false;
  feedback = "";
  document.body.classList.remove("themed", "podium");
  document.querySelector("#background").style.backgroundImage = "";
  setAtmosphere("");
  music.setTrack("lobby");
}
function back() {
  return '<button class="back" data-action="home">← Back</button>';
}
function home() {
  clearRoom();
  currentView = "home";
  app.innerHTML = `<section class="hero"><p class="eyebrow">Gather. Guess. Make a splash.</p><h1>A little spark.<br>A lot of <em>Plouf.</em></h1></section><section class="roles" aria-label="Choose your role"><button class="role" data-action="guest"><span class="symbol" aria-hidden="true"><img src="${asset("role-guest.png")}" alt=""></span><strong>Guest</strong><small>Find your room. Jump in.</small><span class="arrow">↗</span></button><button class="role host" data-action="host"><span class="symbol" aria-hidden="true"><img src="${asset("role-host.png")}" alt=""></span><strong>Host</strong><small>Your questions. Your world.</small><span class="arrow">↗</span></button></section><p class="home-footer">A room full of friends. One place at the top.</p>`;
  if (roomId)
    app.querySelector(".hero").innerHTML =
      `<p class="eyebrow">${esc(roomId)}</p><h1>Come on <em>in.</em></h1><p class="muted">How are you joining?</p>`;
}
function characterPicker() {
  return `<div><span class="field-label">Choose your character</span><div class="characters">${characters.map((name, i) => `<button type="button" class="character ${i === selected ? "selected" : ""}" data-character="${i}" aria-pressed="${i === selected}">${avatar(i)}<span>${name}</span></button>`).join("")}</div></div>`;
}
function guestForm() {
  currentView = "guest";
  app.innerHTML = `<section class="panel">${back()}<h2>Make your entrance.</h2><p class="muted">A name. A face. You're in.</p><form id="guest-form" class="stack"><div><label for="room">Room ID</label><input id="room" name="room" type="text" required value="${esc(roomId)}" placeholder="PID-10020" autocapitalize="characters" autocomplete="off"></div><div><label for="name">Your name</label><input id="name" name="name" type="text" required maxlength="32" placeholder="What should we call you?" autocomplete="nickname"></div>${characterPicker()}<p class="error" id="form-error" hidden></p><button class="primary wide" type="submit">Join room ↗</button></form></section>`;
}
function hostForm() {
  if (roomId) return unlockForm();
  currentView = "host";
  questions = null;
  app.innerHTML = `<section class="panel">${back()}<h2>Your room. Your rules.</h2><p class="muted">Pick a world. Bring the questions.</p><form id="host-form" class="stack"><div><span class="field-label">Choose a world</span><div class="themes">${themes.map((t) => `<button type="button" data-theme="${t.id}" class="theme ${t.id === selectedTheme ? "selected" : ""}" aria-pressed="${t.id === selectedTheme}"><img src="${asset(t.id + ".png")}" alt=""><span>${t.name}</span></button>`).join("")}</div></div><label class="upload"><span id="upload-label">↑ Upload questions · JSON</span><input id="questions" type="file" accept="application/json,.json" required></label><a class="back" href="${import.meta.env.BASE_URL}example-questions.json" download style="margin:0">Download example JSON ↗</a><div><label for="password">Host password</label><input id="password" name="password" type="password" required minlength="4" placeholder="At least 4 characters" autocomplete="new-password"></div><p class="error" id="form-error" hidden></p><button class="primary wide" type="submit">Create room ↗</button></form><button class="back" data-action="unlock" style="margin:20px 0 0">Already have a room? →</button></section>`;
}
function unlockForm() {
  currentView = "unlock";
  app.innerHTML = `<section class="panel">${back()}<h2>Welcome back, host.</h2><form id="unlock-form" class="stack"><div><label for="room">Room ID</label><input type="text" id="room" name="room" value="${esc(roomId)}" placeholder="PID-10020" required></div><div><label for="password">Host password</label><input type="password" id="password" name="password" required minlength="4" autocomplete="current-password"></div><p class="error" id="form-error" hidden></p><button type="submit" class="primary">Enter room ↗</button></form></section>`;
}
async function loadImage(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}
async function preload() {
  if (preloadPromise) return preloadPromise;
  app.innerHTML =
    '<section class="loader"><h2>Getting everyone ready.</h2><div class="loader-track" role="progressbar" aria-label="Loading room assets" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="loader-fill" style="width:0%"></div></div><p>Loading your worlds, characters & music…</p></section>';
  const images = [
    ...characters.map((_, i) => `character-${i}.png`),
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
    throw Error("Some room assets could not load. Please try again.");
  }
}
async function poll() {
  clearTimeout(pollTimer);
  if (!roomId) return;
  const id = roomId;
  try {
    const result = await call("room_snapshot", { p_room: id });
    if (id !== roomId) return;
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
      toast("The host opened a fresh room. Join again.");
      return;
    }
    toast(e.message);
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
  if (s.phase === "waiting" || s.phase === "closed") renderWaiting();
  else if (s.phase === "countdown") renderCountdown();
  else if (s.phase === "question") renderQuestion();
  else if (s.phase === "finished") renderPodium();
  updateTimer();
}
function roomHeader() {
  return `<div class="room-head"><span class="room-code">${esc(snapshot.id)}</span><span class="pill">${snapshot.host ? "Host" : "Guest"}</span></div>`;
}
function renderWaiting() {
  const s = snapshot;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", s.id);
  app.innerHTML = `<section style="max-width:650px;margin:auto">${roomHeader()}<div class="waiting-title"><p class="eyebrow">${s.started ? "The more, the merrier" : "Ready when you are"}</p><h1>${s.started ? "Good company." : "Make some room."}</h1></div>${s.host ? `<div class="share"><input type="text" id="share-url" aria-label="Room link" readonly value="${esc(url.href)}"><button class="secondary" data-action="copy">Copy link</button></div>` : ""}<div class="arena" id="arena">${s.members.length ? "" : '<span class="empty">' + (s.started ? "Waiting for a little company…" : "Start your room to welcome guests.") + "</span>"}</div><p class="room-meta">${s.members.length} ${s.members.length === 1 ? "guest" : "guests"}${s.started ? " · Waiting for the host to play" : ""}</p><div class="room-actions">${s.host ? `<button class="primary" data-action="${s.started ? "play" : "start"}">${s.started ? "Play →" : "Start room →"}</button>${s.started ? '<button class="secondary" data-action="start">Reset</button>' : ""}` : '<span class="muted"><span class="spinner"></span> Get comfortable.</span>'}</div></section>`;
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
  app.innerHTML = `<section class="countdown-screen"><div class="${s.question_index > 0 ? "ranking-panel" : ""}">${s.question_index > 0 ? `${!s.host ? `<div class="points">${(me?.points || 0).toLocaleString()} <small>PTS</small></div>` : ""}<div class="road" aria-label="Current ranking">${markers.map((p) => `<div class="marker ${p.id === s.member_id ? "me" : ""}" style="left:${p.position}%"><strong>${ordinal(p.rank)}</strong><span>${esc(p.name)}</span>${avatar(p.character)}</div>`).join("")}</div>` : `<div style="text-align:center;margin-top:9vh"><p class="eyebrow">${esc(s.id)}</p><h2>Here comes the Plouf.</h2></div>`}</div><div class="countdown-number"><p>${s.question_index === 0 ? "Get ready" : "Next question"}</p><b id="timer">5</b></div></section>`;
}
function renderQuestion() {
  const s = snapshot;
  answerPending = false;
  if (s.answer)
    feedback = s.answer.correct
      ? `${ordinal(s.answer.position)} correct answer. Nice one!`
      : "Not this one. Next question, fresh chance.";
  else feedback = "";
  app.innerHTML = `<section class="question"><div class="question-top"><span>${s.question_index + 1} <span class="muted">/ ${s.question_count}</span></span><span class="timer"><span id="timer">15</span><small style="font-size:12px"> s</small></span></div><div class="question-card"><h2>${esc(s.question)}</h2></div><div class="answers">${(s.answers || []).map((text, i) => `<button class="answer ${s.answer?.choice === i ? "chosen" : ""}" data-answer="${i}" ${s.host || s.answer ? "disabled" : ""}><span class="letter">${["A", "B", "C", "D"][i]}</span>${esc(text)}</button>`).join("")}</div><p class="feedback" id="feedback">${s.host ? "You’re hosting. Enjoy the show." : esc(feedback)}</p></section>`;
}
function renderPodium() {
  const winners = snapshot.members.slice(0, 3);
  const order = [1, 0, 2].filter((i) => winners[i]);
  app.innerHTML = `<section><div class="podium-title"><p class="eyebrow">That's a wrap</p><h1>A little <em>legendary.</em></h1></div><div class="podium-row">${order
    .map((i) => {
      const m = winners[i];
      return `<div class="winner ${["gold", "silver", "bronze"][i]}">${avatar(m.character)}<span class="winner-name">${esc(m.name)}</span><span class="winner-points">${m.points.toLocaleString()} pts</span><div class="step">${i + 1}</div></div>`;
    })
    .join(
      "",
    )}</div>${winners.length ? "" : '<p class="muted" style="text-align:center">No players this round.</p>'}<div class="room-actions" style="margin-top:35px">${snapshot.host ? '<button class="primary" data-action="start">Start a fresh room →</button>' : '<button class="primary" data-action="home">Back home →</button>'}</div></section>`;
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
    signature = "";
    renderRoom();
    if (data.correct) reward(data.position);
  } catch (e) {
    toast(e.message);
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
  if (action === "guest") return guestForm();
  if (action === "host") return hostForm();
  if (action === "unlock") return unlockForm();
  if (action === "copy") {
    try {
      await navigator.clipboard.writeText(
        document.querySelector("#share-url").value,
      );
      toast("Link copied. Invite your people.");
    } catch {
      document.querySelector("#share-url").select();
      toast("Select and copy your room link.");
    }
    return;
  }
  if ((action === "start" || action === "play") && !busy) {
    busy = true;
    try {
      await call(`${action}_room`, { p_room: roomId });
      await poll();
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
    }
  }
});
app.addEventListener("change", async (e) => {
  if (e.target.id !== "questions") return;
  questions = null;
  try {
    const file = e.target.files[0];
    if (!file) return;
    questions = validateQuestions(JSON.parse(await file.text()));
    document.querySelector("#upload-label").textContent =
      `${questions.length} questions · ${file.name}`;
  } catch (error) {
    e.target.value = "";
    document.querySelector("#upload-label").textContent =
      "↑ Upload questions · JSON";
    toast(error.message);
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
      errorEl.textContent = error.message;
      errorEl.hidden = false;
    } else toast(error.message);
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
  if (snapshot?.phase === "waiting") {
    positions.clear();
    signature = "";
    renderRoom();
  }
});
async function boot() {
  try {
    await preload();
    home();
  } catch (error) {
    app.innerHTML = `<section class="loader"><p class="error">${esc(error.message)}</p><button class="primary" id="retry">Retry</button></section>`;
    document.querySelector("#retry").onclick = () => location.reload();
  }
}
boot();
