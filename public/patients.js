const socket = io({ autoConnect: false });
let clinicId = null;

fetch('/api/me').then(r => r.json()).then(data => {
  if (data.loggedIn && data.clinic) {
    clinicId = data.clinic.id;
    socket.connect();
    socket.emit('join_clinic', { clinicId });
  } else {
    window.location.href = '/?signin=1';
  }
});

// ── MOBILE SIDEBAR ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggleBtn = document.getElementById('sidebar-toggle');

  if(toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.toggle('mobile-open');
        if (backdrop) backdrop.classList.toggle('show');
      } else {
        sidebar.classList.toggle('collapsed');
        const mainWrap = document.querySelector('.main-wrap');
        if (mainWrap) {
          if (sidebar.classList.contains('collapsed')) {
            mainWrap.style.marginLeft = '0';
            mainWrap.style.width = '100%';
          } else {
            mainWrap.style.marginLeft = 'var(--sidebar-w)';
            mainWrap.style.width = 'calc(100% - var(--sidebar-w))';
          }
        }
      }
    });
  }
  if(backdrop) {
    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('mobile-open');
      backdrop.classList.remove('show');
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
  if (clinicId) {
    socket.emit('get_all_patients', (data) => {
      allPatientsData = data || [];
      applyPatientsView();
    });
  }
});
socket.on('disconnect', () => {
  sfDot.className = 'sf-dot offline'; sfText.textContent = 'Disconnected';
});
socket.on('connect_error', () => {
  sfDot.className = 'sf-dot'; sfText.textContent = 'Reconnecting…';
});

// ── STATE ────────────────────────────────────────────────────
let allPatientsData = [];
let pSortKey = 'id';    // default sort by PID
let pSortAsc = true;

// ── SORT ─────────────────────────────────────────────────────
function sortPatients(key) {
  if (pSortKey === key) {
    pSortAsc = !pSortAsc;
  } else {
    pSortKey = key;
    pSortAsc = true;
  }
  applyPatientsView();
}

// ── FILTER ───────────────────────────────────────────────────
function filterPatients() {
  applyPatientsView();
}

function applyPatientsView() {
  const q = (document.getElementById('patients-search')?.value || '').toLowerCase();
  let data = [...allPatientsData];

  // Filter
  if (q) {
    data = data.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.phone || '').toLowerCase().includes(q) ||
      (p.id || '').toLowerCase().includes(q)
    );
  }

  // Sort
  data.sort((a, b) => {
    let av, bv;
    if (pSortKey === 'id') {
      // Numeric sort: PID-1001 → extract number
      av = parseInt((a.id || '').replace(/\D/g, '')) || 0;
      bv = parseInt((b.id || '').replace(/\D/g, '')) || 0;
    } else if (pSortKey === 'totalMeetings') {
      av = a.totalMeetings || 0;
      bv = b.totalMeetings || 0;
    } else {
      av = (a[pSortKey] || '').toLowerCase();
      bv = (b[pSortKey] || '').toLowerCase();
    }
    if (av < bv) return pSortAsc ? -1 : 1;
    if (av > bv) return pSortAsc ? 1 : -1;
    return 0;
  });

  // Update sort arrows
  ['pid','name','meetings'].forEach(col => {
    const el = document.getElementById('sort-' + col);
    if (el) el.textContent = '';
  });
  const keyToId = { id: 'pid', name: 'name', totalMeetings: 'meetings' };
  const arrowEl = document.getElementById('sort-' + keyToId[pSortKey]);
  if (arrowEl) arrowEl.textContent = pSortAsc ? ' ▲' : ' ▼';

  // Update count
  const countEl = document.getElementById('patients-count');
  if (countEl) countEl.textContent = `${data.length} patient${data.length !== 1 ? 's' : ''} found`;

  renderPatientsList(data);
}

// ── RENDER ───────────────────────────────────────────────────
function renderPatientsList(patients) {
  const tbody = document.getElementById('patients-tbody');
  if (!patients.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 24px; color: var(--text-muted);">No patients found.</td></tr>';
    return;
  }
  tbody.innerHTML = patients.map(p => `
    <tr>
      <td><div class="tkn-badge" style="background:#e0f2fe; color:#0284c7; white-space:nowrap;">${escHtml(p.id)}</div></td>
      <td><div class="pt-name">${escHtml(p.name)}</div></td>
      <td>${p.phone ? `<div class="pt-phone">📞 ${escHtml(p.phone)}</div>` : '<div class="pt-phone" style="opacity:0.5;">No phone</div>'}</td>
      <td><span style="font-weight:700">${p.totalMeetings || 0}</span></td>
    </tr>
  `).join('');
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showQRModal() {
  const qrUrl = window.location.origin + '/patient.html?clinicId=' + clinicId;
  document.getElementById('qr-img').src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrUrl)}`;
  const cidEl = document.getElementById('qr-clinic-id');
  if (cidEl) cidEl.textContent = 'Clinic ID: ' + clinicId;
  const qrLinkEl = document.getElementById('qr-link');
  if (qrLinkEl) qrLinkEl.href = qrUrl;
  const qrModal = document.getElementById('qr-modal');
  if (qrModal) qrModal.classList.remove('hidden');
}
