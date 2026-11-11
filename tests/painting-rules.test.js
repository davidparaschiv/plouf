import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeItem,itemKey,validateItems} from '../src/painting-rules.js';
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
 assert.deepEqual(validateItems([]),[]);
});
