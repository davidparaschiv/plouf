import { test } from "node:test";
import assert from "node:assert/strict";
import {
  score,
  ordinal,
  validateQuestions,
  rankingMarkers,
} from "../src/rules.js";
test("only correct answers earn proportional points", () => {
  assert.equal(score(1.5, 1.5), 1000);
  assert.equal(score(1.5, 3), 500);
  assert.equal(score(1.5, 6), 250);
  assert.equal(score(1.5, 2, false), 0);
  assert.equal(score(0, 0), 1000);
  assert.equal(score(1, 3), 333);
});
test("ordinal suffixes include the teens", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 111].map(ordinal), [
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
    "23rd",
    "111th",
  ]);
});
test("JSON requires a question and preserves order without an artificial upper count limit", () => {
  assert.throws(()=>validateQuestions([]));
  const q = { Q: "Q", C: "C", W1: "A", W2: "B", W3: "D" };
  assert.equal(
    validateQuestions(Array.from({ length: 12000 }, () => q)).length,
    12000,
  );
  assert.throws(() => validateQuestions({ questions: [q] }));
  assert.throws(() => validateQuestions([{ ...q, W1: "C" }]));
  assert.throws(() => validateQuestions([{ ...q, Q: "" }]));
});
test("middle player is exactly centered regardless of rank or points", () => {
  const players = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    rank: i + 1,
    points: 9000 - i,
  }));
  assert.deepEqual(
    rankingMarkers(players, "5").map((m) => [m.id, m.position]),
    [
      ["0", 100],
      ["7", 0],
      ["5", 50],
    ],
  );
  assert.equal(rankingMarkers(players, "0").length, 2);
  assert.equal(rankingMarkers(players, null).length, 2);
  assert.equal(rankingMarkers([players[0]], "0").length, 1);
});
