import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResponseClock } from '../src/response-clock.js';
test('timing starts at countdown zero even before the question loads', () => {
  let now = 1000;
  const clock = new ResponseClock(() => now);
  assert.equal(clock.elapsed(), null);
  clock.arm('room:session:0', 5000);
  now = 5999;
  assert.equal(clock.elapsed(), 0);
  now = 6250;
  // Receiving the question or rerendering must not restart the clock.
  clock.arm('room:session:0', 0);
  assert.equal(clock.elapsed(), 250);
  now = 7500;
  assert.equal(clock.elapsed(), 1500);
  clock.arm('room:session:1', 5000);
  now = 13000;
  assert.equal(clock.elapsed(), 500);
  clock.reset();
  assert.equal(clock.elapsed(), null);
});
test('a reconnect during a question retains elapsed time since countdown zero', () => {
  const clock = new ResponseClock(() => 2000);
  clock.arm('room:session:0', -3200);
  assert.equal(clock.elapsed(), 3200);
});
