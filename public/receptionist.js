// ============================================================
//  RECEPTIONIST DASHBOARD v2 — Client JS
// ============================================================

const socket = io();
let pendingAddAndCall = false;
let undoTimer = null;
let consultTimerInterval = null;
let progressInterval = null;
let currentState = null;
let avgDebounce = null;
let searchFilter = '';

// ── SIDEBAR PANEL LOGIC ──────────────────────────────────────
function showDonePanel() {
  document.getElementById('done-panel').classList.remove('hidden');
  document.getElementById('settings-panel').classList.add('hidden');
  setNavActive('nav-history');
}
function showSettingsPanel() {
  document.getElementById('settings-panel').classList.remove('hidden');
  document.getElementById('done-panel').classList.add('hidden');
  setNavActive('nav-settings');
}
function hidePanels() {
  document.getElementById('settings-panel').classList.add('hidden');
  document.getElementById('done-panel').classList.add('hidden');
  setNavActive('nav-dashboard');
}
function setNavActive(id) {
  document.querySelectorAll('.snav-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ── CONNECTION ───────────────────────────────────────────────
const scBadge = document.getElementById('sidebar-conn');
const scLabel = document.getElementById('sc-label');

socket.on('connect', () => {
  scBadge.className = 'sc-badge sc-online';
  scLabel.textContent = 'Connected';
});
socket.on('disconnect', () => {
  scBadge.className = 'sc-badge sc-offline';
  scLabel.textContent = 'Disconnected';
});
socket.on('connect_error', () => {
  scBadge.className = 'sc-badge sc-offline';
  scLabel.textContent = 'Reconnecting…';
});

// ── MAIN STATE UPDATE ─────────────────────────────────────────
socket.on('queue_update', (data) => {
  currentState = data;
  renderAll(data);
  if (pendingAddAndCall) {
    pendingAddAndCall = false;
    socket.emit('call_next');
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

// ── RENDER ALL ───────────────────────────────────────────────
function renderAll(data) {
  renderKPIs(data);
  renderToken(data);
  renderCallButton(data);
  renderInConsultBanner(data);
  renderQueue(data);
  renderDone(data);
  renderSettings(data);
  renderUndoButton(data);
}

function renderKPIs(data) {
  animNum('kpi-waiting', data.waitingCount);
  animNum('kpi-served', data.totalServed);
  animNum('kpi-avg', data.effectiveAvgMinutes);
  animNum('kpi-samples', data.sampleCount);

  const badge = document.getElementById('kpi-data-badge');
  if (data.sampleCount >= 2) {
    badge.textContent = '● Real';
    badge.className = 'kpi-badge real';
  } else {
    badge.textContent = 'Manual';
    badge.className = 'kpi-badge';
  }
}

function animNum(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.textContent !== String(val)) {
    el.textContent = val;
    el.classList.remove('num-pop');
    void el.offsetWidth;
    el.classList.add('num-pop');
  }
}

function renderToken(data) {
  const el = document.getElementById('token-display');
  const nameEl = document.getElementById('token-patient-name');
  const timerEl = document.getElementById('token-timer');
  const progressWrap = document.getElementById('token-progress-wrap');

  const newVal = data.currentToken > 0 ? String(data.currentToken) : '—';
  if (el.textContent !== newVal) {
    el.textContent = newVal;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  if (data.inConsultation?.length > 0) {
    const p = data.inConsultation[0];
    nameEl.textContent = p.name + (p.phone ? ` · ${p.phone}` : '');
    progressWrap.style.display = 'block';
    startConsultTimer(data.consultStartTime, data.avgConsultMinutes);
  } else {
    nameEl.textContent = 'No patient in consultation';
    timerEl.textContent = '';
    progressWrap.style.display = 'none';
    clearInterval(consultTimerInterval);
  }
}

function startConsultTimer(startTime, avgMin) {
  clearInterval(consultTimerInterval);
  if (!startTime) return;
  const avgMs = avgMin * 60000;
  const timerEl = document.getElementById('token-timer');
  const bar = document.getElementById('token-progress-bar');

  consultTimerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = avgMs - elapsed;
    const pct = Math.min(100, (elapsed / avgMs) * 100);
    bar.style.width = pct + '%';

    if (remaining > 0) {
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = `⏱ ${m}:${String(s).padStart(2,'0')} remaining`;
      timerEl.style.color = remaining < 60000 ? '#f87171' : 'var(--teal)';
      bar.style.background = remaining < 60000
        ? 'linear-gradient(90deg,#ef4444,#f97316)'
        : 'linear-gradient(90deg,var(--accent),var(--teal))';
    } else {
      const over = Math.abs(remaining);
      const m = Math.floor(over / 60000);
      const s = Math.floor((over % 60000) / 1000);
      timerEl.textContent = `⚠ Overrun ${m}:${String(s).padStart(2,'0')}`;
      timerEl.style.color = '#f97316';
      bar.style.background = 'linear-gradient(90deg,#f97316,#ef4444)';
    }
  }, 1000);
}

function renderCallButton(data) {
  const btn = document.getElementById('btn-call-next');
  const sub = document.getElementById('bcn-sub');
  if (data.nextToken) {
    btn.disabled = false;
    sub.textContent = `→ Token #${data.nextToken} will be called`;
  } else {
    btn.disabled = true;
    sub.textContent = 'No patients waiting';
  }
}

function renderInConsultBanner(data) {
  const banner = document.getElementById('in-consult-banner');
  const nameEl = document.getElementById('icb-name');
  const doneBtn = document.getElementById('icb-done-btn');

  if (data.inConsultation?.length > 0) {
    const p = data.inConsultation[0];
    banner.classList.remove('hidden');
    nameEl.textContent = `#${p.token} — ${p.name}`;
    doneBtn.onclick = () => markDone(p.token);
  } else {
    banner.classList.add('hidden');
  }
}

function renderQueue(data) {
  const tbody = document.getElementById('queue-tbody');
  const sub = document.getElementById('queue-sub');
  const emptyEl = document.getElementById('queue-empty');
  document.getElementById('snav-done-count').textContent = data.done?.length || 0;

  sub.textContent = `${data.waitingCount} patient${data.waitingCount !== 1 ? 's' : ''} waiting`;

  if (data.queue.length === 0) {
    tbody.innerHTML = '';
    emptyEl.classList.add('show');
    return;
  }
  emptyEl.classList.remove('show');

  tbody.innerHTML = data.queue.map((p, idx) => {
    const waitLabel = p.estimatedWaitMin <= 1 ? '🟢 Next' : `~${p.estimatedWaitMin} min`;
    const waitCls = idx === 0 ? 'wait-chip--next' : p.estimatedWaitMin <= 10 ? 'wait-chip--short' : 'wait-chip--long';
    const tknCls = idx === 0 ? 'tkn-badge--next' : '';
    const hidden = searchFilter && !p.name.toLowerCase().includes(searchFilter) ? 'filtered' : '';
    return `
      <tr data-token="${p.token}" class="${hidden}">
        <td><span class="pos-num">${idx + 1}</span></td>
        <td><div class="tkn-badge ${tknCls}">${p.token}</div></td>
        <td>
          <div class="pt-name">${escHtml(p.name)}</div>
          ${p.phone ? `<div class="pt-phone">📞 ${escHtml(p.phone)}</div>` : ''}
        </td>
        <td style="color:var(--text-muted)">${formatTime(p.checkInTime)}</td>
        <td><span class="wait-chip ${waitCls}">${waitLabel}</span></td>
        <td><button class="btn-remove" onclick="removePatient(${p.token})">✕ Remove</button></td>
      </tr>`;
  }).join('');
}

function renderDone(data) {
  const list = document.getElementById('done-list');
  if (!data.done?.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px">No patients completed yet.</div>';
    return;
  }
  list.innerHTML = [...data.done].reverse().map(p => {
    const dur = p.consultStartTime && p.consultEndTime
      ? Math.round((new Date(p.consultEndTime) - new Date(p.consultStartTime)) / 60000) : null;
    return `
      <div class="done-row">
        <span class="done-tkn">#${p.token}</span>
        <span class="done-name">${escHtml(p.name)}</span>
        <span class="done-meta">${dur != null ? dur + ' min · ' : ''}${formatTime(p.consultEndTime)}</span>
      </div>`;
  }).join('');
}

function renderSettings(data) {
  const note = document.getElementById('settings-note');
  const avgInput = document.getElementById('avg-input');
  const slider = document.getElementById('avg-slider');

  if (document.activeElement !== avgInput) {
    avgInput.value = data.avgConsultMinutes;
    slider.value = Math.min(data.avgConsultMinutes, 60);
    updateSliderFill(data.avgConsultMinutes);
  }

  if (data.sampleCount >= 2) {
    note.innerHTML = `📊 <strong style="color:var(--green)">Real data active:</strong> Rolling avg of ${data.sampleCount} consultations = ${data.effectiveAvgMinutes} min`;
  } else {
    note.textContent = `Using manual setting. Override activates after ${2 - data.sampleCount} more consultation(s) complete.`;
  }
}

function renderUndoButton(data) {
  const btn = document.getElementById('btn-undo');
  if (data.canUndo) {
    btn.classList.remove('hidden');
    clearInterval(undoTimer);
    let rem = 30;
    const cd = document.getElementById('undo-countdown');
    undoTimer = setInterval(() => {
      rem--;
      cd.textContent = `(${rem}s)`;
      if (rem <= 0) { clearInterval(undoTimer); btn.classList.add('hidden'); }
    }, 1000);
  } else {
    btn.classList.add('hidden');
    clearInterval(undoTimer);
  }
}

// ── ACTIONS ──────────────────────────────────────────────────
function addPatient(e) {
  e.preventDefault();
  const name = document.getElementById('input-name').value.trim();
  if (!name) { showToast('Patient name is required', 'error'); return; }
  socket.emit('add_patient', { name, phone: document.getElementById('input-phone').value.trim() });
  document.getElementById('add-patient-form').reset();
}

function addAndCall() {
  const name = document.getElementById('input-name').value.trim();
  if (!name) { showToast('Patient name is required', 'error'); return; }
  pendingAddAndCall = true;
  socket.emit('add_patient', { name, phone: document.getElementById('input-phone').value.trim() });
  document.getElementById('add-patient-form').reset();
}

function callNext() { socket.emit('call_next'); }
function undoCall() {
  socket.emit('undo_call');
  clearInterval(undoTimer);
  document.getElementById('btn-undo').classList.add('hidden');
  showToast('Last call undone', 'info');
}
function markDone(token) { socket.emit('mark_done', { token }); }
function removePatient(token) { socket.emit('remove_patient', { token }); }

function filterQueue(val) {
  searchFilter = val.toLowerCase();
  document.querySelectorAll('#queue-tbody tr').forEach(row => {
    const name = row.querySelector('.pt-name')?.textContent.toLowerCase() || '';
    const token = row.dataset.token || '';
    row.classList.toggle('filtered', !!(searchFilter && !name.includes(searchFilter) && !token.includes(searchFilter)));
  });
}

function onSliderInput(val) {
  document.getElementById('avg-input').value = val;
  updateSliderFill(val);
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
  const pct = ((Math.min(val, 60) - 1) / 59) * 100;
  slider.style.setProperty('--pct', pct + '%');
}

// ── CLOCK ────────────────────────────────────────────────────
function updateClock() {
  const d = new Date();
  const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
  document.getElementById('sc-time').textContent = t;
  document.getElementById('topbar-date').textContent = d.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long' });
}
setInterval(updateClock, 1000);
updateClock();

// ── TOAST ────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── HELPERS ──────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2,'0')).join(':');
}

// ── ENTER KEY ────────────────────────────────────────────────
document.getElementById('input-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('add-patient-form').requestSubmit(); }
});
