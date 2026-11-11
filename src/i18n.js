let messages = { en: {}, frr: {} };
let language = "en";
try {
  if (localStorage.getItem("plouf-language") === "frr") language = "frr";
} catch {}
export function locale() {
  return language;
}
export async function loadLanguages(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error("Translations could not load.");
  const data = await response.json();
  if (!data.en || !data.frr) throw Error("Translations need en and frr.");
  messages = data;
  setLanguage(language);
}
export function setLanguage(value) {
  if (!["en", "frr"].includes(value)) return;
  language = value;
  if (typeof document !== "undefined")
    document.documentElement.lang = value === "frr" ? "fr" : "en";
  try {
    localStorage.setItem("plouf-language", value);
  } catch {}
}
export function t(key, params = {}) {
  return String(messages[language][key] ?? messages.en[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_, name) => params[name] ?? "",
  );
}
export function translatedRank(number) {
  if (language === "frr") return `${number}${number === 1 ? "er" : "e"}`;
  const mod = number % 100;
  return `${number}${mod >= 11 && mod <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th"}`;
}
export function errorText(error) {
  const message = error?.message ?? String(error);
  const exact = {
    "A new version is available. Refresh this page to answer.": "refreshVersion",
    "Choose a supported duration.": "durationInvalid",
    "Enter a theme hint (1–160 characters).": "hintInvalid",
    "Enter an item.": "itemEmpty",
    "All items found. Wait for the others.": "itemsDone",
    "Items must be a JSON array of strings.": "itemsInvalid",
    "Item names must be unique, including without accents.": "itemsUnique",
    "Upload a PNG painting first.": "paintingInvalid",
    "Upload a JSON array of questions.": "jsonArray",
    "Upload your questions first.": "uploadFirst",
    "Room not found.": "roomMissing",
    "This room is not accepting guests.": "roomClosed",
    "Host access required.": "hostRequired",
    "Sign in required.": "signIn",
    "Room or password is incorrect.": "wrongPassword",
    "Hosts cannot play. Use a separate browser for a guest.": "hostCannotPlay",
    "Use a name between 1 and 32 characters.": "nameLength",
    "This question is closed.": "questionClosed",
    "This session has ended.": "sessionEnded",
    "Join this room first.": "joinFirst",
    "A game is already playing.": "alreadyPlaying",
    "Start a waiting room before playing.": "startFirst",
    "Wait for a guest to join.": "waitGuest",
    "Use at least four password characters.": "passwordLength",
    "Choose a character from this room’s theme.": "characterTheme",
    "Add your Supabase settings to .env.local to connect a live room.":
      "setupRequired",
    "Failed to fetch": "networkError",
    "Failed to fetch.": "networkError",
  };
  if (exact[message]) return t(exact[message]);
  let match = message.match(/^Question (\d+): (Q|C|W1|W2|W3) must be text\.$/);
  if (match) return t("questionField", { number: match[1], key: match[2] });
  match = message.match(/^Question (\d+): answers must be different\.$/);
  if (match) return t("answersDifferent", { number: match[1] });
  if (error instanceof SyntaxError) return t("invalidJson");
  return message;
}
