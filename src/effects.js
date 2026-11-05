import Phaser from "phaser";
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let scene,
  theme = "";
class Atmosphere extends Phaser.Scene {
  create() {
    scene = this;
    this.floaters = [];
    this.lastTheme = null;
    this.scale.on("resize", () => this.build());
    this.build();
  }
  build() {
    for (const x of this.floaters || []) x.destroy();
    this.floaters = [];
    this.lastTheme = theme;
    if (reduced || !theme || theme === "jungle") return;
    const { width: w, height: h } = this.scale;
    const count = theme === "confetti" ? 75 : theme === "christmas" ? 50 : 28;
    for (let i = 0; i < count; i++) {
      const g = this.add.graphics();
      const radius = Phaser.Math.Between(2, theme === "underwater" ? 16 : 5);
      if (theme === "underwater") {
        g.lineStyle(1, 0x8dcbbf, 0.5);
        g.strokeCircle(0, 0, radius);
        g.fillStyle(0xffffff, 0.25);
        g.fillCircle(-radius / 3, -radius / 3, radius / 5);
      } else if (theme === "confetti") {
        g.fillStyle(
          Phaser.Utils.Array.GetRandom([
            0xa8efd4, 0xa52761, 0xf5c76f, 0xffffff, 0xb59ee7,
          ]),
          0.85,
        );
        g.fillRoundedRect(-3, -5, 6, 10, 2);
      } else if (theme === "forest") {
        g.fillStyle(i % 2 ? 0xf7d785 : 0xffffff, 0.7);
        g.fillCircle(0, 0, radius / 2);
        g.lineStyle(1, 0xffe5a0, 0.45);
        g.lineBetween(-radius * 2, 0, radius * 2, 0);
        g.lineBetween(0, -radius * 2, 0, radius * 2);
      } else {
        g.fillStyle(0xffffff, 0.8);
        g.fillCircle(0, 0, radius);
      }
      g.x = Math.random() * w;
      g.y = Math.random() * h;
      g.speed =
        theme === "confetti"
          ? 50 + Math.random() * 60
          : 10 + Math.random() * 20;
      g.seed = Math.random() * 10;
      this.floaters.push(g);
    }
  }
  update(time, delta) {
    if (this.lastTheme !== theme) this.build();
    const { width: w, height: h } = this.scale;
    for (const p of this.floaters) {
      p.y += (p.speed * delta) / 1000;
      p.x +=
        ((theme === "underwater" ? 15 : Math.sin(time / 1800 + p.seed) * 8) *
          delta) /
        1000;
      if (theme === "confetti") p.rotation += delta * 0.001;
      if (theme === "forest")
        p.alpha = 0.3 + 0.7 * Math.abs(Math.sin(time / 1200 + p.seed));
      if (p.y > h + 25) {
        p.y = -25;
        p.x = Math.random() * w;
      }
      if (p.x > w + 20) p.x = -20;
    }
  }
}
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "effects",
  transparent: true,
  scale: { mode: Phaser.Scale.RESIZE, width: innerWidth, height: innerHeight },
  scene: Atmosphere,
  render: { antialias: true },
  banner: false,
  fps: { target: 30, forceSetTimeOut: true },
});
export function setAtmosphere(value) {
  theme = value;
}
export function reward(place) {
  if (!scene || reduced) return;
  const { width: w, height: h } = scene.scale;
  if (place === 1) {
    const rocket = scene.add.container(-40, -40);
    const g = scene.add.graphics();
    g.fillStyle(0xffffff);
    g.fillEllipse(0, 0, 30, 65);
    g.fillStyle(0xa52761);
    g.fillTriangle(0, -43, -14, -15, 14, -15);
    g.fillTriangle(-12, 10, -25, 32, -8, 25);
    g.fillTriangle(12, 10, 25, 32, 8, 25);
    g.fillStyle(0x6bd5b1);
    g.fillCircle(0, -5, 8);
    g.fillStyle(0xffc47c);
    g.fillTriangle(-9, 30, 0, 63, 9, 30);
    rocket.add(g);
    rocket.rotation = 2.35;
    scene.tweens.add({
      targets: rocket,
      x: w + 55,
      y: h + 55,
      duration: 2000,
      ease: "Cubic.In",
      onComplete: () => rocket.destroy(),
    });
  } else if (place === 2) {
    const bomb = scene.add.graphics({ x: w / 2, y: h / 2 });
    bomb.fillStyle(0x233a30);
    bomb.fillCircle(0, 0, 35);
    bomb.lineStyle(5, 0xa52761);
    bomb.lineBetween(13, -31, 25, -48);
    bomb.fillStyle(0xffcf72);
    bomb.fillCircle(27, -49, 6);
    bomb.alpha = 0;
    scene.tweens.add({
      targets: bomb,
      alpha: 1,
      duration: 500,
      onComplete: () => {
        scene.time.delayedCall(400, () => {
          bomb.destroy();
          for (let i = 0; i < 28; i++) {
            const dot = scene.add.circle(
              w / 2,
              h / 2,
              4 + Math.random() * 7,
              i % 2 ? 0xa52761 : 0xf5c76f,
            );
            const a = (Math.PI * 2 * i) / 28;
            scene.tweens.add({
              targets: dot,
              x: w / 2 + Math.cos(a) * 150,
              y: h / 2 + Math.sin(a) * 150,
              alpha: 0,
              scale: 0,
              duration: 1100,
              onComplete: () => dot.destroy(),
            });
          }
        });
      },
    });
  } else if (place === 3) {
    const plane = scene.add.graphics({ x: w + 70, y: h / 2 });
    plane.fillStyle(0xffffff);
    plane.fillPoints(
      [
        { x: -48, y: 0 },
        { x: 25, y: -35 },
        { x: 8, y: -3 },
        { x: 30, y: 16 },
        { x: 7, y: 11 },
        { x: 24, y: 36 },
      ],
      true,
    );
    plane.lineStyle(2, 0xa52761);
    plane.lineBetween(-43, 0, 8, -3);
    scene.tweens.add({
      targets: plane,
      x: -80,
      duration: 2000,
      onComplete: () => plane.destroy(),
    });
  }
}
