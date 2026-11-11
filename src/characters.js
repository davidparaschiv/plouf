export let characterCatalog = { N: 10, categories: {}, plush: [] };
export let allCharacters = [];
export function validateCatalog(data) {
 if(data.N!==10||!data.categories)throw Error('Invalid character catalog.');
 const seen=new Set();
 const check=character=>{
  if(!Number.isInteger(character.id)||character.id<0||seen.has(character.id)
   ||(character.id<40?character.file!==`character-${character.id}.png`:!new RegExp(`^plush-v2-${character.id-39}-[a-f0-9]{10}\\.png$`).test(character.file))||!character.name?.en||!character.name?.frr)throw Error('Invalid character entry.');
  seen.add(character.id);
 };
 for(const theme of ['jungle','christmas','forest','underwater']){
  const group=data.categories[theme];
  if(!Array.isArray(group)||group.length!==data.N)throw Error(`Expected ${data.N} characters for ${theme}.`);
  group.forEach(check);
 }
 if(seen.size!==40)throw Error('Expected 40 unique characters.');
 if(!Array.isArray(data.plush)||data.plush.length!==6)throw Error('Expected six plush characters.');
 data.plush.forEach((character,index)=>{if(character.id!==40+index)throw Error('Invalid plush character order.');check(character);});
 return data;
}
export async function loadCharacters(url) {
 const response=await fetch(url,{cache:'no-cache'});
 if(!response.ok)throw Error('Characters could not load.');
 characterCatalog=validateCatalog(await response.json());
 allCharacters=[...Object.values(characterCatalog.categories).flat(),...characterCatalog.plush].sort((a,b)=>a.id-b.id);
}
export function themeCharacters(theme) { return characterCatalog.categories[theme]||[]; }
export function roomCharacters(room) { return usesPlush(room)?characterCatalog.plush:themeCharacters(room?.theme); }

export function characterFile(id) { return allCharacters.find(c=>c.id===Number(id))?.file||`character-${id}.png`; }

export function usesPlush(room) { return room?.type==='v2'; }
