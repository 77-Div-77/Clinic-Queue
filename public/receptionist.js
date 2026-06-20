// ============================================================
//  RECEPTIONIST DASHBOARD v3 — Client JS (Light Theme)
// ============================================================
let clinicId = null;
let clinicName = 'ClinicQueue';
const socket = io({ autoConnect: false });

fetch('/api/me').then(r => r.json()).then(data => {
  if (data.loggedIn && data.clinic) {
    clinicId = data.clinic.id;
    clinicName = data.clinic.name;
    document.title = clinicName + ' - Dashboard';
    socket.connect();
    socket.emit('join_clinic', { clinicId });
  } else {
    document.cookie = "rcp_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    window.location.href = '/?signin=1';
  }
});

let pendingAddAndCall = false;
let undoTimer = null;
let consultTimerInterval = null;
let currentState = null;
let timeOffset = 0;
let avgDebounce = null;
let searchFilter = '';
let currentHistoryDate = new Date().toISOString().split('T')[0]; // today
let sortableInstance = null;
let phoneInputIti = null;

// ── VOICE ALERTS ─────────────────────────────────────────────
let soundEnabled = true;
let previousVoiceToken = null;

// ── SIDEBAR TOGGLE & SETUP ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('sidebar-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      document.querySelector('.sidebar')?.classList.toggle('collapsed');
      document.querySelector('.main-wrap')?.classList.toggle('collapsed');
    });
  }
  
  // Initialize intl-tel-input
  const phoneEl = document.getElementById('input-phone');
  if (phoneEl && window.intlTelInput) {
    phoneInputIti = window.intlTelInput(phoneEl, {
      initialCountry: 'auto',
      geoIpLookup: callback => {
        fetch('https://ipapi.co/json').then(res => res.json()).then(data => callback(data.country_code)).catch(() => callback('in'));
      },
      separateDialCode: true,
      utilsScript: 'https://cdn.jsdelivr.net/npm/intl-tel-input@23.0.4/build/js/utils.js'
    });
  }
});

// Navigation is now handled by standard HTML links in the sidebar

// ── CONNECTION ───────────────────────────────────────────────
const sfDot  = document.getElementById('sf-dot');
const sfText = document.getElementById('sf-text');
socket.on('connect', () => {
  sfDot.className = 'sf-dot online'; sfText.textContent = 'Connected';
});
socket.on('disconnect', () => {
  sfDot.className = 'sf-dot offline'; sfText.textContent = 'Disconnected';
});
socket.on('connect_error', () => {
  sfDot.className = 'sf-dot'; sfText.textContent = 'Reconnecting…';
});

// ── MAIN STATE ───────────────────────────────────────────────
socket.on('queue_update', (data) => {
  if (data.serverTime) timeOffset = data.serverTime - Date.now();
  
  if (previousVoiceToken !== data.currentToken && data.currentToken > 0) {
    if (soundEnabled && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(`Token number ${data.currentToken}, please proceed.`);
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    }
    previousVoiceToken = data.currentToken;
  }
  
  currentState = data;
  renderAll(data);
  if (pendingAddAndCall) { pendingAddAndCall = false; socket.emit('call_next'); }
  // Render today's done history on every update
  if (data.done) {
    renderDoneList(data.done, true);
  }
});
socket.on('error_event', (data) => showToast(data.message, 'error'));
socket.on('patient_added', (data) => {
  const el = document.getElementById('token-confirm');
  el.textContent = `✅ Token #${data.token} assigned to ${data.name}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
  showToast(`Token #${data.token} — ${data.name}`, 'success');
  document.getElementById('input-name').focus();
});

socket.on('mock_sms_sent', (data) => {
  showToast(`💬 SMS Sent to ${data.phone}: "${data.message}"`, 'success');
});

socket.on('wait_time_tick', (times) => {
  if (!currentState || !currentState.queue) return;
  const localMode = document.getElementById('preview-auto').checked ? 'auto' : 'manual';
  
  times.forEach(t => {
    const p = currentState.queue.find(q => q.token === t.token);
    if (p) {
      p.estWaitMinAuto = t.estWaitMinAuto;
      p.estWaitMinManual = t.estWaitMinManual;
      p.isNext = t.isNext;
      
      const row = document.querySelector(`tr[data-token="${p.token}"]`);
      if (row) {
        const chip = row.querySelector('.wait-chip');
        if (chip) {
          const estWait = localMode === 'auto' ? t.estWaitMinAuto : t.estWaitMinManual;
          let waitLabel = `~${Math.max(0, estWait)} min`;
          let waitCls = estWait <= 10 ? 'short' : 'long';
          if (t.isNext) { waitLabel = 'Next'; waitCls = 'short next'; }
          
          if (p.status === 'waiting-emergency') waitCls = 'emergency';
          else if (p.status === 'quick-consult') waitCls = 'quick-consult';
          else if (p.status === 'on-hold') waitCls = 'on-hold';
          
          if (chip.textContent !== waitLabel) {
            chip.textContent = waitLabel;
            chip.className = `wait-chip ${waitCls}`;
          }
        }
      }
    }
  });
});

// ── RENDER ───────────────────────────────────────────────────
function renderAll(data) {
  renderKPIs(data);
  renderToken(data);
  renderCallButton(data);
  renderInConsult(data);
  renderQueue(data);
  renderSettings(data);
  renderUndo(data);
}

function renderKPIs(data) {
  animNum('kpi-waiting', data.waitingCount);
  animNum('kpi-served',  data.totalServed);
  animNum('kpi-avg',     data.effectiveAvgMinutes);
  animNum('kpi-samples', data.sampleCount);
  const badge = document.getElementById('kpi-data-badge');
  badge.textContent = data.sampleCount >= 2 ? '● Real Data' : 'Manual';
  badge.className = 'kpi-badge' + (data.sampleCount >= 2 ? ' real' : '');
}

function animNum(id, val) {
  const el = document.getElementById(id);
  const displayVal = (val === undefined || val === null) ? '—' : String(val);
  if (!el || el.textContent === displayVal) return;
  el.textContent = displayVal;
  el.classList.remove('num-pop'); void el.offsetWidth; el.classList.add('num-pop');
}

function renderToken(data) {
  const el = document.getElementById('token-display');
  const nameEl = document.getElementById('token-patient-name');
  const timerEl = document.getElementById('token-timer');
  const progressWrap = document.getElementById('token-progress-wrap');

  const newVal = data.currentToken > 0 ? String(data.currentToken) : '—';
  if (el.textContent !== newVal) {
    el.textContent = newVal;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  if (data.inConsultation?.length > 0) {
    const p = data.inConsultation[0];
    nameEl.textContent = p.name + (p.phone ? ` · ${p.phone}` : '');
    if (p.isEmergency) nameEl.innerHTML += ` <span style="color:var(--red)">[Emergency]</span>`;
    progressWrap.style.display = 'block';
    startConsultTimer(p);
  } else {
    nameEl.textContent = 'No patient in consultation';
    timerEl.textContent = '';
    progressWrap.style.display = 'none';
    clearInterval(consultTimerInterval);
  }
}

function startConsultTimer(patient) {
  clearInterval(consultTimerInterval);
  const startTime = new Date(patient.consultStartTime).getTime();
  if (!startTime && !patient.liveElapsedMs) return;

  const avgMs = patient.allottedMs || 600000;
  const timerEl = document.getElementById('token-timer');
  const bar = document.getElementById('token-progress-bar');

  consultTimerInterval = setInterval(() => {
    const adjustedNow = Date.now() + timeOffset;
    let elapsed = patient.elapsedMs || 0;
    if (patient.consultStartTime) {
        elapsed += (adjustedNow - new Date(patient.consultStartTime).getTime());
    }

    const remaining = avgMs - elapsed;
    const pct = Math.min(100, (elapsed / avgMs) * 100);
    bar.style.width = pct + '%';

    if (remaining > 0) {
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = `⏱ ${m}:${String(s).padStart(2,'0')} remaining`;
    } else {
      const over = Math.abs(remaining);
      const m = Math.floor(over / 60000);
      const s = Math.floor((over % 60000) / 1000);
      timerEl.textContent = `⚠ Overrun ${m}:${String(s).padStart(2,'0')}`;
    }
  }, 1000);
}

function renderCallButton(data) {
  const btn = document.getElementById('btn-call-next');
  const sub = document.getElementById('bcn-sub');
  btn.disabled = !data.nextToken;
  sub.textContent = data.nextToken ? `→ Token #${data.nextToken} will be called` : 'No patients waiting';
}

function renderInConsult(data) {
  const banner = document.getElementById('in-consult-banner');
  const nameEl = document.getElementById('icb-name');
  const doneBtn = document.getElementById('icb-done-btn');
  if (data.inConsultation?.length > 0) {
    const p = data.inConsultation[0];
    banner.classList.remove('hidden');
    nameEl.textContent = `Token #${p.token} — ${p.name}`;
    doneBtn.onclick = () => markDone(p.token);
  } else {
    banner.classList.add('hidden');
  }
}

function renderQueue(data) {
  const tbody = document.getElementById('queue-tbody');
  const sub   = document.getElementById('queue-sub');
  const empty = document.getElementById('queue-empty');
  
  const histCount = document.getElementById('snav-done-count');
  if(histCount) histCount.textContent = data.done?.length || 0;

  sub.textContent = `${data.waitingCount} patient${data.waitingCount !== 1 ? 's' : ''} waiting`;

  if (!data.queue.length) {
    tbody.innerHTML = '';
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');

  tbody.innerHTML = data.queue.map((p, idx) => {
    const localMode = document.getElementById('preview-auto').checked ? 'auto' : 'manual';
    const estWait = localMode === 'auto' ? p.estWaitMinAuto : p.estWaitMinManual;
    
    const isEmergency = p.status === 'waiting-emergency';
    const isQuick = p.status === 'quick-consult';
    const isOnHold = p.status === 'on-hold';
    
    let waitLabel = `~${Math.max(0, estWait)} min`;
    let waitCls = estWait <= 10 ? 'short' : 'long';
    let badgeCls = '';
    let nameTag = '';
    
    if (p.isNext) {
      waitLabel = 'Next';
      waitCls = 'short next';
    }

    if (isEmergency) {
        waitCls = 'emergency'; badgeCls = 'emergency';
        nameTag = ' <span style="color:var(--red); font-size:10px; font-weight:700; text-transform:uppercase;">[Emergency]</span>';
    } else if (isQuick) {
        waitCls = 'quick-consult'; badgeCls = 'quick-consult';
        nameTag = ' <span style="color:#0284c7; font-size:10px; font-weight:700; text-transform:uppercase;">[Quick Consult]</span>';
    } else if (isOnHold) {
        waitCls = 'on-hold'; badgeCls = 'on-hold';
        nameTag = ' <span style="color:var(--amber); font-size:10px; font-weight:700; text-transform:uppercase;">[On Hold]</span>';
    } else if (p.isNext) {
        waitCls = 'next'; badgeCls = 'next';
    }

    const filtered = searchFilter && !p.name.toLowerCase().includes(searchFilter) ? 'filtered' : '';
    return `
      <tr data-token="${p.token}" class="${filtered}">
        <td><div class="drag-handle">☰</div></td>
        <td><span class="pos-num">${idx + 1}</span></td>
        <td><div class="tkn-badge ${badgeCls}">${p.token}</div></td>
        <td>
          <div class="pt-name">${escHtml(p.name)}${nameTag}</div>
          ${p.phone ? `<div class="pt-phone">📞 ${escHtml(p.phone)}</div>` : ''}
        </td>
        <td><span style="font-weight:700">${p.meetingsToday || 1}</span></td>
        <td><span class="time-txt">${formatTime(p.checkInTime)}</span></td>
        <td><span class="wait-chip ${waitCls}">${waitLabel}</span></td>
        <td style="text-align:right;">
          <button class="btn-swap" onclick="swapConsultation(${p.token})" title="Swap with active consultation">Swap</button>
          <button class="btn-remove" onclick="removePatient(${p.token})">✕</button>
        </td>
      </tr>`;
  }).join('');
  
  if (!sortableInstance) {
    sortableInstance = new Sortable(tbody, {
      handle: '.drag-handle',
      animation: 150,
      onEnd: function() {
        const rows = Array.from(tbody.querySelectorAll('tr[data-token]'));
        const orderedTokens = rows.map(r => parseInt(r.dataset.token, 10));
        socket.emit('reorder_queue', { orderedTokens });
      }
    });
  }
}

function loadHistoryDate(dateStr) {
  currentHistoryDate = dateStr;
  socket.emit('get_history', { date: dateStr }, (res) => {
    renderDoneList(res.done, dateStr === new Date().toISOString().split('T')[0]);
  });
}

let historyLimit = 10;
function updateHistoryLimit() {
  const val = document.getElementById('history-filter').value;
  historyLimit = val === 'all' ? Infinity : parseInt(val, 10);
  if (currentState && currentState.done) renderDoneList(currentState.done, currentHistoryDate === new Date().toISOString().split('T')[0]);
}

function renderDoneList(doneArray, isToday) {
  const list = document.getElementById('done-list');
  if (!doneArray?.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px">No completions found.</div>';
    return;
  }
  
  // Make a shallow copy and reverse for UI
  const displayArray = [...doneArray];
  if (isToday && currentState?.done === doneArray) displayArray.reverse();

  const limitedArray = displayArray.slice(0, historyLimit);

  list.innerHTML = limitedArray.map(p => {
    // Determine exact elapsed time
    const elapsed = p.elapsedMs || 0;
    const durStr = elapsed > 0 ? formatExactTime(elapsed) + ' · ' : '';
    const btnHtml = isToday ? `<button class="btn-call-again" onclick="quickConsult(${p.token})">🔄 Call Again</button>` : '';

    return `<div class="done-row">
      <span class="done-tkn">#${p.token}</span>
      <div class="done-name">${escHtml(p.name)} <div class="done-meta">${durStr}${formatTime(p.consultEndTime)}</div></div>
      ${btnHtml}
    </div>`;
  }).join('');
}

// Patients rendering moved to standalone patients.js

let isSettingsDirty = false;

function getAutoMs(arr, manualMin, fallbackMin) {
  if (arr && arr.length >= 2) {
    const recent = arr.slice(-10);
    const sum = recent.reduce((a, b) => a + b, 0);
    return sum / recent.length;
  }
  return (manualMin || fallbackMin) * 60000;
}

function renderSettings(data) {
  if (!data.waitSettings || isSettingsDirty) return;
  const settings = data.waitSettings;
  
  const inNormal = document.getElementById('wt-normal');
  const inEmerg = document.getElementById('wt-emergency');
  const inQuick = document.getElementById('wt-quick');
  
  // Only update inputs if user isn't actively typing
  if (document.activeElement !== inNormal && document.activeElement !== inEmerg && document.activeElement !== inQuick) {
    inNormal.value = settings.manualTimes.normal || 10;
    inEmerg.value = settings.manualTimes.emergency || 10;
    inQuick.value = settings.manualTimes.quick || 4;
  }
  
  // Calculate and display Auto times (exact match to server logic)
  const autoNormalMs = getAutoMs(settings.durations.normal, settings.manualTimes.normal, 10);
  const autoEmergMs = getAutoMs(settings.durations.emergency, settings.manualTimes.emergency, 10);
  const autoQuickMs = getAutoMs(settings.durations.quick, settings.manualTimes.quick, 2);

  const autoNormal = Math.round(autoNormalMs / 60000);
  const autoEmerg = Math.round(autoEmergMs / 60000);
  const autoQuick = Math.round(autoQuickMs / 60000);

  document.getElementById('wt-auto-normal').textContent = `Auto: ${autoNormal} min`;
  document.getElementById('wt-auto-emergency').textContent = `Auto: ${autoEmerg} min`;
  document.getElementById('wt-auto-quick').textContent = `Auto: ${autoQuick} min`;
  
  // Manage Apply button visibility
  const localMode = document.getElementById('preview-auto').checked ? 'auto' : 'manual';
  const applyBtn = document.getElementById('btn-apply-mode');
  if (localMode !== settings.mode) {
    applyBtn.style.display = 'inline-block';
  } else {
    applyBtn.style.display = 'none';
  }
}

function onSettingsInput() {
  isSettingsDirty = true;
  document.getElementById('btn-save-wt').style.display = 'inline-block';
}

function renderUndo(data) {
  const btn = document.getElementById('btn-undo');
  if (data.canUndo) {
    btn.classList.remove('hidden');
    clearInterval(undoTimer);
    let rem = 30;
    const cd = document.getElementById('undo-countdown');
    undoTimer = setInterval(() => { rem--; cd.textContent = `(${rem}s)`; if (rem <= 0) { clearInterval(undoTimer); btn.classList.add('hidden'); }}, 1000);
  } else { btn.classList.add('hidden'); clearInterval(undoTimer); }
}

// ── ACTIONS ──────────────────────────────────────────────────
function getValidatedPhone() {
  const raw = document.getElementById('input-phone').value.trim();
  if (!raw) return '';
  if (phoneInputIti && !phoneInputIti.isValidNumber()) {
    showToast('Please enter a valid phone number', 'error');
    return null;
  }
  return phoneInputIti ? phoneInputIti.getNumber() : raw;
}

function addPatient(e) {
  e.preventDefault();
  const name = document.getElementById('input-name').value.trim();
  if (!name) { showToast('Patient name is required', 'error'); return; }
  const phone = getValidatedPhone();
  if (phone === null) return;
  
  socket.emit('add_patient', { name, phone });
  document.getElementById('add-patient-form').reset();
}

function addEmergency() {
  const name = document.getElementById('input-name').value.trim();
  if (!name) { showToast('Patient name is required', 'error'); return; }
  const phone = getValidatedPhone();
  if (phone === null) return;
  
  socket.emit('add_emergency', { name, phone });
  document.getElementById('add-patient-form').reset();
}

function addQuickConsult() {
  const name = document.getElementById('input-name').value.trim();
  if (!name) { showToast('Patient name is required', 'error'); return; }
  const phone = getValidatedPhone();
  if (phone === null) return;
  
  socket.emit('add_quick_consult', { name, phone });
  document.getElementById('add-patient-form').reset();
}
function quickConsult(token)    { socket.emit('quick_consult', { token }); }
function callNext()             { socket.emit('call_next'); }
function undoCall()             { socket.emit('undo_call'); clearInterval(undoTimer); document.getElementById('btn-undo').classList.add('hidden'); showToast('Last call undone', 'info'); }
function markDone(token)        { socket.emit('mark_done', { token }); }
function removePatient(token)   { 
  if (confirm(`Are you sure you want to remove token #${token} from the queue?`)) {
    socket.emit('remove_patient', { token }); 
  }
}
function swapConsultation(token){ 
  if (confirm(`Are you sure you want to swap the current consultation with token #${token}?`)) {
    socket.emit('swap_consultation', { token }); 
    showToast('Swapped consultation', 'info'); 
  }
}

function filterQueue(val) {
  searchFilter = val.toLowerCase();
  document.querySelectorAll('#queue-tbody tr').forEach(row => {
    const name  = row.querySelector('.pt-name')?.textContent.toLowerCase() || '';
    const token = row.dataset.token || '';
    row.classList.toggle('filtered', !!(searchFilter && !name.includes(searchFilter) && !token.includes(searchFilter)));
  });
}

function updateLocalPreview() {
  isSettingsDirty = false;
  if (currentState) {
    renderSettings(currentState);
    renderQueue(currentState);
  }
}

function saveManualTimes() {
  const normal = parseFloat(document.getElementById('wt-normal').value) || 10;
  const emergency = parseFloat(document.getElementById('wt-emergency').value) || 10;
  const quick = parseFloat(document.getElementById('wt-quick').value) || 4;
  
  socket.emit('save_manual_times', {
    manualTimes: { normal, emergency, quick }
  });
  isSettingsDirty = false;
  document.getElementById('btn-save-wt').style.display = 'none';
  showToast('Manual settings saved', 'success');
}

function applyGlobalMode() {
  const mode = document.getElementById('preview-auto').checked ? 'auto' : 'manual';
  socket.emit('set_global_wait_mode', { mode });
  document.getElementById('btn-apply-mode').style.display = 'none';
  showToast(`Wait mode updated to ${mode.toUpperCase()} globally`, 'success');
}

// ── CLOCK ────────────────────────────────────────────────────
function updateClock() {
  const d = new Date();
  document.getElementById('sf-time').textContent = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
  document.getElementById('topbar-date').textContent = d.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long' });
}
setInterval(updateClock, 1000); updateClock();

// ── TOAST ────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast--${type}`; t.textContent = msg; c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── HELPERS ──────────────────────────────────────────────────
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatTime(iso) { if (!iso) return '—'; const d = new Date(iso); return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2,'0')).join(':'); }
function formatExactTime(ms) { 
  const m = Math.floor(ms / 60000); 
  const s = Math.floor((ms % 60000) / 1000); 
  return `${m}m ${s}s`; 
}
document.getElementById('input-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('add-patient-form').requestSubmit(); }});

// ── MOBILE SIDEBAR ───────────────────────────────────────────
const sidebar = document.querySelector('.sidebar');
const backdrop = document.getElementById('sidebar-backdrop');
const toggleBtn = document.getElementById('sidebar-toggle');

if(toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    sidebar.classList.add('mobile-open');
    if (backdrop) backdrop.classList.add('show');
  });
}
if(backdrop) {
  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('mobile-open');
    backdrop.classList.remove('show');
  });
}

const btnSound = document.getElementById('toggle-sound');
if (btnSound) {
  btnSound.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    btnSound.innerHTML = soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
  });
}

function showQRModal() {
  const qrUrl = window.location.origin + '/patient.html?clinicId=' + clinicId;
  document.getElementById('qr-img').src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrUrl)}`;
  const cidEl = document.getElementById('qr-clinic-id');
  if (cidEl) cidEl.textContent = 'Clinic ID: ' + clinicId;
  const qrLinkEl = document.getElementById('qr-link');
  if (qrLinkEl) qrLinkEl.href = qrUrl;
  document.getElementById('qr-modal').classList.remove('hidden');
}
