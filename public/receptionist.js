// ============================================================
//  RECEPTIONIST DASHBOARD — Client JavaScript
//  Handles Socket.IO events, UI updates, form logic
// ============================================================

const socket = io();
let pendingAddAndCall = false;
let undoTimer = null;
let consultTimerInterval = null;
let lastConsultStart = null;
let currentState = null;

// ── Connection status ────────────────────────────────────────
const connBadge = document.getElementById('connection-status');

socket.on('connect', () => {
  connBadge.className = 'conn-badge conn-online';
  connBadge.innerHTML = '<span class="conn-dot"></span><span class="conn-label">Live</span>';
});

socket.on('disconnect', () => {
  connBadge.className = 'conn-badge conn-offline';
  connBadge.innerHTML = '<span class="conn-dot"></span><span class="conn-label">Disconnected</span>';
});

socket.on('connect_error', () => {
  connBadge.className = 'conn-badge conn-offline';
  connBadge.innerHTML = '<span class="conn-dot"></span><span class="conn-label">Reconnecting…</span>';
});

// ── Main state update handler ────────────────────────────────
socket.on('queue_update', (data) => {
  currentState = data;
  renderAll(data);
  if (pendingAddAndCall) {
    pendingAddAndCall = false;
    callNext();
  }
});

// ── Server error ─────────────────────────────────────────────
socket.on('error_event', (data) => {
  showToast(data.message, 'error');
});

// ── Patient added ack ─────────────────────────────────────────
socket.on('patient_added', (data) => {
  const banner = document.getElementById('last-added-banner');
  banner.textContent = `✅ Token #${data.token} assigned to ${data.name}`;
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), 4000);
  showToast(`Token #${data.token} — ${data.name} added`, 'success');

  // Re-focus name input for speed
  document.getElementById('input-name').focus();
});

// ── RENDER ALL ───────────────────────────────────────────────
function renderAll(data) {
  renderStats(data);
  renderCurrentToken(data);
  renderCallButton(data);
  renderQueue(data);
  renderDone(data);
  renderAvgSource(data);
  renderUndoButton(data);
}

function renderStats(data) {
  animateNumber('stat-waiting', data.waitingCount);
  animateNumber('stat-served', data.totalServed);
  animateNumber('stat-avg-real', data.effectiveAvgMinutes);
  animateNumber('stat-samples', data.sampleCount);
}

function animateNumber(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.textContent !== String(val)) {
    el.textContent = val;
    el.classList.remove('num-change');
    void el.offsetWidth; // reflow
    el.classList.add('num-change');
  }
}

function renderCurrentToken(data) {
  const numEl = document.getElementById('current-token-display');
  const nameEl = document.getElementById('current-token-name');

  const prevToken = numEl.textContent;
  const newToken = data.currentToken > 0 ? String(data.currentToken) : '—';

  if (prevToken !== newToken) {
    numEl.textContent = newToken;
    numEl.classList.remove('flash');
    void numEl.offsetWidth;
    numEl.classList.add('flash');
  }

  if (data.inConsultation && data.inConsultation.length > 0) {
    const p = data.inConsultation[0];
    nameEl.textContent = p.name + (p.phone ? ` · ${p.phone}` : '');
    lastConsultStart = data.consultStartTime;
    startConsultTimer(data.consultStartTime, data.avgConsultMinutes);
  } else {
    nameEl.textContent = 'No patient in consultation';
    stopConsultTimer();
  }
}

function startConsultTimer(startTime, avgMin) {
  stopConsultTimer();
  if (!startTime) return;
  const avgMs = avgMin * 60000;

  consultTimerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = avgMs - elapsed;
    const timerEl = document.getElementById('consult-timer');

    if (remaining > 0) {
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = `⏱ ${m}:${String(s).padStart(2, '0')} remaining in consultation`;
      timerEl.style.color = remaining < 60000 ? '#f87171' : 'var(--accent-teal)';
    } else {
      const overrun = Math.abs(remaining);
      const m = Math.floor(overrun / 60000);
      const s = Math.floor((overrun % 60000) / 1000);
      timerEl.textContent = `⚠ Overrun by ${m}:${String(s).padStart(2, '0')}`;
      timerEl.style.color = '#f97316';
    }
  }, 1000);
}

function stopConsultTimer() {
  clearInterval(consultTimerInterval);
  document.getElementById('consult-timer').textContent = '';
}

function renderCallButton(data) {
  const btn = document.getElementById('btn-call-next');
  const preview = document.getElementById('next-token-preview');

  if (data.nextToken) {
    btn.disabled = false;
    preview.textContent = `→ Token #${data.nextToken}`;
  } else {
    btn.disabled = true;
    preview.textContent = '';
  }
}

function renderUndoButton(data) {
  const btn = document.getElementById('btn-undo');
  if (data.canUndo) {
    btn.classList.remove('hidden');
    // Live countdown
    clearInterval(undoTimer);
    let remaining = 30;
    const countEl = document.getElementById('undo-countdown');
    undoTimer = setInterval(() => {
      remaining--;
      countEl.textContent = `(${remaining}s)`;
      if (remaining <= 0) {
        clearInterval(undoTimer);
        btn.classList.add('hidden');
      }
    }, 1000);
  } else {
    btn.classList.add('hidden');
    clearInterval(undoTimer);
  }
}

function renderAvgSource(data) {
  const note = document.getElementById('avg-source-note');
  const avgInput = document.getElementById('avg-input');
  const slider = document.getElementById('avg-slider');

  // Update controls only if user isn't actively editing
  if (document.activeElement !== avgInput) {
    avgInput.value = data.avgConsultMinutes;
    slider.value = Math.min(data.avgConsultMinutes, 60);
    updateSliderFill(data.avgConsultMinutes);
  }

  if (data.sampleCount >= 2) {
    note.innerHTML = `📊 <strong>Real data active:</strong> Using rolling average of ${data.sampleCount} actual consultations (${data.effectiveAvgMinutes} min avg).`;
    note.style.color = '#4ade80';
  } else {
    note.textContent = `Using manually set value — real data will override once ${2 - data.sampleCount} more consultation(s) complete.`;
    note.style.color = '';
  }
}

function renderQueue(data) {
  const tbody = document.getElementById('queue-tbody');
  const meta = document.getElementById('queue-meta');
  const inConsultSection = document.getElementById('in-consult-section');
  const inConsultRow = document.getElementById('in-consult-row');

  meta.textContent = `${data.waitingCount} patient${data.waitingCount !== 1 ? 's' : ''} waiting`;

  // In consultation
  if (data.inConsultation && data.inConsultation.length > 0) {
    inConsultSection.classList.remove('hidden');
    const p = data.inConsultation[0];
    inConsultRow.innerHTML = `
      <div class="token-badge">${p.token}</div>
      <div>
        <div class="patient-name">${escHtml(p.name)}</div>
        <div class="patient-phone">${escHtml(p.phone || '')}</div>
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:10px;">
        <span style="font-size:11px;color:var(--accent)">● In Consultation</span>
        <button class="btn-remove" onclick="markDone(${p.token})">Mark Done</button>
      </div>
    `;
  } else {
    inConsultSection.classList.add('hidden');
  }

  // Waiting queue
  if (data.queue.length === 0) {
    tbody.innerHTML = `
      <tr id="empty-row">
        <td colspan="6" class="empty-state">
          <div class="empty-icon">🗒️</div>
          <div>Queue is empty — add the first patient above</div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = data.queue.map((p, idx) => {
    const checkinTime = formatTime(p.checkInTime);
    const waitClass = p.estimatedWaitMin <= 5 ? 'wait-badge--short' :
                      p.estimatedWaitMin > 30 ? 'wait-badge--long' : '';
    const tokenClass = idx === 0 ? 'token-badge--next' : '';
    const waitLabel = p.estimatedWaitMin <= 1 ? 'Any moment' : `~${p.estimatedWaitMin} min`;

    return `
      <tr data-token="${p.token}">
        <td class="position-num">${idx + 1}</td>
        <td><div class="token-badge ${tokenClass}">${p.token}</div></td>
        <td>
          <div class="patient-name">${escHtml(p.name)}</div>
          ${p.phone ? `<div class="patient-phone">📞 ${escHtml(p.phone)}</div>` : ''}
        </td>
        <td style="color:var(--text-secondary)">${checkinTime}</td>
        <td>
          <span class="wait-badge ${waitClass}">
            ${idx === 0 ? '🟢 Next' : waitLabel}
          </span>
          ${idx > 0 ? `<div style="font-size:10px;color:var(--text-muted);margin-top:3px">${p.tokensAhead} ahead</div>` : ''}
        </td>
        <td>
          <button class="btn-remove" onclick="removePatient(${p.token})">Remove</button>
        </td>
      </tr>`;
  }).join('');
}

function renderDone(data) {
  const list = document.getElementById('done-list');
  const count = document.getElementById('done-count');
  count.textContent = `(${data.done ? data.done.length : 0})`;

  if (!data.done || data.done.length === 0) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px">No patients completed yet.</div>';
    return;
  }

  list.innerHTML = [...data.done].reverse().map(p => {
    const duration = p.consultStartTime && p.consultEndTime
      ? Math.round((new Date(p.consultEndTime) - new Date(p.consultStartTime)) / 60000)
      : null;
    return `
      <div class="done-item">
        <span class="done-token">#${p.token}</span>
        <span>${escHtml(p.name)}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">
          ${duration !== null ? `${duration} min` : ''} · Done ${formatTime(p.consultEndTime)}
        </span>
      </div>`;
  }).join('');
}

// ── ACTIONS ──────────────────────────────────────────────────
function addPatient(e) {
  e.preventDefault();
  const name = document.getElementById('input-name').value.trim();
  const phone = document.getElementById('input-phone').value.trim();
  if (!name) { showToast('Patient name is required', 'error'); return; }
  socket.emit('add_patient', { name, phone });
  document.getElementById('add-patient-form').reset();
}

function addAndCall() {
  const name = document.getElementById('input-name').value.trim();
  if (!name) { showToast('Patient name is required first', 'error'); return; }
  pendingAddAndCall = true;
  const phone = document.getElementById('input-phone').value.trim();
  socket.emit('add_patient', { name, phone });
  document.getElementById('add-patient-form').reset();
}

function callNext() {
  socket.emit('call_next');
}

function undoCall() {
  socket.emit('undo_call');
  clearInterval(undoTimer);
  document.getElementById('btn-undo').classList.add('hidden');
  showToast('Last call undone', 'info');
}

function markDone(token) {
  socket.emit('mark_done', { token });
}

function removePatient(token) {
  socket.emit('remove_patient', { token });
}

let avgDebounce = null;

function onSliderInput(val) {
  document.getElementById('avg-input').value = val;
  updateSliderFill(val);
  // Debounce: only emit after user stops moving slider for 400ms
  clearTimeout(avgDebounce);
  avgDebounce = setTimeout(() => setAvgTime(val), 400);
}

function setAvgTime(val) {
  const minutes = parseFloat(val);
  if (isNaN(minutes) || minutes < 1) return;
  updateSliderFill(minutes);
  socket.emit('set_avg_time', { minutes });
}

function updateSliderFill(val) {
  const slider = document.getElementById('avg-slider');
  const pct = ((Math.min(val, 60) - 1) / (60 - 1)) * 100;
  slider.style.setProperty('--pct', pct + '%');
}

// ── CLOCK ────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('header-time').textContent = `${h}:${m}:${s}`;
}
setInterval(updateClock, 1000);
updateClock();

// ── TOAST ────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ── HELPERS ──────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// ── KEYBOARD SHORTCUT: Enter on name field ───────────────────
document.getElementById('input-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('add-patient-form').requestSubmit();
  }
});
