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
      "Question 2 : Saisissez la question.",
    );
    setLanguage("en");
    assert.equal(translatedRank(23), "23rd");
    assert.equal(t("guest"), "Guest");
    assert.equal(errorText(Error("Question 3: W2 must be text.")), "Question 3: Enter the second wrong answer.");
    assert.equal(errorText(Error("permission denied for table paintings"), "createRoomError"), "We couldn’t create your room. Please try again.");
    assert.equal(errorText(Error(t("createQuizFirst")), "createRoomError"), t("createQuizFirst"));
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

test('every literal UI translation exists in English and French', async()=>{
 const {readdir}=await import('node:fs/promises');
 const dictionary=JSON.parse(await readFile(new URL('../public/lang.json',import.meta.url),'utf8'));
 for(const file of await readdir(new URL('../src/',import.meta.url))){
  if(!file.endsWith('.js'))continue;
  const source=await readFile(new URL('../src/'+file,import.meta.url),'utf8');
  for(const match of source.matchAll(/\bt\(\s*(['"])([^'"]+)\1\s*[,)]/g)){
   for(const language of ['en','frr'])assert.ok(dictionary[language][match[2]]?.trim(),`${file}: missing ${language} label ${match[2]}`);
  }
 }
});

test('an older language response cannot expose internal names in a new build', async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{
  assert.equal(options.cache,'no-cache');
  return {ok:true,json:async()=>({en:{hostTitle:'Old title'},frr:{hostTitle:'Ancien titre'}})};
 };
 try{
  await loadLanguages('/lang.json');
  for(const language of ['en','frr']){
   setLanguage(language);
   for(const key of ['paintingUploadNote','presetLabel','fieldQ','fieldC','createQuiz','paintingDemo'])assert.notEqual(t(key),key);
  }
  setLanguage('en');assert.equal(t('hostTitle'),'Create a Quiz Room');
 }finally{globalThis.fetch=previous;setLanguage('en');}
});
