// ============================================================
//  PATIENT WAITING ROOM v2 — Client JS
// ============================================================

const socket = io();
let myToken = null;
let currentState = null;
let heroTimerInterval = null;
let alertShown = false;
let lookupDebounce = null;

// ── CONNECTION ───────────────────────────────────────────────
const connEl = document.getElementById('conn-indicator');
const connText = document.getElementById('conn-text');

socket.on('connect', () => {
  connEl.className = 'conn-indicator conn-online';
  connText.textContent = 'Live';
});
socket.on('disconnect', () => {
  connEl.className = 'conn-indicator conn-offline';
  connText.textContent = 'Reconnecting…';
});

// ── MAIN UPDATE ──────────────────────────────────────────────
socket.on('queue_update', (data) => {
  currentState = data;
  renderHero(data);
  renderStats(data);
  renderQueue(data);
  updateLastUpdated();
  if (myToken !== null) doLookup(myToken, data);
  checkSoonAlert(data);
});

// ── HERO ─────────────────────────────────────────────────────
function renderHero(data) {
  const el = document.getElementById('hero-token');
  const sub = document.getElementById('hero-sub');

  const newVal = data.currentToken > 0 ? String(data.currentToken) : '—';
  if (el.textContent !== newVal) {
    el.textContent = newVal;
    el.classList.remove('flip');
    void el.offsetWidth;
    el.classList.add('flip');
  }

  if (data.currentToken > 0 && data.inConsultation?.length > 0) {
    sub.textContent = 'In consultation right now';
    startHeroTimer(data.consultStartTime, data.avgConsultMinutes);
  } else if (!data.currentToken) {
    sub.textContent = 'Waiting for first patient to be called';
    stopHeroTimer();
  }
}

function startHeroTimer(startTime, avgMin) {
  stopHeroTimer();
  if (!startTime) return;
  const avgMs = avgMin * 60000;
  const el = document.getElementById('hero-timer');
  heroTimerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const rem = avgMs - elapsed;
    if (rem > 0) {
      const m = Math.floor(rem / 60000);
      const s = Math.floor((rem % 60000) / 1000);
      el.textContent = `⏱ Approx. ${m}m ${s}s remaining`;
      el.style.color = rem < 60000 ? '#f87171' : 'var(--teal)';
    } else {
      const over = Math.abs(rem);
      const m = Math.floor(over / 60000);
      const s = Math.floor((over % 60000) / 1000);
      el.textContent = `Wrapping up (${m}m ${s}s over)`;
      el.style.color = '#f97316';
    }
  }, 1000);
}
function stopHeroTimer() {
  clearInterval(heroTimerInterval);
  document.getElementById('hero-timer').textContent = '';
}

// ── STATS ─────────────────────────────────────────────────────
function renderStats(data) {
  setVal('sp-waiting', data.waitingCount);
  setVal('sp-served',  data.totalServed);
  setVal('sp-avg',     data.effectiveAvgMinutes);
}
function setVal(id, val) {
  const el = document.getElementById(id);
  if (!el || el.textContent === String(val)) return;
  el.textContent = val;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

// ── QUEUE ─────────────────────────────────────────────────────
function renderQueue(data) {
  const list = document.getElementById('waiting-list');
  if (!data.queue?.length) {
    list.innerHTML = `
      <div class="wl-empty">
        <div class="wle-icon">☕</div>
        <div class="wle-text">No one waiting right now</div>
        <div class="wle-sub">Check back soon</div>
      </div>`;
    return;
  }

  list.innerHTML = data.queue.map((p, idx) => {
    const isNext = idx === 0;
    const isMine = myToken !== null && p.token === myToken;
    const waitLabel = p.estimatedWaitMin <= 1 ? 'Next!' : `~${p.estimatedWaitMin}`;
    const waitUnit  = p.estimatedWaitMin <= 1 ? '' : 'min';
    const waitCls = isNext ? 'wl-wait--next' : p.estimatedWaitMin <= 8 ? 'wl-wait--short' : 'wl-wait--long';

    return `
      <div class="wl-item${isNext ? ' wl-item--next' : ''}${isMine ? ' wl-item--mine' : ''}" data-token="${p.token}">
        <div class="wl-pos">${idx + 1}</div>
        <div class="wl-token${isNext ? ' wl-token--next' : ''}${isMine ? ' wl-token--mine' : ''}">${p.token}</div>
        <div class="wl-info">
          <div class="wl-info-top">
            Token #${p.token}
            ${isMine ? '<span class="wl-mine-badge">← You</span>' : ''}
            ${isNext && !isMine ? '<span class="wl-next-badge">● Next</span>' : ''}
          </div>
          <div class="wl-info-sub">
            ${p.tokensAhead === 0 ? 'You are next in line!' : `${p.tokensAhead} patient${p.tokensAhead > 1 ? 's' : ''} ahead`}
          </div>
        </div>
        <div class="wl-wait ${waitCls}">
          <div class="wl-wait-val">${waitLabel}</div>
          <div class="wl-wait-unit">${waitUnit}</div>
        </div>
      </div>`;
  }).join('');
}

// ── TOKEN LOOKUP ──────────────────────────────────────────────
function lookupMyToken(val) {
  const token = parseInt(val);
  if (isNaN(token) || token < 1) {
    myToken = null;
    document.getElementById('my-status-card').classList.add('hidden');
    return;
  }
  clearTimeout(lookupDebounce);
  lookupDebounce = setTimeout(() => {
    myToken = token;
    if (currentState) doLookup(token, currentState);
    else socket.emit('lookup_token', { token });
  }, 300);
}

function doLookup(token, data) {
  const card = document.getElementById('my-status-card');
  const inWaiting = data.queue?.find(p => p.token === token);
  const inConsult = data.inConsultation?.find(p => p.token === token);
  const done = data.done?.find(p => p.token === token);

  if (inConsult) {
    card.className = 'status-card in-consult';
    card.innerHTML = `
      <div class="sc-token">Token #${token}</div>
      <div class="sc-line">🟢 You are currently being seen by the doctor!</div>`;
  } else if (inWaiting) {
    const isNext = inWaiting.tokensAhead === 0;
    card.className = `status-card ${isNext ? 'next' : 'waiting'}`;
    card.innerHTML = `
      <div class="sc-token">Token #${token}</div>
      <div class="sc-line">${isNext ? '🟢 You are next! Please be ready.' : `⏳ ${inWaiting.tokensAhead} patient${inWaiting.tokensAhead > 1 ? 's' : ''} ahead of you`}</div>
      <div class="sc-wait">${inWaiting.estimatedWaitMin <= 1 ? 'Any moment now' : `~${inWaiting.estimatedWaitMin} min wait`}</div>`;
  } else if (done) {
    card.className = 'status-card done';
    card.innerHTML = `<div class="sc-token">Token #${token}</div><div class="sc-line">✅ Your consultation is complete. Thank you!</div>`;
  } else {
    card.className = 'status-card not-found';
    card.innerHTML = `<div class="sc-token">#${token}</div><div class="sc-line">Token not found in today's queue. Please check with reception.</div>`;
  }
  card.classList.remove('hidden');
}

// ── SOON ALERT ────────────────────────────────────────────────
function checkSoonAlert(data) {
  if (!myToken || alertShown) return;
  const pos = data.queue?.find(p => p.token === myToken);
  if (pos && pos.tokensAhead <= 1) { alertShown = true; showSoonAlert(); }
}
function showSoonAlert() {
  document.getElementById('soon-alert').classList.remove('hidden');
  setTimeout(dismissAlert, 9000);
}
function dismissAlert() {
  document.getElementById('soon-alert').classList.add('hidden');
}

// ── LAST UPDATED ──────────────────────────────────────────────
function updateLastUpdated() {
  const d = new Date();
  const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
  document.getElementById('last-update').textContent = `Updated ${t}`;
}
