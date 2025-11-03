// script.js — SoundSprite core (commit 2)
// Modern ES6+, no external libs

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

let audioCtx = null;
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let monitoring = false;

const pads = new Array(9).fill(null).map(() => ({
  name: 'Empty',
  buffer: null,
  volume: 1,
  dataURL: null, // optional base64 for export
}));

// helper: ensure audio context
function ensureAudioContext(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

// update pad UI labels
function refreshPadUI(){
  const padEls = padsContainer.querySelectorAll('.pad');
  padEls.forEach(el => {
    const idx = Number(el.dataset.pad);
    const label = el.querySelector('.label');
    label.textContent = pads[idx].name || 'Empty';
  });
}

// play an AudioBuffer for pad index
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
  // visual feedback
  const el = padsContainer.querySelector(`.pad[data-pad="${idx}"]`);
  el.classList.add('playing');
  setTimeout(()=> el.classList.remove('playing'), 220);
}

// attach pad click handlers and map keyboard keys
padsContainer.addEventListener('click', e => {
  const padEl = e.target.closest('.pad');
  if(!padEl) return;
  const idx = Number(padEl.dataset.pad);
  // If pad selected in dropdown != clicked, update selection
  padSelect.value = String(idx);
  padNameInput.value = pads[idx].name === 'Empty' ? '' : pads[idx].name;
  playPad(idx);
});

window.addEventListener('keydown', e => {
  const key = e.key.toUpperCase();
  const idx = PAD_KEYS.indexOf(key);
  if(idx >= 0) {
    playPad(idx);
    padSelect.value = String(idx);
    padNameInput.value = pads[idx].name === 'Empty' ? '' : pads[idx].name;
  }
});

// set selected pad attributes
padSelect.addEventListener('change', () => {
  const idx = Number(padSelect.value);
  padNameInput.value = pads[idx].name === 'Empty' ? '' : pads[idx].name;
  padVolumeInput.value = Math.round((pads[idx].volume ?? 1) * 100);
});
padNameInput.addEventListener('input', () => {
  const idx = Number(padSelect.value);
  pads[idx].name = padNameInput.value.trim() || 'Empty';
  refreshPadUI();
});
padVolumeInput.addEventListener('input', () => {
  const idx = Number(padSelect.value);
  const v = Number(padVolumeInput.value)/100;
  pads[idx].volume = Number.isFinite(v)? v : 1;
});

// Recording helpers
async function startRecording(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('getUserMedia not supported in this browser');
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({audio:true});
    // create AudioContext for monitoring if checkbox is checked
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
  if(audioCtx && audioCtx.state !== 'closed') {
    // do not close audioCtx here; keep for playback
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
    // store a WAV-like dataURL for download convenience
    const wavURL = await blobToBase64(blob);
    pads[idx].dataURL = wavURL;
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

// buttons
recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);

clearBtn.addEventListener('click', () => {
  const idx = Number(padSelect.value);
  pads[idx] = {name:'Empty', buffer:null, volume:1, dataURL:null};
  refreshPadUI();
});

// quick download all as zip-like (will download each as separate files)
downloadAllBtn.addEventListener('click', async () => {
  // download each pad that has dataURL
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

// initial UI setup
function init(){
  // pad labels already set — but set names array to labels
  refreshPadUI();
  padVolumeInput.value = 100;
}
init();
