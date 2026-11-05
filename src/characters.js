export let characterCatalog = { N: 10, categories: {} };
export let allCharacters = [];
export function validateCatalog(data) {
  if (data.N !== 10 || !data.categories)
    throw Error("Invalid character catalog.");
  const seen = new Set();
  for (const theme of ["jungle", "christmas", "forest", "underwater"]) {
    const group = data.categories[theme];
    if (!Array.isArray(group) || group.length !== data.N)
      throw Error(`Expected ${data.N} characters for ${theme}.`);
    for (const character of group) {
      if (
        !Number.isInteger(character.id) ||
        character.id < 0 ||
        seen.has(character.id) ||
        character.file !== `character-${character.id}.png` ||
        !character.name?.en ||
        !character.name?.frr
      )
        throw Error("Invalid character entry.");
      seen.add(character.id);
    }
  }
  if (seen.size !== 40) throw Error("Expected 40 unique characters.");
  return data;
}
export async function loadCharacters(url) {
  const response = await fetch(url);
  if (!response.ok) throw Error("Characters could not load.");
  characterCatalog = validateCatalog(await response.json());
  allCharacters = Object.values(characterCatalog.categories)
    .flat()
    .sort((a, b) => a.id - b.id);
}
export function themeCharacters(theme) {
  return characterCatalog.categories[theme] || [];
}
