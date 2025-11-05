// script.js — SoundSprite (commit 3)
// Contains: pad management, recorder, sequencer, and persistence
const PAD_KEYS = ['A','S','D','F','G','H','J','K','L'];
const padsContainer = document.getElementById('pads');
const padSelect = document.getElementById('pad-select');
const padNameInput = document.getElementById('pad-name');
const padVolumeInput = document.getElementById('pad-volume');
const recordBtn = document.getElementById('record-btn');
const stopBtn = document.getElementById('stop-btn');
const recIndicator = document.getElementById('rec-indicator');
const monitorChk = document.getElementById('monitor-chk');
const clearBtn = document.getElementById('clear-btn');
const downloadAllBtn = document.getElementById('download-all');

const bpmSlider = document.getElementById('bpm');
const bpmVal = document.getElementById('bpm-val');
const playLoopBtn = document.getElementById('play-loop');
const stopLoopBtn = document.getElementById('stop-loop');
const seqGrid = document.getElementById('seq-grid');
const clearLoopBtn = document.getElementById('clear-loop');

const saveNowBtn = document.getElementById('save-now');
const resetAllBtn = document.getElementById('reset-all');

let audioCtx = null;
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];

const STORAGE_KEY = 'soundsprite_v1';

// pads state
const pads = new Array(9).fill(null).map(() => ({
  name: 'Empty',
  buffer: null,
  volume: 1,
  dataURL: null,
}));

// sequencer state (9 pads x 4 steps) -> boolean
let seq = Array.from({length:9},()=> [false,false,false,false]);

// sequencer runtime
let seqTimer = null;
let seqStep = 0;
let seqPlaying = false;

function ensureAudioContext(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function refreshPadUI(){
  const padEls = padsContainer.querySelectorAll('.pad');
  padEls.forEach(el => {
    const idx = Number(el.dataset.pad);
    const label = el.querySelector('.label');
    label.textContent = pads[idx].name || 'Empty';
  });
}

function playPad(idx){
  const pad = pads[idx];
  if(!pad.buffer) return;
  const ctx = ensureAudioContext();
  const src = ctx.createBufferSource();
  src.buffer = pad.buffer;
  const gain = ctx.createGain();
  gain.gain.value = pad.volume ?? 1;
  src.connect(gain).connect(ctx.destination);
  src.start(0);
  const el = padsContainer.querySelector(`.pad[data-pad="${idx}"]`);
  el.classList.add('playing');
  setTimeout(()=> el.classList.remove('playing'), 220);
}

// build sequencer grid UI (4 steps)
function buildSeqGrid(){
  seqGrid.innerHTML = '';
  for(let step=0;step<4;step++){
    const column = document.createElement('div');
    // we'll display vertically by step (grid handles it)
  }
  // create 4 columns but arranged as 4-step UI
  for(let s=0;s<4;s++){
    for(let p=0;p<9;p++){
      const cell = document.createElement('div');
      cell.className = 'step';
      cell.dataset.pad = p;
      cell.dataset.step = s;
      if(seq[p][s]) cell.classList.add('on');
      cell.addEventListener('click', ()=> {
        seq[p][s] = !seq[p][s];
        cell.classList.toggle('on', seq[p][s]);
        saveToLocal(); // auto-save sequence
      });
      seqGrid.appendChild(cell);
    }
  }
}

// sequencer step tick
function seqTick(){
  // play all pads with seq[pad][seqStep]
  for(let p=0;p<9;p++){
    if(seq[p][seqStep]) playPad(p);
  }
  // advance visual step (we'll highlight step column)
  highlightSeqColumn(seqStep);
  seqStep = (seqStep + 1) % 4;
}

// highlight a column visually
function highlightSeqColumn(step){
  // clear all step highlights then add small glow for current step
  const cells = seqGrid.querySelectorAll('.step');
  cells.forEach(cell => {
    cell.style.opacity = '1';
    const s = Number(cell.dataset.step);
    if(s === step){
      cell.style.boxShadow = 'inset 0 0 0 2px rgba(255,255,255,0.02), 0 8px 18px rgba(124,58,237,0.08)';
    } else {
      cell.style.boxShadow = '';
    }
  });
}

// play/stop loop
function startLoop(){
  if(seqPlaying) return;
  seqPlaying = true;
  const bpm = Number(bpmSlider.value) || 100;
  const beatMs = 60000 / bpm; // quarter note
  const stepMs = beatMs / 1; // treat each step as quarter
  seqStep = 0;
  seqTick(); // immediate
  seqTimer = setInterval(seqTick, stepMs);
  playLoopBtn.disabled = true;
  stopLoopBtn.disabled = false;
}
function stopLoop(){
  if(!seqPlaying) return;
  clearInterval(seqTimer);
  seqTimer = null;
  seqPlaying = false;
  playLoopBtn.disabled = false;
  stopLoopBtn.disabled = true;
  highlightSeqColumn(-1);
}

// persistence
function saveToLocal(){
  const serial = pads.map(p => ({
    name: p.name,
    volume: p.volume,
    dataURL: p.dataURL
  }));
  const state = {pads: serial, seq, bpm: Number(bpmSlider.value)};
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadFromLocal(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return;
  try {
    const obj = JSON.parse(raw);
    if(obj.pads){
      for(let i=0;i<obj.pads.length && i<pads.length;i++){
        const p = obj.pads[i];
        pads[i].name = p.name || 'Empty';
        pads[i].volume = p.volume ?? 1;
        pads[i].dataURL = p.dataURL ?? null;
        if(pads[i].dataURL){
          // convert base64 to AudioBuffer
          const arrayBuf = await fetch(pads[i].dataURL).then(r=>r.arrayBuffer());
          const ctx = ensureAudioContext();
          try {
            const buf = await ctx.decodeAudioData(arrayBuf.slice(0));
            pads[i].buffer = buf;
          } catch(e){ console.warn('decode saved pad failed', e); }
        }
      }
    }
    if(obj.seq) seq = obj.seq;
    if(obj.bpm) bpmSlider.value = String(obj.bpm);
    bpmVal.textContent = bpmSlider.value;
  } catch(err){
    console.warn('load error', err);
  }
}

// recording + assigning (kept modular)
async function startRecording(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('getUserMedia not supported in this browser');
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({audio:true});
    if(monitorChk.checked){
      ensureAudioContext();
      const src = audioCtx.createMediaStreamSource(mediaStream);
      src.connect(audioCtx.destination);
    }
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (ev) => {
      if(ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
    };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, {type:'audio/webm'});
      await assignRecordingToSelectedPad(blob);
      stopStreamTracks();
      recIndicator.textContent = 'Idle';
      stopBtn.disabled = true;
      recordBtn.disabled = false;
      saveToLocal();
    };
    mediaRecorder.start();
    recIndicator.textContent = 'Recording...';
    stopBtn.disabled = false;
    recordBtn.disabled = true;
  } catch(err){
    console.error('mic error', err);
    alert('Microphone access denied or error: ' + err.message);
  }
}

function stopStreamTracks(){
  if(mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
}

async function assignRecordingToSelectedPad(blob){
  const array = await blob.arrayBuffer();
  const ctx = ensureAudioContext();
  try {
    const buffer = await ctx.decodeAudioData(array.slice(0));
    const idx = Number(padSelect.value);
    pads[idx].buffer = buffer;
    pads[idx].name = padNameInput.value.trim() || `Sample ${PAD_KEYS[idx]}`;
    pads[idx].dataURL = await blobToBase64(blob);
    refreshPadUI();
  } catch(err){
    console.error('decode error', err);
    alert('Could not decode recorded audio.');
  }
}

function stopRecording(){
  if(mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  recIndicator.textContent = 'Stopping...';
}

// blob to base64 helper
async function blobToBase64(blob){
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// UI binding & events
padsContainer.addEventListener('click', e => {
  const padEl = e.target.closest('.pad');
  if(!padEl) return;
  const idx = Number(padEl.dataset.pad);
  padSelect.value = String(idx);
  padNameInput.value = pads[idx].name === 'Empty' ? '' : pads[idx].name;
  padVolumeInput.value = Math.round((pads[idx].volume ?? 1) * 100);
  playPad(idx);
});

window.addEventListener('keydown', e => {
  const key = e.key.toUpperCase();
  const idx = PAD_KEYS.indexOf(key);
  if(idx >= 0) {
    playPad(idx);
    padSelect.value = String(idx);
    padNameInput.value = pads[idx].name === 'Empty' ? '' : pads[idx].name;
    padVolumeInput.value = Math.round((pads[idx].volume ?? 1) * 100);
  }
});

padSelect.addEventListener('change', () => {
  const idx = Number(padSelect.value);
  padNameInput.value = pads[idx].name === 'Empty' ? '' : pads[idx].name;
  padVolumeInput.value = Math.round((pads[idx].volume ?? 1) * 100);
});
padNameInput.addEventListener('input', () => {
  const idx = Number(padSelect.value);
  pads[idx].name = padNameInput.value.trim() || 'Empty';
  refreshPadUI();
  saveToLocal();
});
padVolumeInput.addEventListener('input', () => {
  const idx = Number(padSelect.value);
  const v = Number(padVolumeInput.value)/100;
  pads[idx].volume = Number.isFinite(v)? v : 1;
  saveToLocal();
});

recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);

clearBtn.addEventListener('click', () => {
  const idx = Number(padSelect.value);
  pads[idx] = {name:'Empty', buffer:null, volume:1, dataURL:null};
  refreshPadUI();
  saveToLocal();
});

// single-pad download (clicking pad name triggers download)
padsContainer.addEventListener('dblclick', e => {
  const padEl = e.target.closest('.pad');
  if(!padEl) return;
  const idx = Number(padEl.dataset.pad);
  if(pads[idx].dataURL){
    const a = document.createElement('a');
    a.href = pads[idx].dataURL;
    a.download = `${pads[idx].name || 'pad' + idx}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    alert('No sample to download for this pad.');
  }
});

downloadAllBtn.addEventListener('click', () => {
  pads.forEach((p, i) => {
    if(p && p.dataURL){
      const a = document.createElement('a');
      a.href = p.dataURL;
      a.download = `${(p.name || `pad${i}`)}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  });
});

// sequencer controls
bpmSlider.addEventListener('input', () => {
  bpmVal.textContent = bpmSlider.value;
  saveToLocal();
  // if playing, restart with new BPM
  if(seqPlaying){
    stopLoop();
    startLoop();
  }
});
playLoopBtn.addEventListener('click', startLoop);
stopLoopBtn.addEventListener('click', stopLoop);
clearLoopBtn.addEventListener('click', () => {
  seq = Array.from({length:9},()=> [false,false,false,false]);
  buildSeqGrid();
  saveToLocal();
});

// persistence buttons
saveNowBtn.addEventListener('click', () => {
  saveToLocal();
  alert('Saved locally.');
});
resetAllBtn.addEventListener('click', () => {
  if(!confirm('Reset all pads and sequence? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  // reset runtime state
  for(let i=0;i<9;i++) pads[i] = {name:'Empty', buffer:null, volume:1, dataURL:null};
  seq = Array.from({length:9},()=> [false,false,false,false]);
  buildSeqGrid();
  refreshPadUI();
  bpmSlider.value = 100;
  bpmVal.textContent = 100;
});

// visual grid build, initialization
function buildPadsUI(){
  // pads already present in DOM markup; just ensure labels reflect state
  refreshPadUI();
}
function init(){
  buildPadsUI();
  buildSeqGrid();
  loadFromLocal().then(()=> {
    refreshPadUI();
    buildSeqGrid();
  });
}
init();
