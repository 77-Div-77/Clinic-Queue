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
  const d = new Date();
  const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  document.getElementById('history-date').value = today;
  if (clinicId) {
    loadHistory(today);
  }
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

function sendDailyReport() {
  const dateStr = document.getElementById('history-date').value;
  socket.emit('send_daily_report', { date: dateStr });
}

socket.on('report_sent', (data) => {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast toast--success';
  let msg = data.message;
  if (data.detail) msg += `\n${data.detail}`;
  if (data.attachments && data.attachments.length) msg += `\nAttachments: ${data.attachments.join(', ')}`;
  t.textContent = msg;
  t.style.whiteSpace = 'pre-line';
  c.appendChild(t);
  setTimeout(() => t.remove(), 5000);
});

// ── Export Range ──────────────────────────────────────────────
function exportRange() {
  const from = document.getElementById('export-from').value;
  const to   = document.getElementById('export-to').value;
  if (!from || !to) { alert('Please select both From and To dates.'); return; }
  if (new Date(from) > new Date(to)) { alert('From date must be before To date.'); return; }
  showToastMsg('⏳ Generating export…', 'info');
  socket.emit('export_range', { from, to });
}

socket.on('export_ready', (data) => {
  // Download XLSX
  const xlsxBlob = b64toBlob(data.xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  triggerDownload(xlsxBlob, data.xlsxName);
  // Download PDF
  const pdfBlob = b64toBlob(data.pdf, 'application/pdf');
  triggerDownload(pdfBlob, data.pdfName);
  showToastMsg(`✅ Downloaded: ${data.xlsxName} & ${data.pdfName}`, 'success');
});

function b64toBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function showToastMsg(msg, type='success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── Master Log (all history via SheetJS) ────────────────────────
function appendMasterLog() {
  showToastMsg('⏳ Fetching all records for Master Log…', 'info');
  socket.emit('get_all_history', (records) => {
    if (!records || records.length === 0) { showToastMsg('⚠️ No records found.', 'error'); return; }
    // Group by date
    const grouped = {};
    records.forEach(r => {
      const day = r.checkInTime ? new Date(r.checkInTime).toLocaleDateString('en-IN') : 'Unknown';
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push(r);
    });
    const wb = XLSX.utils.book_new();
    Object.entries(grouped).forEach(([day, rows]) => {
      const sheetName = day.replace(/\//g, '-').substring(0, 31);
      const data = [['Token','Name','Phone','Arrival','Departure','Duration (min)']];
      rows.forEach(r => {
        const fmt = (iso) => iso ? new Date(iso).toLocaleString('en-IN') : '—';
        const mins = r.elapsedMs ? (r.elapsedMs/60000).toFixed(1) : '—';
        data.push([r.token, r.name, r.phone||'—', fmt(r.checkInTime), fmt(r.consultEndTime), mins]);
      });
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });
    const today = new Date().toLocaleDateString('en-IN').replace(/\//g,'-');
    XLSX.writeFile(wb, `ClinicQ_MasterLog_${today}.xlsx`);
    showToastMsg(`✅ Master Log downloaded — ${records.length} records across ${Object.keys(grouped).length} days.`, 'success');
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

  updateHistoryStats(data);

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

// ── STATS ────────────────────────────────────────────────────
function updateHistoryStats(dataArray) {
  const total = dataArray.length;
  document.getElementById('h-kpi-total').textContent = total;

  if (total === 0) {
    document.getElementById('h-kpi-avg').textContent = '—';
    document.getElementById('h-kpi-peak').textContent = '—';
    return;
  }

  let totalMs = 0;
  const hourCounts = {};

  dataArray.forEach(p => {
    if (p.elapsedMs) totalMs += p.elapsedMs;
    if (p.checkInTime) {
      const h = new Date(p.checkInTime).getHours();
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    }
  });

  const avgMs = totalMs / total;
  const m = Math.floor(avgMs / 60000);
  const s = Math.floor((avgMs % 60000) / 1000);
  document.getElementById('h-kpi-avg').textContent = `${m}m ${s}s`;

  let peakHour = -1;
  let maxCount = -1;
  for (const [h, count] of Object.entries(hourCounts)) {
    if (count > maxCount) { maxCount = count; peakHour = parseInt(h); }
  }

  if (peakHour !== -1) {
    const ampm = peakHour >= 12 ? 'PM' : 'AM';
    let h12 = peakHour % 12;
    if (h12 === 0) h12 = 12;
    document.getElementById('h-kpi-peak').textContent = `${h12} ${ampm} (${maxCount} pts)`;
  } else {
    document.getElementById('h-kpi-peak').textContent = '—';
  }
}
