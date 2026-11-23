import { DB } from './db.js';
import { OrientationTracker } from './orientation.js';
import { CameraManager, annotateImage, savePhotoToDevice } from './camera.js';
import { exportSessionJSON, exportSessionCSV, exportSessionZIP } from './export.js';

const state = {
  currentSession: null, sessions: [], photos: [],
  orientation: null, camera: null, lastReading: null,
  autoAnnotate: true, cameraActive: false,
  installPrompt: null, sensorAvailable: false
};
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const fmt = (v, d = 1) => (v == null || isNaN(v)) ? '—' : Number(v).toFixed(d);
const setText = (s, t) => { const el = $(s); if (el) el.textContent = t; };
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

function showScreen(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.target === name));
  if (name === 'gallery') renderGallery();
  if (name === 'sessions') renderSessions();
  if (name === 'diagnostics') renderDiagnostics();
  if (name === 'install') renderInstall();
}

async function ensureSession() {
  const sessions = await DB.listSessions();
  if (sessions.length === 0) {
    const s = await DB.createSession('Session 1');
    state.currentSession = s;
  } else {
    const lastId = await DB.getSetting('currentSessionId');
    state.currentSession = sessions.find(x => x.id === lastId) || sessions[0];
  }
  await DB.setSetting('currentSessionId', state.currentSession.id);
  updateSessionBadge();
}
function updateSessionBadge() {
  const el = $('#currentSessionName');
  if (el && state.currentSession) el.textContent = state.currentSession.name;
}

function setSensorStatus(msg, kind) {
  const el = $('#sensorStatus');
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind || 'info';
}
function onOrientationUpdate(reading) {
  state.lastReading = reading;
  const { raw, relative } = reading;
  setText('#hudYaw', fmt(raw.alpha) + '°');
  setText('#hudPitch', fmt(raw.beta) + '°');
  setText('#hudRoll', fmt(raw.gamma) + '°');
  setText('#hudRelYaw', relative ? fmt(relative.alpha) + '°' : '—');
  setText('#hudRelPitch', relative ? fmt(relative.beta) + '°' : '—');
  setText('#hudRelRoll', relative ? fmt(relative.gamma) + '°' : '—');
  setText('#hudSource', reading.hasAbsolute ? 'Absolute (magnetic reference)' : 'Relative (no compass)');
}
async function initOrientation() {
  const perm = await OrientationTracker.requestPermission();
  if (perm === 'unavailable') { setSensorStatus('DeviceOrientation API not available.', 'warn'); state.sensorAvailable = false; return; }
  if (perm === 'denied') { setSensorStatus('Sensor permission denied. Grant Motion & Orientation access in Settings → Safari.', 'error'); state.sensorAvailable = false; return; }
  const t = new OrientationTracker(onOrientationUpdate);
  t.start();
  state.orientation = t;
  state.sensorAvailable = true;
  setSensorStatus('Sensors active', 'ok');
}

async function initCamera() {
  const video = $('#cameraVideo');
  state.camera = new CameraManager(video);
  try {
    await state.camera.start('environment');
    state.cameraActive = true;
    $('#cameraPlaceholder')?.classList.add('hidden');
    toast('Camera started', 'ok');
  } catch (e) {
    toast('Camera error: ' + e.message, 'error');
    $('#cameraPlaceholder')?.classList.remove('hidden');
    state.cameraActive = false;
  }
}
async function switchCamera(facing) {
  try { await state.camera.start(facing); state.cameraActive = true; } catch (e) { toast('Switch failed: ' + e.message, 'error'); }
}

async function capturePhoto() {
  if (!state.cameraActive) return toast('Start the camera first', 'warn');
  if (!state.currentSession) return toast('No session', 'error');
  const btn = $('#captureBtn'); btn.disabled = true;
  try {
    const captureStart = Date.now();
    const { blob, width, height } = await state.camera.capture();
    const captureEnd = Date.now();
    const timestamp = new Date().toISOString();
    const reading = state.lastReading;
    const meta = {
      sessionId: state.currentSession.id, timestamp,
      captureStartedAt: new Date(captureStart).toISOString(),
      captureCompletedAt: new Date(captureEnd).toISOString(),
      sensorTimestamp: reading?.raw?.timestamp ?? null,
      yaw: reading?.raw?.alpha ?? null,
      pitch: reading?.raw?.beta ?? null,
      roll: reading?.raw?.gamma ?? null,
      relativeYaw: reading?.relative?.alpha ?? null,
      relativePitch: reading?.relative?.beta ?? null,
      relativeRoll: reading?.relative?.gamma ?? null,
      quaternion: reading?.quaternion ?? null,
      referenceSet: !!state.orientation?.reference,
      sensorSource: reading?.sensorSource ?? 'none',
      sensorAccuracy: reading?.hasAbsolute ? 'absolute' : 'relative',
      sensorAvailable: !!reading,
      width, height, mimeType: blob.type || 'image/jpeg', sizeBytes: blob.size
    };
    let annotatedBlob = null;
    if (state.autoAnnotate) {
      try {
        annotatedBlob = await annotateImage(blob, {
          yaw: meta.yaw, pitch: meta.pitch, roll: meta.roll,
          relativeYaw: meta.relativeYaw, relativePitch: meta.relativePitch, relativeRoll: meta.relativeRoll,
          timestamp, sessionId: meta.sessionId
        });
      } catch (e) { console.warn('annotate failed', e); }
    }
    const photo = await DB.addPhoto({ ...meta, blob, annotatedBlob });
    showPhotoPreview(photo, blob);
    toast('Photo captured', 'ok');
  } catch (e) { toast('Capture failed: ' + e.message, 'error'); }
  finally { btn.disabled = false; }
}

function showPhotoPreview(photo, blob) {
  const sheet = $('#photoSheet');
  const img = $('#photoSheetImg');
  const url = URL.createObjectURL(blob);
  img.src = url;
  sheet.classList.add('active');
  $('#saveToGalleryBtn').onclick = async () => {
    const r = await savePhotoToDevice(blob, `anglelab_${photo.id}.jpg`);
    if (r.ok) toast('Saved to device', 'ok');
    else if (r.cancelled) toast('Cancelled', 'info');
    else toast('Could not save automatically. Long-press the image to save.', 'warn');
  };
  const annBtn = $('#saveAnnotatedBtn');
  if (photo.annotatedBlob) {
    annBtn.style.display = '';
    annBtn.onclick = async () => {
      const r = await savePhotoToDevice(photo.annotatedBlob, `anglelab_${photo.id}_annotated.jpg`);
      if (r.ok) toast('Saved annotated photo', 'ok');
      else if (r.cancelled) toast('Cancelled', 'info');
      else toast('Could not save. Long-press to save.', 'warn');
    };
  } else annBtn.style.display = 'none';
  $('#closePhotoSheet').onclick = () => { sheet.classList.remove('active'); URL.revokeObjectURL(url); };
}

async function renderSessions() {
  const list = $('#sessionsList'); if (!list) return;
  state.sessions = await DB.listSessions();
  list.innerHTML = '';
  for (const s of state.sessions) {
    const el = document.createElement('div');
    el.className = 'list-item' + (state.currentSession?.id === s.id ? ' current' : '');
    el.innerHTML = `
      <div><div class="list-title">${escapeHtml(s.name)}</div>
        <div class="list-sub">${new Date(s.createdAt).toLocaleString()}</div></div>
      <div class="list-actions">
        <button data-act="select" class="btn-sm">${state.currentSession?.id === s.id ? 'Current' : 'Select'}</button>
        <button data-act="rename" class="btn-sm">Rename</button>
        <button data-act="delete" class="btn-sm danger">Delete</button>
      </div>`;
    el.querySelector('[data-act="select"]').onclick = async () => {
      state.currentSession = s; await DB.setSetting('currentSessionId', s.id);
      updateSessionBadge(); await renderSessions(); toast('Session: ' + s.name, 'ok');
    };
    el.querySelector('[data-act="rename"]').onclick = async () => {
      const name = prompt('Rename session:', s.name);
      if (name && name.trim()) {
        await DB.renameSession(s.id, name.trim());
        if (state.currentSession?.id === s.id) { state.currentSession.name = name.trim(); updateSessionBadge(); }
        await renderSessions(); toast('Renamed', 'ok');
      }
    };
    el.querySelector('[data-act="delete"]').onclick = async () => {
      if (!confirm(`Delete "${s.name}" and all its photos?`)) return;
      await DB.deleteSession(s.id);
      state.sessions = await DB.listSessions();
      if (state.currentSession?.id === s.id) {
        state.currentSession = state.sessions[0] || null;
        if (state.currentSession) await DB.setSetting('currentSessionId', state.currentSession.id);
        updateSessionBadge();
      }
      await renderSessions(); toast('Deleted', 'ok');
    };
    list.appendChild(el);
  }
}

async function renderGallery() {
  const grid = $('#galleryGrid'); if (!grid) return;
  if (!state.currentSession) { grid.innerHTML = '<p class="empty">No session selected.</p>'; return; }
  state.photos = await DB.listPhotos(state.currentSession.id);
  grid.innerHTML = '';
  if (state.photos.length === 0) { grid.innerHTML = '<p class="empty">No photos in this session.</p>'; return; }
  for (const p of state.photos) {
    const el = document.createElement('div');
    el.className = 'photo-card';
    const url = URL.createObjectURL(p.blob);
    el.innerHTML = `
      <div class="photo-thumb" style="background-image:url('${url}')"></div>
      <div class="photo-meta">
        <div class="photo-time">${new Date(p.timestamp).toLocaleString()}</div>
        <div class="photo-readout">Y ${fmt(p.yaw)}° · P ${fmt(p.pitch)}° · R ${fmt(p.roll)}°</div>
      </div>
      <div class="photo-actions">
        <button data-act="save" class="btn-sm">Save</button>
        <button data-act="delete" class="btn-sm danger">Delete</button>
      </div>`;
    el.querySelector('[data-act="save"]').onclick = async e => {
      e.stopPropagation();
      const r = await savePhotoToDevice(p.blob, `anglelab_${p.id}.jpg`);
      if (r.ok) toast('Saved to device', 'ok');
      else if (r.cancelled) toast('Cancelled', 'info');
      else toast('Save failed', 'error');
    };
    el.querySelector('[data-act="delete"]').onclick = async e => {
      e.stopPropagation();
      if (!confirm('Delete this photo?')) return;
      await DB.deletePhoto(p.id); URL.revokeObjectURL(url); await renderGallery();
    };
    el.querySelector('.photo-thumb').onclick = () => showPhotoPreview(p, p.blob);
    grid.appendChild(el);
  }
}

async function doExport(kind) {
  if (!state.currentSession) return toast('No session', 'error');
  try {
    const sid = state.currentSession.id;
    let blob, name;
    if (kind === 'json') { blob = await exportSessionJSON(sid); name = `${sid}.json`; }
    else if (kind === 'csv') { blob = await exportSessionCSV(sid); name = `${sid}.csv`; }
    else { blob = await exportSessionZIP(sid); name = `${sid}.zip`; }
    const r = await savePhotoToDevice(blob, name);
    if (r.ok) toast(`Exported ${kind.toUpperCase()}`, 'ok');
    else toast('Export cancelled/failed', 'warn');
  } catch (e) { toast('Export failed: ' + e.message, 'error'); }
}

function renderDiagnostics() {
  const el = $('#diagContent'); if (!el) return;
  const r = state.lastReading;
  const s = {
    doe: typeof DeviceOrientationEvent !== 'undefined',
    dme: typeof DeviceMotionEvent !== 'undefined',
    reqPerm: typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function',
    gum: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    share: !!navigator.share,
    shareFiles: !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob()], 'x.jpg', { type: 'image/jpeg' })] })),
    sw: 'serviceWorker' in navigator,
    idb: 'indexedDB' in window,
    standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  };
  const rows = [
    ['DeviceOrientation API', s.doe], ['DeviceMotion API', s.dme],
    ['iOS requestPermission()', s.reqPerm], ['getUserMedia', s.gum],
    ['Web Share API', s.share], ['Web Share with files', s.shareFiles],
    ['Service Worker', s.sw], ['IndexedDB', s.idb], ['Standalone (installed)', s.standalone]
  ];
  el.innerHTML = `
    <table class="diag-table">${rows.map(([k,v]) => `<tr><td>${k}</td><td>${v?'✅ supported':'❌ not available'}</td></tr>`).join('')}</table>
    <h3>Live sensor reading</h3>
    <pre>${r ? JSON.stringify({
      alpha: r.raw.alpha, beta: r.raw.beta, gamma: r.raw.gamma,
      absolute: r.hasAbsolute, sensorSource: r.sensorSource,
      quaternion: r.quaternion, relative: r.relative,
      referenceSet: !!state.orientation?.reference
    }, null, 2) : 'No reading yet. Enable sensors on the Camera tab.'}</pre>
    <h3>Notes</h3>
    <ul class="notes">
      <li><b>α / Yaw</b> is true magnetic heading only if <code>absolute === true</code>. Otherwise it is relative.</li>
      <li><b>β / Pitch</b> and <b>γ / Roll</b> follow the W3C DeviceOrientation convention (intrinsic Z-X'-Y'').</li>
      <li>Relative values use <code>q_rel = q_cur ⊗ conj(q_ref)</code> and are extracted as Z-X'-Y''.</li>
      <li>Browsers report <code>sensor_accuracy: "unknown"</code>. Do not treat readings as survey-grade.</li>
      <li>Always store the raw quaternion. It is the unambiguous representation.</li>
    </ul>`;
}

function renderInstall() {
  const el = $('#installContent'); if (!el) return;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let html = '';
  if (standalone) html += `<p class="ok">✅ You are running AngleLab as an installed app.</p>`;
  else if (isIOS) html += `
    <h3>Install on iPhone / iPad (Safari)</h3>
    <ol class="steps">
      <li>Open this page in <b>Safari</b> (Chrome on iOS cannot install PWAs).</li>
      <li>Tap the <b>Share</b> button (square with arrow up).</li>
      <li>Scroll and tap <b>Add to Home Screen</b>.</li>
      <li>Tap <b>Add</b>.</li>
    </ol>`;
  else html += `
    <h3>Install on Android (Chrome)</h3>
    <ol class="steps">
      <li>Open this page in <b>Chrome</b>.</li>
      <li>Tap the <b>⋮ menu</b> → <b>Install app</b> or <b>Add to Home screen</b>.</li>
      <li>Confirm.</li>
    </ol>`;
  if (state.installPrompt) html += `<button id="doInstallBtn" class="btn primary big">Install Now</button>`;
  html += `
    <h3>Why install?</h3>
    <ul class="notes">
      <li>Full-screen standalone mode.</li>
      <li>App icon on your home screen.</li>
      <li>Works offline after the first load.</li>
      <li>No App Store / Play Store required.</li>
    </ul>`;
  el.innerHTML = html;
  const b = document.getElementById('doInstallBtn');
  if (b && state.installPrompt) b.onclick = async () => {
    state.installPrompt.prompt();
    const choice = await state.installPrompt.userChoice;
    if (choice.outcome === 'accepted') toast('Installing…', 'ok');
    state.installPrompt = null; renderInstall();
  };
}

async function init() {
  $$('.tab').forEach(t => t.onclick = () => showScreen(t.dataset.target));
  await ensureSession();

  $('#startCameraBtn').onclick = initCamera;
  $('#startSensorsBtn').onclick = async () => { try { await initOrientation(); if (state.sensorAvailable) toast('Sensors started', 'ok'); } catch (e) { toast(e.message, 'error'); } };
  $('#setReferenceBtn').onclick = () => {
    if (!state.orientation) return toast('Start sensors first', 'warn');
    state.orientation.setReference(); toast('Reference set', 'ok');
  };
  $('#clearReferenceBtn').onclick = () => {
    if (!state.orientation) return;
    state.orientation.clearReference(); toast('Reference cleared', 'ok');
  };
  $('#captureBtn').onclick = capturePhoto;
  $('#switchCamBtn').onclick = () => switchCamera(state.camera?.currentFacing === 'environment' ? 'user' : 'environment');
  $('#newSessionBtn').onclick = async () => {
    const name = prompt('New session name:', `Session ${(await DB.listSessions()).length + 1}`);
    if (!name || !name.trim()) return;
    const s = await DB.createSession(name.trim());
    state.currentSession = s;
    await DB.setSetting('currentSessionId', s.id);
    updateSessionBadge(); await renderSessions(); toast('Session created', 'ok');
  };
  $('#autoAnnotateToggle').onchange = e => {
    state.autoAnnotate = e.target.checked;
    DB.setSetting('autoAnnotate', state.autoAnnotate);
  };
  const savedAuto = await DB.getSetting('autoAnnotate');
  if (savedAuto != null) { state.autoAnnotate = savedAuto; $('#autoAnnotateToggle').checked = savedAuto; }

  $('#exportJsonBtn').onclick = () => doExport('json');
  $('#exportCsvBtn').onclick = () => doExport('csv');
  $('#exportZipBtn').onclick = () => doExport('zip');

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.installPrompt = e;
    renderInstall();
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null; toast('App installed', 'ok'); renderInstall();
  });

  showScreen('camera');

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('SW reg failed', e); }
  }
}
init();