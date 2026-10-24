import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PitchTracker } from '../src/pitch-tracker.js';

// Run the real microphone analysis loop with synthetic audio and a gauge spy.
// This checks the path beyond the tracker without needing microphone permission.
test('detuned audio reaches the gauge at a slow analysis cadence', async () => {
  const elements = new Map();
  const activePegs = new Set();
  const pegs = Array.from({ length: 6 }, (_, index) => ({
    classList: { toggle(_, active) { active ? activePegs.add(index) : activePegs.delete(index); } },
  }));
  const element = () => ({
    classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, children: [],
    setAttribute() {}, addEventListener() {}, appendChild() {}, textContent: '',
  });
  let now = 0;
  let frame;
  let frequency;
  const values = [];
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replaceAll('import.meta.env.PROD', 'false')
    .replaceAll('import.meta.env.BASE_URL', "'/'");
  const context = vm.createContext({
    PitchTracker,
    JustGage: class { refresh(value) { values.push(value); } },
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, element());
        return elements.get(selector);
      },
      querySelectorAll: (selector) => selector === '.headstock-string' ? pegs : [],
      createElement: element, addEventListener() {},
    },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null },
    navigator: { mediaDevices: { getUserMedia: async () => ({}) } },
    performance: { now: () => now },
    requestAnimationFrame(callback) { frame = callback; },
    AudioContext: class {
      state = 'running';
      sampleRate = 48000;
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() {
        return {
          fftSize: 8192,
          getFloatTimeDomainData(buffer) {
            for (let i = 0; i < buffer.length; i++) {
              const phase = 2 * Math.PI * frequency * i / 48000;
              buffer[i] = 0.1 * Math.sin(phase) + 0.04 * Math.sin(2 * phase);
            }
          },
        };
      }
    },
  });
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  for (const midi of [40, 45, 50, 55, 59, 64]) {
    for (const cents of [-30, 30]) {
      vm.runInContext('resetTracking()', context);
      frequency = 440 * 2 ** ((midi - 69) / 12 + cents / 1200);
      values.length = 0;
      for (let i = 0; i < 6; i++) { now += 150; frame(); }
      assert.ok(values.length > 0, `MIDI ${midi}: no gauge update`);
      assert.ok(Math.abs(values.at(-1) - cents) < 1, `MIDI ${midi}: gauge ${values.at(-1)}, expected ${cents}`);
      assert.deepEqual([...activePegs], [[40, 45, 50, 55, 59, 64].indexOf(midi)], `MIDI ${midi}: wrong tuning peg`);
    }
  }
  vm.runInContext('showWaiting()', context);
  assert.equal(activePegs.size, 0, 'automatic highlighting clears after silence');
  vm.runInContext('selectString(5); showWaiting()', context);
  assert.deepEqual([...activePegs], [5], 'manual target stays highlighted while waiting');
  assert.match(elements.get('#headstockDescription').textContent, /String 1, E4/);
  vm.runInContext('enableAuto()', context);
  assert.equal(activePegs.size, 0, 'returning to auto clears the manual target');
  vm.runInContext("tuningKey = 'halfStep'; renderStrings(); selectString(0)", context);
  assert.match(elements.get('#headstockStrings').innerHTML, /E♭/);
  assert.match(elements.get('#headstockDescription').textContent, /String 6, E♭2/);
});
