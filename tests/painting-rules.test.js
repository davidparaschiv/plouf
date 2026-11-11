import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeItem,itemKey,itemMatches,validateItems,PaintingDemo} from '../src/painting-rules.js';
test('painting answers preserve Unicode and match accents, ligatures, case and whitespace',()=>{
 assert.equal(normalizeItem('  UNE\t  FENÊTRE  '),'une fenêtre');
 assert.equal(itemKey(' un  CŒUR '),itemKey('UN COEUR'));
 assert.equal(itemKey('une boîte'),itemKey('une boite'));
 assert.equal(itemKey('cafe\u0301'),itemKey('café'));
 assert.equal(itemKey('a\u00a0 blue chair'),itemKey('a blue chair'));
 assert.notEqual(itemKey('apple'),itemKey('pomme'));
 assert.deepEqual(validateItems(['été','BLUE Chair','猫']),['été','blue chair','猫']);
 assert.throws(()=>validateItems(['boîte','boite']));
 assert.throws(()=>validateItems([3]));
 assert.throws(()=>validateItems([]));
});


test('painting demo uses the whole answer list, handles duplicates and restarts at zero',async()=>{
 const {PaintingDemo,validateDescription}=await import('../src/painting-rules.js');
 const items=Array.from({length:20},(_,i)=>`item ${i}`);
 const demo=new PaintingDemo(items);
 assert.equal(demo.guess('wrong').points,-100);
 assert.equal(demo.guess('wrong').duplicate,true);
 for(let i=0;i<20;i++){
  assert.equal(demo.complete,false);
  demo.guess(`  ITEM   ${i} `);
 }
 assert.equal(demo.complete,true);assert.equal(demo.score,9900);
 assert.equal(demo.guess('item 0').duplicate,true);
 const restarted=new PaintingDemo(items);
 assert.equal(restarted.found.size,0);assert.equal(restarted.score,0);assert.equal(restarted.complete,false);
 assert.equal(validateDescription('  Four  words at most '),'Four words at most');
 assert.throws(()=>validateDescription('one two three four five'));
 assert.throws(()=>validateDescription('   '));
});

test('ASCII-only guesses can omit accents; Unicode guesses require exact accents',()=>{
 const cases=[
  ['  CAFE  ','café',true],['café','café',true],['cafe\u0301','café',true],
  ['cafè','café',false],['cafê','café',false],['café','cafe',false],
  ['COEUR','cœur',true],['cœur','cœur',true],['cœúr','cœur',false],
  ['une-fenetre 2','une-fenêtre 2',true],['une-fenétre 2','une-fenêtre 2',false],
  ['  A  BLUE CHAIR ','a blue chair',true],['chair','a blue chair',false],
  ['雪','雪',true],['été','ete',false]
 ];
 for(const [guess,answer,expected] of cases)assert.equal(itemMatches(guess,answer),expected,`${guess} vs ${answer}`);
});

test('demo wrong accents lose points without blocking valid answers or awarding repeats',()=>{
 const demo=new PaintingDemo(['café','cœur','ecole']);
 assert.deepEqual(demo.guess('cafè'),{correct:false,duplicate:false,points:-100});
 assert.equal(demo.guess(' CAFÈ ').duplicate,true);
 assert.deepEqual(demo.guess('café'),{correct:true,duplicate:false,points:400});
 assert.equal(demo.guess('cafe').duplicate,true);assert.equal(demo.score,400);
 assert.deepEqual(demo.guess('cafê'),{correct:false,duplicate:false,points:300});
 assert.equal(demo.guess('coeur').points,800);assert.equal(demo.guess('cœur').duplicate,true);
 assert.deepEqual(demo.guess('école'),{correct:false,duplicate:false,points:700});
 assert.equal(demo.guess('ecole').points,1200);assert.equal(demo.complete,true);
});

test('object themes are required, keep accents and capitalization, and allow at most four words',async()=>{
 const {validateObjectTheme}=await import('../src/painting-rules.js');
 assert.equal(validateObjectTheme('  Objets   de classe  '),'Objets de classe');
 assert.equal(validateObjectTheme('Été au jardin'),'Été au jardin');
 assert.throws(()=>validateObjectTheme(''));
 assert.throws(()=>validateObjectTheme('one two three four five'));
});
