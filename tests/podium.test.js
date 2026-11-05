import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canDragPlace,
  committedDrag,
  bouncePath,
  PODIUM_FLIGHT_MS,
  PODIUM_BOUNCES,
} from "../src/podium.js";

test("only first and second place can drag strictly lower podium players", () => {
  for (let actor = 1; actor <= 5; actor++)
    for (let target = 1; target <= 3; target++) {
      const expected =
        (actor === 1 && target > 1) || (actor === 2 && target === 3);
      assert.equal(canDragPlace(actor, target), expected);
      assert.equal(
        canDragPlace(actor, target, true),
        false,
        "host cannot drag",
      );
    }
  assert.equal(canDragPlace(undefined, 3), false);
});
test("clicks, jitter and small drags are rejected; substantial drags must leave the image", () => {
  const rect = {
    left: 100,
    top: 100,
    right: 165,
    bottom: 165,
    width: 65,
    height: 65,
  };
  const start = { x: 130, y: 130 };
  assert.equal(committedDrag(start, start, rect), false);
  assert.equal(committedDrag(start, { x: 139, y: 134 }, rect), false);
  assert.equal(committedDrag(start, { x: 180, y: 145 }, rect), false);
  assert.equal(committedDrag(start, { x: 240, y: 140 }, rect), true);
  assert.equal(committedDrag(start, { x: 130, y: 250 }, rect), true);
});
test("the flight lasts 1.8 seconds and has exactly five distinct wall contacts", () => {
  assert.equal(PODIUM_FLIGHT_MS, 1800);
  assert.equal(PODIUM_BOUNCES, 5);
  for (let run = 0; run < 40; run++) {
    const points = bouncePath(
      { x: 100, y: 200 },
      390,
      844,
      65,
      Math.random,
      95,
    );
    assert.equal(points.length, 6);
    for (const p of points.slice(1)) {
      assert.ok(p.x >= 0 && p.x <= 325 && p.y >= 0 && p.y <= 749);
      assert.equal(
        [p.x === 0, p.x === 325, p.y === 0, p.y === 749].filter(Boolean).length,
        1,
      );
    }
    assert.equal(points.at(-1).y, 749, "lands at bottom of the viewport");
  }
});
