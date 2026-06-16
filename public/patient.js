// ============================================================
//  PATIENT WAITING ROOM — Client JavaScript
//  Live queue display via Socket.IO — zero page refreshes
// ============================================================

const socket = io();
let myToken = null;
let currentState = null;
let heroTimerInterval = null;
let alertShown = false;
let lookupDebounce = null;

// ── Connection ───────────────────────────────────────────────
const connDot = document.querySelector('.conn-live-dot');
const connLabel = document.getElementById('conn-label');

socket.on('connect', () => {
  connDot.className = 'conn-live-dot online';
  connLabel.textContent = 'Live';
});
socket.on('disconnect', () => {
  connDot.className = 'conn-live-dot offline';
  connLabel.textContent = 'Reconnecting…';
});

// ── Main live update ─────────────────────────────────────────
socket.on('queue_update', (data) => {
  currentState = data;
  renderHero(data);
  renderStats(data);
  renderWaitingList(data);
  checkMyTokenAlert(data);
  updateLastUpdated();

  // Re-run lookup if user has a token entered
  if (myToken !== null) {
    doLookup(myToken, data);
  }
});

// ── HERO: NOW SERVING ────────────────────────────────────────
function renderHero(data) {
  const heroEl = document.getElementById('hero-token');
  const subEl = document.getElementById('hero-subtitle');

  const newVal = data.currentToken > 0 ? String(data.currentToken) : '—';
  if (heroEl.textContent !== newVal) {
    heroEl.textContent = newVal;
    heroEl.classList.remove('flip');
    void heroEl.offsetWidth;
    heroEl.classList.add('flip');
  }

  if (data.currentToken > 0 && data.inConsultation && data.inConsultation.length > 0) {
    subEl.textContent = 'In consultation right now';
    startHeroTimer(data.consultStartTime, data.avgConsultMinutes);
  } else if (data.currentToken === 0) {
    subEl.textContent = 'Waiting for first patient to be called';
    stopHeroTimer();
  } else {
    subEl.textContent = 'Consultation in progress';
  }
}

function startHeroTimer(startTime, avgMin) {
  stopHeroTimer();
  if (!startTime) return;
  const avgMs = avgMin * 60000;
  const timerEl = document.getElementById('hero-timer');

  heroTimerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = avgMs - elapsed;
    if (remaining > 0) {
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      timerEl.textContent = `⏱ Approx. ${m}m ${s}s remaining`;
    } else {
      const over = Math.abs(remaining);
      const m = Math.floor(over / 60000);
      const s = Math.floor((over % 60000) / 1000);
      timerEl.textContent = `Wrapping up (${m}m ${s}s over)`;
    }
  }, 1000);
}

function stopHeroTimer() {
  clearInterval(heroTimerInterval);
  document.getElementById('hero-timer').textContent = '';
}

// ── STATS ────────────────────────────────────────────────────
function renderStats(data) {
  setStatVal('qs-waiting', data.waitingCount);
  setStatVal('qs-served', data.totalServed);
  setStatVal('qs-avg', data.effectiveAvgMinutes);
}

function setStatVal(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.textContent !== String(val)) {
    el.textContent = val;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
}

// ── WAITING LIST ─────────────────────────────────────────────
function renderWaitingList(data) {
  const list = document.getElementById('waiting-list');

  if (!data.queue || data.queue.length === 0) {
    list.innerHTML = `
      <div class="wl-empty">
        <div class="wl-empty-icon">☕</div>
        <div>No one waiting right now</div>
      </div>`;
    return;
  }

  list.innerHTML = data.queue.map((p, idx) => {
    const isNext = idx === 0;
    const isMine = myToken !== null && p.token === myToken;
    const waitLabel = p.estimatedWaitMin <= 1 ? 'Next!' : `~${p.estimatedWaitMin}`;
    const waitUnit = p.estimatedWaitMin <= 1 ? '' : 'min';
    const waitClass = p.estimatedWaitMin <= 5 ? 'wl-wait--short' :
                      isNext ? 'wl-wait--next' : '';

    return `
      <div class="wl-item${isNext ? ' wl-item--next' : ''}${isMine ? ' wl-item--my' : ''}" data-token="${p.token}">
        <div class="wl-position">${idx + 1}</div>
        <div class="wl-token${isNext ? ' wl-token--next' : ''}${isMine ? ' wl-token--my' : ''}">
          ${p.token}
        </div>
        <div class="wl-info">
          <div class="wl-token-label">
            Token #${p.token}
            ${isMine ? ' <span style="color:#93c5fd;font-size:10px">← You</span>' : ''}
            ${isNext ? ' <span style="color:var(--green);font-size:10px">● Next</span>' : ''}
          </div>
          <div class="wl-status-text">
            ${p.tokensAhead === 0 ? 'You are next in line!' : `${p.tokensAhead} patient${p.tokensAhead > 1 ? 's' : ''} ahead`}
          </div>
        </div>
        <div class="wl-wait ${waitClass}">
          <div class="wl-wait-num">${waitLabel}</div>
          <div class="wl-wait-unit">${waitUnit}</div>
        </div>
      </div>`;
  }).join('');
}

// ── TOKEN LOOKUP ─────────────────────────────────────────────
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
    if (currentState) {
      doLookup(token, currentState);
    } else {
      socket.emit('lookup_token', { token });
    }
  }, 300);
}

function doLookup(token, data) {
  const card = document.getElementById('my-status-card');
  card.className = 'my-status'; // reset classes

  // Check in waiting list
  const inWaiting = data.queue ? data.queue.find(p => p.token === token) : null;
  const inConsult = data.inConsultation ? data.inConsultation.find(p => p.token === token) : null;
  const done = data.done ? data.done.find(p => p.token === token) : null;

  if (inConsult) {
    card.className = 'my-status in-consult';
    card.innerHTML = `
      <div class="status-token">Token #${token}</div>
      <div class="status-line">🟢 You are currently being seen by the doctor!</div>`;
    card.classList.remove('hidden');
  } else if (inWaiting) {
    const isNext = inWaiting.tokensAhead === 0;
    card.className = `my-status ${isNext ? 'next' : 'waiting'}`;
    card.innerHTML = `
      <div class="status-token">Token #${token}</div>
      <div class="status-line">
        ${isNext ? '🟢 You are next! Please be ready.' : `⏳ ${inWaiting.tokensAhead} patient${inWaiting.tokensAhead > 1 ? 's' : ''} ahead of you`}
      </div>
      <div class="status-wait">
        ${inWaiting.estimatedWaitMin <= 1 ? 'Any moment now' : `~${inWaiting.estimatedWaitMin} min wait`}
      </div>`;
    card.classList.remove('hidden');
  } else if (done) {
    card.className = 'my-status done';
    card.innerHTML = `
      <div class="status-token">Token #${token}</div>
      <div class="status-line">✅ Your consultation is complete. Thank you!</div>`;
    card.classList.remove('hidden');
  } else {
    card.className = 'my-status not-found';
    card.innerHTML = `
      <div class="status-token">#${token}</div>
      <div class="status-line">Token not found in today's queue. Please check with reception.</div>`;
    card.classList.remove('hidden');
  }
}

// ── SOON ALERT ───────────────────────────────────────────────
function checkMyTokenAlert(data) {
  if (!myToken || alertShown) return;

  const myPos = data.queue ? data.queue.find(p => p.token === myToken) : null;
  if (myPos && myPos.tokensAhead <= 1) {
    showSoonAlert();
  }
}

function showSoonAlert() {
  alertShown = true;
  document.getElementById('soon-alert').classList.remove('hidden');
  // Auto-dismiss after 8 seconds
  setTimeout(dismissAlert, 8000);
}

function dismissAlert() {
  document.getElementById('soon-alert').classList.add('hidden');
}

// ── LAST UPDATED ─────────────────────────────────────────────
function updateLastUpdated() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  document.getElementById('last-update').textContent = `Last updated: ${h}:${m}:${s}`;
}
