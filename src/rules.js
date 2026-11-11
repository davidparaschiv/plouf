import {t} from './i18n.js';
export {allCharacters as characters} from './characters.js';
export const themes = [
  { id: "jungle", name: "Jungle", note: "Into the wild" },
  { id: "forest", name: "Magical forest", note: "A little enchanted" },
  { id: "christmas", name: "Christmas", note: "Let it snow" },
  { id: "underwater", name: "Bubbles underwater", note: "Make a splash" },
];
export function validateQuestions(value) {
  if (!Array.isArray(value)) throw Error("Upload a JSON array of questions.");
  if (!value.length) throw Error(t("questionsRequired"));
  return value.map((q, i) => {
    for (const key of ["Q", "C", "W1", "W2", "W3"])
      if (typeof q?.[key] !== "string" || !q[key].trim())
        throw Error(`Question ${i + 1}: ${key} must be text.`);
    if (new Set([q.C, q.W1, q.W2, q.W3].map(v=>v.trim())).size !== 4)
      throw Error(`Question ${i + 1}: answers must be different.`);
    return Object.fromEntries(
      ["Q", "C", "W1", "W2", "W3"].map((k) => [k, q[k]]),
    );
  });
}
export function ordinal(n) {
  const mod = n % 100;
  return `${n}${mod >= 11 && mod <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}
export function score(fastest, elapsed, correct = true) {
  return correct
    ? Math.round((1000 * Math.max(0.001, fastest)) / Math.max(0.001, elapsed))
    : 0;
}
export function rankingMarkers(players, current) {
  if (!players.length) return [];
  const first = players[0],
    last = players.at(-1),
    me = players.find((p) => p.id === current);
  return [
    ...new Map(
      [first, last, me].filter(Boolean).map((p) => [
        p.id,
        {
          ...p,
          position: p.id === first.id ? 100 : p.id === last.id ? 0 : 50,
        },
      ]),
    ).values(),
  ];
}
