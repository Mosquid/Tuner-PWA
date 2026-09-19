import JustGage from 'justgage';
import './styles.css';

const TUNINGS = {
  standard: { name: 'Standard', strings: [['E', 2, 40], ['A', 2, 45], ['D', 3, 50], ['G', 3, 55], ['B', 3, 59], ['E', 4, 64]] },
  dropD: { name: 'Drop D', strings: [['D', 2, 38], ['A', 2, 45], ['D', 3, 50], ['G', 3, 55], ['B', 3, 59], ['E', 4, 64]] },
  halfStep: { name: 'Half step down', strings: [['E♭', 2, 39], ['A♭', 2, 44], ['D♭', 3, 49], ['G♭', 3, 54], ['B♭', 3, 58], ['E♭', 4, 63]] },
  openG: { name: 'Open G', strings: [['D', 2, 38], ['G', 2, 43], ['D', 3, 50], ['G', 3, 55], ['B', 3, 59], ['D', 4, 62]] },
  dadgad: { name: 'DADGAD', strings: [['D', 2, 38], ['A', 2, 45], ['D', 3, 50], ['G', 3, 55], ['A', 3, 57], ['D', 4, 62]] },
};

const $ = (selector) => document.querySelector(selector);
const els = {
  micStatus: $('#micStatus'), micStatusText: $('#micStatusText'), micRetry: $('#micRetry'), privacyNote: $('#privacyNote'),
  direction: $('#directionLabel'), note: $('#noteName'), accidental: $('#noteAccidental'),
  frequency: $('#frequency'), cents: $('#centsValue'), tunerCard: $('#tunerCard'),
  stringNumber: $('#stringNumber'), strings: $('#stringButtons'), signal: $('.signal'),
  autoButton: $('#autoButton'), tuningSelect: $('#tuningSelect'), tuningName: $('#tuningName'),
  stringsTitle: $('#stringsTitle'), settings: $('#settingsPanel'), scrim: $('#scrim'),
  settingsButton: $('#settingsButton'), closeSettings: $('#closeSettings'), openTuning: $('#openTuning'),
  a4Value: $('#a4Value'), a4Down: $('#a4Down'), a4Up: $('#a4Up'),
};

let audioContext;
let analyser;
let mediaStream;
let animationId;
let isListening = false;
let isStarting = false;
let autoMode = true;
let selectedString = null;
let concertA = Number(localStorage.getItem('concertA')) || 440;
let tuningKey = localStorage.getItem('tuning') || 'standard';
let recentReadings = [];
let lastStableAt = 0;
let lastVibrationAt = 0;
let lastAnalysisAt = 0;
let smoothedCents = null;
let smoothedFrequency = null;
let activeStringIndex = null;
let lockedInTune = false;

const gauge = new JustGage({
  id: 'gauge', value: 0, min: -50, max: 50,
  hideValue: true, hideMinMax: true, counter: false,
  gaugeWidthScale: 0.12, levelColors: ['#f0c86a'],
  levelColorsGradient: false, startAnimationTime: 600, refreshAnimationTime: 120,
  donut: false, relativeGaugeSize: true,
  pointer: true,
  pointerOptions: { toplength: 2, bottomlength: 6, bottomwidth: 5, stroke: '#f6f1e4', stroke_width: 1, color: '#f6f1e4' },
  customSectors: {
    percents: false,
    ranges: [
      { color: '#d46650', lo: -50, hi: -10 },
      { color: '#e2b958', lo: -10, hi: -5 },
      { color: '#90e84a', lo: -5, hi: 5 },
      { color: '#e2b958', lo: 5, hi: 10 },
      { color: '#d46650', lo: 10, hi: 50 },
    ],
  },
});

function midiToFrequency(midi) {
  return concertA * 2 ** ((midi - 69) / 12);
}

function splitNote(note) {
  const match = note.match(/^([A-G])(.+)?$/);
  return { letter: match?.[1] || note, accidental: match?.[2] || '' };
}

function renderStrings() {
  const tuning = TUNINGS[tuningKey];
  els.strings.innerHTML = '';
  tuning.strings.forEach(([note, octave, midi], index) => {
    const { letter, accidental } = splitNote(note);
    const button = document.createElement('button');
    button.className = 'string-button';
    button.dataset.index = index;
    button.setAttribute('aria-label', `String ${6 - index}, ${note}${octave}, play reference tone`);
    button.innerHTML = `<span class="string-index">${6 - index}</span><span class="string-note">${letter}<sup>${accidental}</sup></span><span class="string-octave">${octave}</span><span class="play-icon" aria-hidden="true"></span>`;
    button.addEventListener('click', () => selectString(index, true));
    els.strings.appendChild(button);
  });
  els.tuningName.textContent = tuning.name.toUpperCase();
  els.stringsTitle.textContent = `${tuning.name} tuning`;
  updateStringSelection();
}

function selectString(index, play = false) {
  autoMode = false;
  selectedString = index;
  els.autoButton.classList.remove('active');
  els.autoButton.setAttribute('aria-pressed', 'false');
  updateStringSelection();
  showTarget(index);
  if (play) playReference(midiToFrequency(TUNINGS[tuningKey].strings[index][2]));
}

function enableAuto() {
  autoMode = true;
  selectedString = null;
  els.autoButton.classList.add('active');
  els.autoButton.setAttribute('aria-pressed', 'true');
  updateStringSelection();
  els.stringNumber.textContent = 'AUTO';
}

function updateStringSelection(activeIndex = selectedString) {
  document.querySelectorAll('.string-button').forEach((button, index) => {
    button.classList.toggle('active', index === activeIndex);
  });
}

function showTarget(index) {
  const [note, octave] = TUNINGS[tuningKey].strings[index];
  const { letter, accidental } = splitNote(note);
  els.note.textContent = letter;
  els.accidental.textContent = accidental;
  els.stringNumber.textContent = `STRING ${6 - index}`;
  els.frequency.textContent = `${midiToFrequency(TUNINGS[tuningKey].strings[index][2]).toFixed(1)} Hz`;
}

async function playReference(frequency) {
  const ctx = audioContext || new AudioContext();
  if (!audioContext) audioContext = ctx;
  if (ctx.state === 'suspended') await ctx.resume();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2800, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.24, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.45);
  filter.connect(gain).connect(ctx.destination);
  [1, 2, 3].forEach((harmonic, i) => {
    const osc = ctx.createOscillator();
    const partialGain = ctx.createGain();
    osc.type = i === 0 ? 'triangle' : 'sine';
    osc.frequency.value = frequency * harmonic;
    partialGain.gain.value = 1 / (harmonic * 1.8);
    osc.connect(partialGain).connect(filter);
    osc.start(now);
    osc.stop(now + 1.5);
  });
}

async function startMicrophone() {
  if (isListening || isStarting) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    showError('Microphone access needs HTTPS or localhost.');
    return;
  }
  isStarting = true;
  els.micRetry.hidden = true;
  els.micStatus.classList.remove('error');
  els.micStatusText.textContent = 'CONNECTING TO MICROPHONE';
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    audioContext ||= new AudioContext();
    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => {});
    }
    analyser = audioContext.createAnalyser();
    // A larger window gives the low E string enough cycles for a steadier read.
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0;
    audioContext.createMediaStreamSource(mediaStream).connect(analyser);
    isListening = true;
    recentReadings = [];
    smoothedCents = null;
    smoothedFrequency = null;
    els.micStatus.classList.add('listening');
    els.micStatus.classList.toggle('needs-tap', audioContext.state === 'suspended');
    els.micStatusText.textContent = audioContext.state === 'suspended' ? 'TAP ONCE TO ACTIVATE' : 'MICROPHONE LIVE';
    els.privacyNote.textContent = 'Always listening while open. Audio never leaves this device.';
    detectPitch();
  } catch (error) {
    const message = error.name === 'NotAllowedError'
      ? 'Microphone permission was blocked. Allow it in your browser settings.'
      : 'I couldn’t open the microphone. Check that another app is not using it.';
    showError(message);
  } finally {
    isStarting = false;
  }
}

async function resumeAudioContext() {
  if (!audioContext || audioContext.state !== 'suspended') return;
  await audioContext?.resume().catch(() => {});
  if (audioContext?.state === 'running') {
    els.micStatus.classList.remove('needs-tap');
    els.micStatusText.textContent = 'MICROPHONE LIVE';
  }
}

function cleanupAudio() {
  isListening = false;
  cancelAnimationFrame(animationId);
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
}

function showError(message) {
  els.privacyNote.textContent = message;
  els.micStatus.classList.add('error');
  els.micStatus.classList.remove('listening');
  els.micStatusText.textContent = 'MICROPHONE NEEDED';
  els.micRetry.hidden = false;
  els.direction.textContent = 'ALLOW MIC TO TUNE';
}

function detectPitch() {
  if (!isListening || !analyser) return;
  if (audioContext.state === 'suspended') {
    els.micStatus.classList.add('needs-tap');
    els.micStatusText.textContent = 'TAP ONCE TO ACTIVATE';
    animationId = requestAnimationFrame(detectPitch);
    return;
  }
  if (performance.now() - lastAnalysisAt < 48) {
    animationId = requestAnimationFrame(detectPitch);
    return;
  }
  lastAnalysisAt = performance.now();
  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);
  const rms = Math.sqrt(buffer.reduce((sum, sample) => sum + sample * sample, 0) / buffer.length);
  setSignal(rms);
  const pitch = rms > 0.009 ? yinPitch(buffer, audioContext.sampleRate) : null;
  if (pitch && pitch > 60 && pitch < 700) updateFromPitch(pitch);
  else if (performance.now() - lastStableAt > 900) showWaiting();
  animationId = requestAnimationFrame(detectPitch);
}

function yinPitch(buffer, sampleRate) {
  const half = Math.floor(buffer.length / 2);
  const maxTau = Math.min(half - 1, Math.ceil(sampleRate / 60));
  const yin = new Float32Array(maxTau + 1);
  let runningSum = 0;
  yin[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    let difference = 0;
    for (let i = 0; i < half; i++) {
      const delta = buffer[i] - buffer[i + tau];
      difference += delta * delta;
    }
    runningSum += difference;
    yin[tau] = runningSum ? (difference * tau) / runningSum : 1;
  }
  const threshold = 0.14;
  let tau = 2;
  while (tau < maxTau) {
    if (yin[tau] < threshold) {
      while (tau + 1 <= maxTau && yin[tau + 1] < yin[tau]) tau++;
      const betterTau = parabolicInterpolation(yin, tau);
      return sampleRate / betterTau;
    }
    tau++;
  }
  return null;
}

function parabolicInterpolation(values, index) {
  if (index <= 0 || index >= values.length - 1) return index;
  const left = values[index - 1];
  const center = values[index];
  const right = values[index + 1];
  const divisor = 2 * (2 * center - right - left);
  return divisor ? index + (right - left) / divisor : index;
}

function updateFromPitch(frequency) {
  const strings = TUNINGS[tuningKey].strings;
  const index = autoMode ? nearestString(frequency, strings) : selectedString ?? 0;
  const target = midiToFrequency(strings[index][2]);
  const cents = 1200 * Math.log2(frequency / target);
  // One fret is 100 cents. Keep enough headroom to identify a fretted string,
  // while staying below the midpoint where adjacent guitar strings get ambiguous.
  const identificationWindow = autoMode ? 175 : 250;
  if (Math.abs(cents) > identificationWindow) return;
  if (index !== activeStringIndex) {
    recentReadings = [];
    smoothedCents = null;
    smoothedFrequency = null;
    lockedInTune = false;
    activeStringIndex = index;
  }
  recentReadings.push({ cents, frequency });
  if (recentReadings.length > 9) recentReadings.shift();
  const medianCents = median(recentReadings.map((item) => item.cents));
  const medianFrequency = median(recentReadings.map((item) => item.frequency));
  smoothedCents = smoothedCents === null ? medianCents : smoothedCents * 0.72 + medianCents * 0.28;
  smoothedFrequency = smoothedFrequency === null ? medianFrequency : smoothedFrequency * 0.72 + medianFrequency * 0.28;
  lastStableAt = performance.now();
  paintReading(index, smoothedCents, smoothedFrequency);
}

function nearestString(frequency, strings) {
  let winner = 0;
  let smallest = Infinity;
  strings.forEach(([, , midi], index) => {
    const distance = Math.abs(1200 * Math.log2(frequency / midiToFrequency(midi)));
    if (distance < smallest) { smallest = distance; winner = index; }
  });
  return winner;
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function paintReading(index, cents, frequency) {
  const [note] = TUNINGS[tuningKey].strings[index];
  const { letter, accidental } = splitNote(note);
  const absolute = Math.abs(cents);
  if (absolute <= 4.5) lockedInTune = true;
  else if (absolute > 6.5) lockedInTune = false;
  const rounded = Math.round(cents);
  els.note.textContent = letter;
  els.accidental.textContent = accidental;
  els.frequency.textContent = `${frequency.toFixed(1)} Hz`;
  els.cents.textContent = `${rounded > 0 ? '+' : ''}${rounded} cents`;
  els.stringNumber.textContent = `STRING ${6 - index}`;
  // Always show the real smoothed pitch; the tuned window affects status only.
  gauge.refresh(Math.max(-50, Math.min(50, cents)));
  updateStringSelection(index);
  if (lockedInTune) {
    els.direction.textContent = 'IN TUNE';
    els.tunerCard.dataset.state = 'tuned';
    if ('vibrate' in navigator && performance.now() - lastVibrationAt > 1200) {
      navigator.vibrate?.(12);
      lastVibrationAt = performance.now();
    }
  } else if (cents < 0) {
    els.direction.textContent = absolute <= 10 ? 'ALMOST · TUNE UP' : 'FLAT · TUNE UP';
    els.tunerCard.dataset.state = 'flat';
  } else {
    els.direction.textContent = absolute <= 10 ? 'ALMOST · TUNE DOWN' : 'SHARP · TUNE DOWN';
    els.tunerCard.dataset.state = 'sharp';
  }
}

function showWaiting() {
  els.direction.textContent = 'PLUCK A STRING';
  els.tunerCard.dataset.state = 'listening';
  els.frequency.textContent = 'Listening…';
}

function setSignal(rms) {
  const level = Math.min(5, Math.ceil(rms * 90));
  [...els.signal.children].forEach((bar, index) => bar.classList.toggle('on', index < level));
}

function openSettings() {
  els.settings.classList.add('open');
  els.scrim.classList.add('open');
  els.settings.setAttribute('aria-hidden', 'false');
  els.settingsButton.setAttribute('aria-expanded', 'true');
}

function closeSettings() {
  els.settings.classList.remove('open');
  els.scrim.classList.remove('open');
  els.settings.setAttribute('aria-hidden', 'true');
  els.settingsButton.setAttribute('aria-expanded', 'false');
}

function updateConcertA(delta) {
  concertA = Math.max(420, Math.min(460, concertA + delta));
  localStorage.setItem('concertA', concertA);
  els.a4Value.textContent = `${concertA} Hz`;
  if (selectedString !== null) showTarget(selectedString);
}

els.micRetry.addEventListener('click', startMicrophone);
els.micStatus.addEventListener('click', resumeAudioContext);
document.addEventListener('pointerdown', resumeAudioContext, { passive: true });
els.autoButton.addEventListener('click', enableAuto);
els.settingsButton.addEventListener('click', openSettings);
els.openTuning.addEventListener('click', openSettings);
els.closeSettings.addEventListener('click', closeSettings);
els.scrim.addEventListener('click', closeSettings);
els.a4Down.addEventListener('click', () => updateConcertA(-1));
els.a4Up.addEventListener('click', () => updateConcertA(1));
els.tuningSelect.addEventListener('change', (event) => {
  tuningKey = event.target.value;
  localStorage.setItem('tuning', tuningKey);
  selectedString = null;
  enableAuto();
  renderStrings();
  closeSettings();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSettings();
});
window.addEventListener('beforeunload', cleanupAudio);

els.tuningSelect.value = tuningKey;
els.a4Value.textContent = `${concertA} Hz`;
renderStrings();
startMicrophone();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
