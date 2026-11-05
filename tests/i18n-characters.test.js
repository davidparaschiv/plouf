import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  loadLanguages,
  setLanguage,
  t,
  translatedRank,
  errorText,
} from "../src/i18n.js";
import { validateCatalog } from "../src/characters.js";

test("EN and FR dictionaries have matching keys, preserve accents, and interpolate values", async () => {
  const dictionary = JSON.parse(
    await readFile(new URL("../public/lang.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(Object.keys(dictionary).sort(), ["en", "frr"]);
  assert.deepEqual(
    Object.keys(dictionary.en).sort(),
    Object.keys(dictionary.frr).sort(),
  );
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => dictionary });
  try {
    await loadLanguages("/lang.json");
    setLanguage("frr");
    assert.equal(t("christmas"), "Noël");
    assert.equal(t("guestCount", { count: 1 }), "1 invité");
    assert.equal(translatedRank(1), "1er");
    assert.equal(translatedRank(2), "2e");
    assert.equal(errorText(Error("Room not found.")), "Salle introuvable.");
    assert.equal(
      errorText(Error("Question 2: Q must be text.")),
      "Question 2 : Q doit être un texte.",
    );
    setLanguage("en");
    assert.equal(translatedRank(23), "23rd");
    assert.equal(t("guest"), "Guest");
  } finally {
    globalThis.fetch = previous;
    setLanguage("en");
  }
});

test("four categories contain exactly N unique characters, keeping all original IDs", async () => {
  const data = JSON.parse(
    await readFile(
      new URL("../public/characters.json", import.meta.url),
      "utf8",
    ),
  );
  validateCatalog(data);
  const all = Object.values(data.categories).flat();
  assert.equal(data.N, 10);
  assert.equal(all.length, 40);
  assert.deepEqual(
    all
      .filter((c) => c.original)
      .map((c) => c.id)
      .sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  const broken = structuredClone(data);
  broken.categories.jungle[0].id = broken.categories.christmas[0].id;
  assert.throws(() => validateCatalog(broken));
});
