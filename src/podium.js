export const PODIUM_FLIGHT_MS = 1800;
export const PODIUM_BOUNCES = 5;

export function canDragPlace(actorRank, targetRank, host = false) {
  return (
    !host &&
    ((actorRank === 1 && [2, 3].includes(targetRank)) ||
      (actorRank === 2 && targetRank === 3))
  );
}

export function committedDrag(start, end, rect) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const threshold = Math.max(90, rect.width * 1.3);
  const center = {
    x: rect.left + rect.width / 2 + end.x - start.x,
    y: rect.top + rect.height / 2 + end.y - start.y,
  };
  const outside =
    center.x < rect.left - 18 ||
    center.x > rect.right + 18 ||
    center.y < rect.top - 18 ||
    center.y > rect.bottom + 18;
  return distance >= threshold && outside;
}

export function bouncePath(
  start,
  width,
  height,
  size,
  random = Math.random,
  objectHeight = size,
) {
  const maxX = Math.max(1, width - size),
    maxY = Math.max(1, height - objectHeight);
  const clamp = (value, max) => Math.max(0, Math.min(max, value));
  const points = [{ x: clamp(start.x, maxX), y: clamp(start.y, maxY) }];
  let previous = -1;
  for (let i = 0; i < PODIUM_BOUNCES; i++) {
    const choices = [0, 1, 2, 3].filter(
      (side) => side !== previous && (i !== 3 || side !== 3),
    );
    const side = i === 4 ? 3 : choices[Math.floor(random() * choices.length)];
    // Avoid corners: each waypoint touches exactly one wall.
    const x = maxX * (0.1 + 0.8 * random()),
      y = maxY * (0.1 + 0.8 * random());
    points.push(
      side === 0
        ? { x: 0, y }
        : side === 1
          ? { x: maxX, y }
          : side === 2
            ? { x, y: 0 }
            : { x, y: maxY },
    );
    previous = side;
  }
  return points;
}

export class PodiumInteraction {
  constructor() {
    this.key = null;
    this.used = new Set();
    this.flights = new Set();
  }
  dispose() {
    this.controller?.abort();
    if (this.active) this.restore();
    for (const flight of this.flights) {
      flight.animation.cancel();
      flight.image.remove();
    }
    this.flights.clear();
  }
  mount(root, snapshot) {
    this.dispose();
    const key = `plouf-podium:${snapshot.id}:${snapshot.session_id}`;
    if (this.key !== key) {
      this.key = key;
      try {
        this.used = new Set(JSON.parse(sessionStorage.getItem(key) || "[]"));
      } catch {
        this.used = new Set();
      }
    }
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const actor = snapshot.members.find(
      (member) => member.id === snapshot.member_id,
    );
    for (const image of root.querySelectorAll(".winner > .avatar")) {
      const place = Number(image.parentElement.dataset.place);
      const member = image.parentElement.dataset.member;
      if (this.used.has(member)) {
        image.style.visibility = "hidden";
        const name = image.parentElement.querySelector(".winner-name");
        if (name) name.style.visibility = "hidden";
        continue;
      }
      if (!canDragPlace(Number(actor?.rank), place, snapshot.host)) continue;
      image.classList.add("podium-draggable");
      image.addEventListener(
        "pointerdown",
        (event) => {
          if (
            this.active ||
            event.button !== 0 ||
            event.isPrimary === false ||
            this.used.has(member)
          )
            return;
          event.preventDefault();
          this.active = {
            pointer: event.pointerId,
            image,
            name: image.parentElement.querySelector(".winner-name"),
            member,
            start: { x: event.clientX, y: event.clientY },
            rect: image.getBoundingClientRect(),
            ghost: null,
          };
          image.setPointerCapture(event.pointerId);
        },
        { signal },
      );
    }
    window.addEventListener("pointermove", (event) => this.move(event), {
      signal,
      passive: false,
    });
    window.addEventListener("pointerup", (event) => this.drop(event), {
      signal,
    });
    window.addEventListener(
      "pointercancel",
      (event) => {
        if (event.pointerId === this.active?.pointer) this.restore();
      },
      { signal },
    );
    window.addEventListener("blur", () => this.restore(), { signal });
  }
  move(event) {
    const a = this.active;
    if (!a || event.pointerId !== a.pointer) return;
    const dx = event.clientX - a.start.x,
      dy = event.clientY - a.start.y;
    if (!a.ghost && Math.hypot(dx, dy) < 12) return;
    event.preventDefault();
    if (!a.ghost) {
      a.ghost = document.createElement("div");
      a.ghost.className = "podium-flight";
      const labelHeight = a.name?.getBoundingClientRect().height || 18;
      a.ghostHeight = a.rect.height + labelHeight + 10;
      a.ghost.style.cssText = `position:fixed;left:0;top:0;width:${a.rect.width}px;height:${a.ghostHeight}px;z-index:30;pointer-events:none;`;
      const portrait = a.image.cloneNode(true);
      portrait.className = "avatar";
      portrait.style.cssText = `width:${a.rect.width}px;height:${a.rect.height}px;visibility:visible`;
      a.ghost.append(portrait);
      if (a.name) {
        const label = a.name.cloneNode(true);
        label.className = "podium-flight-name";
        label.style.visibility = "visible";
        label.style.top = `${a.rect.height + 6}px`;
        a.ghost.append(label);
        a.name.style.visibility = "hidden";
      }
      a.image.style.visibility = "hidden";
      document.body.append(a.ghost);
    }
    a.ghost.style.transform = `translate(${a.rect.left + dx}px,${a.rect.top + dy}px)`;
  }
  restore() {
    if (!this.active) return;
    this.active.ghost?.remove();
    this.active.image.style.visibility = "";
    if (this.active.name) this.active.name.style.visibility = "";
    this.active = null;
  }
  drop(event) {
    const a = this.active;
    if (!a || event.pointerId !== a.pointer) return;
    const end = { x: event.clientX, y: event.clientY };
    if (!a.ghost || !committedDrag(a.start, end, a.rect)) {
      this.restore();
      return;
    }
    this.active = null;
    this.used.add(a.member);
    try {
      sessionStorage.setItem(this.key, JSON.stringify([...this.used]));
    } catch {}
    a.image.style.visibility = "hidden";
    const points = bouncePath(
      { x: a.rect.left + end.x - a.start.x, y: a.rect.top + end.y - a.start.y },
      innerWidth,
      innerHeight,
      a.rect.width,
      Math.random,
      a.ghostHeight,
    );
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      a.ghost.remove();
      return;
    }
    const animation = a.ghost.animate(
      points.map((point, i) => ({
        transform: `translate(${point.x}px,${point.y}px)`,
        offset: i / PODIUM_BOUNCES,
      })),
      { duration: PODIUM_FLIGHT_MS, easing: "linear", fill: "forwards" },
    );
    const flight = { animation, image: a.ghost };
    this.flights.add(flight);
    animation.finished
      .then(() => {
        a.ghost.remove();
        this.flights.delete(flight);
      })
      .catch(() => {});
  }
}
