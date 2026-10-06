import test from 'node:test';
import assert from 'node:assert/strict';
import { PitchTracker } from '../src/pitch-tracker.js';

const targets = [82.4069, 110, 146.8324, 195.9977, 246.9417, 329.6276];
const hz = (index, cents = 0) => targets[index] * 2 ** (cents / 1200);
function setup(index = 0, cents = 0, selected = null) {
  const tracker = new PitchTracker();
  for (const now of [0, 48, 96]) tracker.update(hz(index, cents), targets, selected, now);
  return tracker;
}

test('requires a short consistent attack before acquiring or changing strings', () => {
  const tracker = new PitchTracker();
  assert.equal(tracker.update(hz(0), targets, null, 0), null);
  assert.equal(tracker.update(hz(0), targets, null, 48), null);
  assert.equal(tracker.update(hz(0), targets, null, 96).index, 0);
  assert.equal(tracker.update(hz(5), targets, null, 144), null);
  assert.equal(tracker.update(hz(0), targets, null, 192).index, 0);
  assert.equal(tracker.update(hz(1), targets, null, 240), null);
  assert.equal(tracker.update(hz(1), targets, null, 288), null);
  assert.equal(tracker.update(hz(1), targets, null, 336).index, 1);
});

test('rejects one-frame pitch spikes and follows a sustained adjustment within 250 ms', () => {
  const tracker = setup();
  assert.ok(Math.abs(tracker.update(hz(0, 100), targets, null, 144).cents) < 0.01);
  tracker.update(hz(0), targets, null, 192);
  let reading;
  for (let now = 240; now <= 432; now += 48) reading = tracker.update(hz(0, 30), targets, null, now);
  assert.ok(reading.cents > 24 && reading.cents <= 30);
  assert.ok(Math.abs(1200 * Math.log2(reading.frequency / targets[0]) - reading.cents) < 1e-8);
});

test('a fresh pluck after silence does not inherit the old pitch', () => {
  const tracker = setup(0, -40);
  assert.equal(tracker.update(null, targets, null, 850), null);
  assert.equal(tracker.update(hz(0, 20), targets, null, 900), null);
  tracker.update(hz(0, 20), targets, null, 948);
  assert.ok(Math.abs(tracker.update(hz(0, 20), targets, null, 996).cents - 20) < 1e-8);
});

test('invalid/out-of-range audio breaks confirmation and lets an old reading expire', () => {
  const tracker = setup();
  tracker.update(hz(1), targets, null, 144);
  tracker.update(null, targets, null, 192);
  assert.equal(tracker.update(hz(1), targets, null, 240), null);
  for (let now = 288; now <= 864; now += 48) assert.equal(tracker.update(600, targets, null, now), null);
  assert.equal(tracker.index, null);
});

test('manual mode retains the chosen target and reset clears its history', () => {
  const tracker = setup(1, 180, 1);
  assert.equal(tracker.index, 1);
  tracker.reset();
  assert.equal(tracker.update(hz(2), targets, 2, 144), null);
  tracker.update(hz(2), targets, 2, 192);
  assert.equal(tracker.update(hz(2), targets, 2, 240).index, 2);
});

test('brief dropouts keep the reading but widely separated samples cannot confirm a string', () => {
  const tracker = setup();
  tracker.update(null, targets, null, 144);
  assert.equal(tracker.update(hz(0), targets, null, 192).index, 0);
  tracker.reset();
  for (const now of [0, 800, 1600]) assert.equal(tracker.update(hz(0), targets, null, now), null);
});


test('slow and uneven analysis still acquires a detuned string and follows the pitch', () => {
  for (const cadence of [[0, 150, 300, 450, 600, 750], [0, 80, 240, 450, 610, 820]]) {
    const tracker = new PitchTracker();
    let reading;
    for (const now of cadence) reading = tracker.update(hz(0, 35), targets, null, now);
    assert.equal(reading.index, 0);
    assert.ok(Math.abs(reading.cents - 35) < 1e-8);
    for (let now = 1000; now <= 1750; now += 150) reading = tracker.update(hz(0, -25), targets, null, now);
    assert.ok(reading.cents < -20);
    for (let now = 1900; now <= 2350; now += 150) reading = tracker.update(hz(1, 20), targets, null, now);
    assert.equal(reading.index, 1);
    assert.ok(Math.abs(reading.cents - 20) < 1e-8);
  }
});
