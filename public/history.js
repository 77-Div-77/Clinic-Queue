const socket = io();

// ── SIDEBAR TOGGLE & CLOCK ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('sidebar-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      document.querySelector('.sidebar')?.classList.toggle('collapsed');
      document.querySelector('.main-wrap')?.classList.toggle('collapsed');
    });
  }
});

function updateClock() {
  const d = new Date();
  document.getElementById('sf-time').textContent = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
}
setInterval(updateClock, 1000); updateClock();

// ── CONNECTION ───────────────────────────────────────────────
const sfDot  = document.getElementById('sf-dot');
const sfText = document.getElementById('sf-text');
socket.on('connect', () => {
  sfDot.className = 'sf-dot online'; sfText.textContent = 'Connected';
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('history-date').value = today;
  loadHistory(today);
});
socket.on('disconnect', () => {
  sfDot.className = 'sf-dot offline'; sfText.textContent = 'Disconnected';
});
socket.on('connect_error', () => {
  sfDot.className = 'sf-dot'; sfText.textContent = 'Reconnecting…';
});

// ── DATE CHANGE ──────────────────────────────────────────────
document.getElementById('history-date').addEventListener('change', (e) => {
  loadHistory(e.target.value);
});

function loadHistory(dateStr) {
  if (!dateStr) return;
  socket.emit('get_history', { date: dateStr }, (res) => {
    allHistoryData = res.done || [];
    applyHistoryView();
  });
}

// ── STATE ────────────────────────────────────────────────────
let allHistoryData = [];
let hSortKey = 'token';
let hSortAsc = true;

// ── SORT ─────────────────────────────────────────────────────
function sortHistory(key) {
  if (hSortKey === key) {
    hSortAsc = !hSortAsc;
  } else {
    hSortKey = key;
    hSortAsc = true;
  }
  applyHistoryView();
}

// ── FILTER ───────────────────────────────────────────────────
function filterHistory() {
  applyHistoryView();
}

function applyHistoryView() {
  const q = (document.getElementById('history-search')?.value || '').toLowerCase();
  let data = [...allHistoryData];

  // Filter
  if (q) {
    data = data.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      String(p.token || '').includes(q)
    );
  }

  // Sort
  data.sort((a, b) => {
    let av, bv;
    if (hSortKey === 'token') {
      av = a.token || 0;
      bv = b.token || 0;
    } else if (hSortKey === 'elapsedMs') {
      av = a.elapsedMs || 0;
      bv = b.elapsedMs || 0;
    } else {
      av = (a[hSortKey] || '').toLowerCase();
      bv = (b[hSortKey] || '').toLowerCase();
    }
    if (av < bv) return hSortAsc ? -1 : 1;
    if (av > bv) return hSortAsc ? 1 : -1;
    return 0;
  });

  // Update sort arrows
  ['sort-h-token','sort-h-name','sort-h-arr','sort-h-dep','sort-h-dur'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  const keyToId = { token: 'sort-h-token', name: 'sort-h-name', checkInTime: 'sort-h-arr', consultEndTime: 'sort-h-dep', elapsedMs: 'sort-h-dur' };
  const arrowEl = document.getElementById(keyToId[hSortKey]);
  if (arrowEl) arrowEl.textContent = hSortAsc ? ' ▲' : ' ▼';

  renderDoneList(data);
}

// ── RENDER ───────────────────────────────────────────────────
function renderDoneList(doneArray) {
  const tbody = document.getElementById('history-tbody');
  if (!doneArray || !doneArray.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--text-muted);">No consultations found.</td></tr>';
    return;
  }

  tbody.innerHTML = doneArray.map(p => {
    let durStr = '—';
    if (p.elapsedMs) {
      const m = Math.floor(p.elapsedMs / 60000);
      const s = Math.floor((p.elapsedMs % 60000) / 1000);
      durStr = `${m}m ${s}s`;
    }
    
    const formatTime = (isoStr) => {
      if (!isoStr) return '—';
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    };
    
    return `<tr>
      <td><div class="tkn-badge" style="background:#e0f2fe; color:#0284c7;">#${p.token}</div></td>
      <td><div class="pt-name">${escHtml(p.name)}</div></td>
      <td><span style="font-size:12px;font-weight:600;color:var(--text-sec);">${formatTime(p.checkInTime)}</span></td>
      <td><span style="font-size:12px;font-weight:600;color:var(--text-sec);">${formatTime(p.consultEndTime)}</span></td>
      <td><span class="wait-chip short">${durStr}</span></td>
    </tr>`;
  }).join('');
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
