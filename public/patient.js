// ============================================================
//  PATIENT PAGE v3 — Client JS (Light Theme)
// ============================================================
const socket = io();
let myToken = null;
let currentState = null;
let heroTimerInterval = null;
let alertShown = false;
let lookupDebounce = null;
let timeOffset = 0;

// ── CONNECTION ─────────────────────────────────────────────
const connBadge = document.getElementById('conn-badge');
const connText  = document.getElementById('conn-text');
socket.on('connect', () => {
  connBadge.className = 'conn-badge conn-online';
  connText.textContent = 'Live';
});
socket.on('disconnect', () => {
  connBadge.className = 'conn-badge conn-offline';
  connText.textContent = 'Reconnecting…';
});

// ── MAIN UPDATE ────────────────────────────────────────────
socket.on('queue_update', (data) => {
  if (data.serverTime) timeOffset = data.serverTime - Date.now();
  currentState = data;
  renderHero(data);
  renderStats(data);
  renderQueue(data);
  updateFooter();
  if (myToken !== null) doLookup(myToken, data);
  checkSoonAlert(data);
});

// ── HERO ───────────────────────────────────────────────────
function renderHero(data) {
  const el  = document.getElementById('hero-token');
  const sub = document.getElementById('hero-sub');

  const newVal = data.currentToken > 0 ? String(data.currentToken) : '—';
  if (el.textContent !== newVal) {
    el.textContent = newVal;
    el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip');
  }

  if (data.currentToken > 0 && data.inConsultation?.length > 0) {
    const p = data.inConsultation[0];
    sub.innerHTML = `In consultation right now${p.isEmergency ? ' <span style="color:var(--red);font-weight:700">[Emergency]</span>' : ''}`;
    startHeroTimer(p, data.avgConsultMinutes);
  } else {
    sub.textContent = data.currentToken > 0 ? 'Consultation in progress' : 'Waiting for first patient to be called';
    stopHeroTimer();
  }
}
function startHeroTimer(patient, avgMin) {
  stopHeroTimer();
  const startTime = new Date(patient.consultStartTime).getTime();
  if (!startTime && !patient.liveElapsedMs) return;
  
  const allottedMin = patient.isEmergency ? 10 : (patient.isQuickConsult ? 2 : avgMin);
  const avgMs = allottedMin * 60000;
  const el = document.getElementById('hero-timer');
  heroTimerInterval = setInterval(() => {
    const adjustedNow = Date.now() + timeOffset;
    let elapsed = patient.elapsedMs || 0;
    if (patient.consultStartTime) {
        elapsed += (adjustedNow - new Date(patient.consultStartTime).getTime());
    }
    const rem = avgMs - elapsed;
    if (rem > 0) {
      const m = Math.floor(rem/60000), s = Math.floor((rem%60000)/1000);
      el.textContent = `⏱ Approx. ${m}m ${s}s remaining`;
    } else {
      const over = Math.abs(rem);
      el.textContent = `Wrapping up (${Math.floor(over/60000)}m ${Math.floor((over%60000)/1000)}s over)`;
    }
  }, 1000);
}
function stopHeroTimer() {
  clearInterval(heroTimerInterval);
  document.getElementById('hero-timer').textContent = '';
}

// ── STATS ──────────────────────────────────────────────────
function renderStats(data) {
  setVal('sp-waiting', data.waitingCount);
  setVal('sp-served',  data.totalServed);
  setVal('sp-avg',     data.effectiveAvgMinutes);
}
function setVal(id, val) {
  const el = document.getElementById(id);
  if (!el || el.textContent === String(val)) return;
  el.textContent = val;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}

// ── QUEUE ──────────────────────────────────────────────────
function renderQueue(data) {
  const list = document.getElementById('waiting-list');
  if (!data.queue?.length) {
    list.innerHTML = `<div class="wl-empty"><div class="wle-icon">☕</div><div class="wle-text">No one waiting right now</div><div class="wle-sub">Check back soon</div></div>`;
    return;
  }
  list.innerHTML = data.queue.map((p, idx) => {
    const isNext = idx === 0;
    const isMine = myToken !== null && p.token === myToken;
    const isEmergency = p.status === 'waiting-emergency';
    const isQuick = p.status === 'quick-consult';
    const isOnHold = p.status === 'on-hold';

    let waitLabel = `~${Math.max(0, p.estimatedWaitMin)}`;
    let waitUnit = 'min';
    let waitCls = p.estimatedWaitMin <= 8 ? 'short' : 'long';
    let badgeCls = '';
    let nameTag = '';

    if (isEmergency) {
        waitCls = 'emergency'; badgeCls = 'emergency';
        nameTag = ' <span class="wl-next-badge" style="background:rgba(30,58,138,0.1); color:var(--red);">🚨 Emergency</span>';
    } else if (isQuick) {
        waitCls = 'quick-consult'; badgeCls = 'quick-consult';
        nameTag = ' <span class="wl-next-badge" style="background:#e0f2fe; color:#0284c7;">⚡ Quick Consult</span>';
    } else if (isOnHold) {
        waitCls = 'on-hold'; badgeCls = 'on-hold';
        nameTag = ' <span class="wl-next-badge" style="background:rgba(67,56,202,0.1); color:var(--amber);">⏸ On Hold</span>';
    } else if (isNext) {
        waitCls = 'next'; badgeCls = 'next';
    }

    return `
      <div class="wl-item${badgeCls ? ' '+badgeCls : ''}${isMine ? ' mine' : ''}">
        <div class="wl-pos">${idx + 1}</div>
        <div class="wl-token${badgeCls ? ' '+badgeCls : ''}${isMine ? ' mine' : ''}">${p.token}</div>
        <div class="wl-info">
          <div class="wl-info-top">
            Token #${p.token}
            ${isMine ? '<span class="wl-mine-badge">← You</span>' : ''}
            ${isNext && !isMine && !isEmergency && !isQuick && !isOnHold ? '<span class="wl-next-badge">● Next</span>' : ''}
            ${nameTag}
          </div>
          <div class="wl-info-sub">${p.tokensAhead === 0 ? 'You are next in line!' : `${p.tokensAhead} patient${p.tokensAhead > 1 ? 's' : ''} ahead`}</div>
        </div>
        <div class="wl-wait ${waitCls}">
          <div class="wl-wait-val">${waitLabel}</div>
          <div class="wl-wait-unit">${waitUnit}</div>
        </div>
      </div>`;
  }).join('');
}

// ── TOKEN LOOKUP ───────────────────────────────────────────
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
    card.innerHTML = `<div class="sc-token">Token #${token}</div><div class="sc-line">🟢 You are currently being seen by the doctor!</div>`;
  } else if (inWaiting) {
    const isNext = inWaiting.tokensAhead === 0;
    card.className = `status-card ${isNext ? 'next' : 'waiting'}`;
    card.innerHTML = `
      <div class="sc-token">Token #${token}</div>
      <div class="sc-line">${isNext ? '🟢 You are next! Please be ready.' : `⏳ ${inWaiting.tokensAhead} patient${inWaiting.tokensAhead > 1 ? 's' : ''} ahead of you`}</div>
      <div class="sc-wait">${inWaiting.estimatedWaitMin <= 1 ? 'Any moment now' : `~${inWaiting.estimatedWaitMin} min wait`}</div>`;
  } else if (done) {
    card.className = 'status-card done';
    card.innerHTML = `<div class="sc-token">Token #${token}</div><div class="sc-line">✅ Your consultation is complete. Thank you for visiting!</div>`;
  } else {
    card.className = 'status-card not-found';
    card.innerHTML = `<div class="sc-token">#${token}</div><div class="sc-line">Token not found in today's queue. Please check with reception.</div>`;
  }
  card.classList.remove('hidden');
}

// ── SOON ALERT ─────────────────────────────────────────────
function checkSoonAlert(data) {
  if (!myToken || alertShown) return;
  const pos = data.queue?.find(p => p.token === myToken);
  if (pos && pos.tokensAhead <= 1) { alertShown = true; showSoonAlert(); }
}
function showSoonAlert() {
  document.getElementById('soon-alert').classList.remove('hidden');
  setTimeout(dismissAlert, 9000);
}
function dismissAlert() { document.getElementById('soon-alert').classList.add('hidden'); }

// ── FOOTER ─────────────────────────────────────────────────
function updateFooter() {
  const d = new Date();
  const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
  document.getElementById('last-update').textContent = `Updated ${t}`;
}
