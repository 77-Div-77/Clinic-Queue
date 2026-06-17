// =============================================================
//  CLINIC QUEUE MANAGER — Main Server
//  Stack: Express + Socket.IO + MongoDB (Mongoose)
// =============================================================

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

// ── Models ────────────────────────────────────────────────────
const Patient = require('./models/Patient');
const Session = require('./models/Session');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Auth Endpoint ─────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === (process.env.ADMIN_PASSWORD || 'admin123')) {
    res.cookie('rcp_auth', '1', { maxAge: 24 * 60 * 60 * 1000, httpOnly: false });
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

// ── Protect Private Pages ─────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/receptionist.html' || req.path === '/history.html') {
    const cookieHeader = req.headers.cookie || '';
    if (!cookieHeader.includes('rcp_auth=1')) {
      return res.redirect('/?signin=1');
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

// ── In-memory state (single source of truth) ──────────────────
let state = {
  sessionId: null,
  queue: [],              
  currentToken: 0,        
  nextTokenCounter: 1,    
  waitSettings: {
    mode: 'auto', // 'auto' | 'manual'
    manualTimes: { normal: 10, emergency: 10, quick: 2 },
    durations: { normal: [], emergency: [], quick: [] }
  },
  totalServed: 0,
  consultStartTime: null, 
  lastCallTime: null,     
  previousToken: 0,       
  patientsDirectory: {},  // Map: patientId -> { id, key, name, phone }
  sessionDate: null
};

const STATUS_PRIORITY = {
  'waiting-emergency': 1,
  'quick-consult': 2,
  'on-hold': 3,
  'waiting': 4
};

function getPatientId(name, phone) {
  const key = `${name.toLowerCase().trim()}|${(phone || '').trim()}`;
  let found = Object.values(state.patientsDirectory).find(p => p.key === key);
  if (found) return found.id;
  const id = `PID-${Object.keys(state.patientsDirectory).length + 1001}`;
  state.patientsDirectory[id] = { id, key, name: name.trim(), phone: phone ? phone.trim() : '' };
  return id;
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, function(txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

function mockSendSMS(phone, message) {
  if (!phone) return;
  console.log(`[MOCK SMS] To ${phone}: ${message}`);
  io.emit('mock_sms_sent', { phone, message });
}

// ── Wait time helper ─────────────────────────────────────
function getAllottedMsForMode(patientType, mode) {
  const settings = state.waitSettings;
  const fallbackMin = patientType === 'quick' ? 2 : 10;
  
  if (mode === 'manual') {
    return (settings.manualTimes[patientType] || fallbackMin) * 60000;
  } else {
    const arr = settings.durations[patientType];
    if (arr.length >= 2) {
      const recent = arr.slice(-10);
      const sum = recent.reduce((a, b) => a + b, 0);
      return sum / recent.length;
    }
    return (settings.manualTimes[patientType] || fallbackMin) * 60000;
  }
}

function getPatientCategory(patient) {
  if (patient.isEmergency) return 'emergency';
  if (patient.isQuickConsult || patient.status === 'quick-consult') return 'quick';
  return 'normal';
}

// ── Wait time computation (per patient, server-side) ──────────
function computeWaitTimes() {
  const now = Date.now();
  let timeRemAuto = 0;
  let timeRemManual = 0;
  const inConsultPat = state.queue.find(p => p.status === 'in-consultation');

  if (state.consultStartTime && inConsultPat) {
    const elapsed = (inConsultPat.elapsedMs || 0) + (now - state.consultStartTime);
    const cat = getPatientCategory(inConsultPat);
    timeRemAuto = Math.max(60000, getAllottedMsForMode(cat, 'auto') - elapsed);
    timeRemManual = Math.max(60000, getAllottedMsForMode(cat, 'manual') - elapsed);
  }

  let aheadAuto = 0;
  let aheadManual = 0;
  
  const waitingPatients = state.queue
    .filter(p => STATUS_PRIORITY[p.status])
    .sort((a, b) => {
      const idxA = a.sortIndex !== null && a.sortIndex !== undefined ? a.sortIndex : 999999;
      const idxB = b.sortIndex !== null && b.sortIndex !== undefined ? b.sortIndex : 999999;
      if (idxA !== idxB) return idxA - idxB;

      const pA = STATUS_PRIORITY[a.status];
      const pB = STATUS_PRIORITY[b.status];
      if (pA !== pB) return pA - pB;

      return new Date(a.checkInTime) - new Date(b.checkInTime);
    });

  return waitingPatients.map((patient, idx) => {
    const cat = getPatientCategory(patient);
    const elapsed = patient.elapsedMs || 0;

    const waitMsAuto = timeRemAuto + aheadAuto;
    const patRemAuto = Math.max(60000, getAllottedMsForMode(cat, 'auto') - elapsed);
    aheadAuto += patRemAuto;
    const estWaitMinAuto = Math.ceil(waitMsAuto / 60000);

    const waitMsManual = timeRemManual + aheadManual;
    const patRemManual = Math.max(60000, getAllottedMsForMode(cat, 'manual') - elapsed);
    aheadManual += patRemManual;
    const estWaitMinManual = Math.ceil(waitMsManual / 60000);

    const isNext = (idx === 0 && !inConsultPat);

    return {
      ...patient,
      tokensAhead: idx,
      estWaitMinAuto,
      estWaitMinManual,
      isNext
    };
  });
}

// ── Build full state payload for broadcast ─────────────────────
function buildBroadcastPayload() {
  const enrichedWaiting = computeWaitTimes();
  const donePatients = state.queue.filter(p => p.status === 'done');
  const inConsult = state.queue.filter(p => p.status === 'in-consultation');

  // Update inConsult's elapsed time live for UI
  const liveInConsult = inConsult.map(p => ({
    ...p,
    liveElapsedMs: (p.elapsedMs || 0) + (state.consultStartTime ? Date.now() - state.consultStartTime : 0),
    allottedMs: getAllottedMsForMode(getPatientCategory(p), state.waitSettings.mode)
  }));

  const normalDurs = state.waitSettings.durations.normal || [];
  const emgDurs = state.waitSettings.durations.emergency || [];
  const quickDurs = state.waitSettings.durations.quick || [];
  const allDurs = [...normalDurs, ...emgDurs, ...quickDurs];
  
  const sampleCount = allDurs.length;
  let effectiveAvgMinutes = state.waitSettings.manualTimes.normal || 10;
  if (sampleCount >= 2) {
    effectiveAvgMinutes = Math.round(allDurs.reduce((a, b) => a + b, 0) / allDurs.length / 60000);
  }

  const nextPatient = enrichedWaiting[0];
  return {
    queue: enrichedWaiting,
    inConsultation: liveInConsult,
    done: donePatients,
    waitSettings: state.waitSettings,
    totalServed: state.totalServed,
    canUndo: !!state.lastCallTime && (Date.now() - state.lastCallTime <= 30000),
    currentToken: state.currentToken,
    nextToken: nextPatient ? nextPatient.token : null,
    serverTime: Date.now(),
    waitingCount: enrichedWaiting.length,
    consultStartTime: state.consultStartTime,
    effectiveAvgMinutes,
    sampleCount
  };
}

function broadcast() {
  io.emit('queue_update', buildBroadcastPayload());
}

// ── Persist to MongoDB (non-blocking) ─────────────────────────
async function persistToDb() {
  if (!state.sessionId || mongoose.connection.readyState !== 1) return;
  try {
    await Session.findByIdAndUpdate(state.sessionId, {
      currentToken: state.currentToken,
      nextTokenCounter: state.nextTokenCounter,
      waitSettings: state.waitSettings,
      totalServed: state.totalServed,
      consultStartTime: state.consultStartTime,
    });
    for (const p of state.queue) {
      await Patient.findOneAndUpdate(
        { sessionId: state.sessionId, token: p.token },
        p,
        { upsert: true, new: true }
      );
    }
  } catch (err) {
    console.warn('[DB] Persist failed:', err.message);
  }
}

// ── MongoDB connection ─────────────────────────────────────────
async function connectDb() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    console.log('[DB] Connected to MongoDB');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let session = await Session.findOne({ date: { $gte: today } });
    if (!session) {
      // Clear rolling averages for the new day
      state.waitSettings.durations = { normal: [], emergency: [], quick: [] };
      
      session = await Session.create({
        date: new Date(),
        waitSettings: state.waitSettings,
        currentToken: 0,
        nextTokenCounter: 1,
        totalServed: 0,
        consultStartTime: null,
      });
      console.log('[DB] New session created:', session._id);
      state.sessionDate = session.date;
    } else {
      state.sessionId = session._id;
      state.currentToken = session.currentToken;
      state.nextTokenCounter = session.nextTokenCounter;
      if (session.waitSettings) {
        state.waitSettings.mode = session.waitSettings.mode || 'auto';
        state.waitSettings.manualTimes = { ...state.waitSettings.manualTimes, ...(session.waitSettings.manualTimes || {}) };
        state.waitSettings.durations = { ...state.waitSettings.durations, ...(session.waitSettings.durations || {}) };
      }
      state.totalServed = session.totalServed;
      state.consultStartTime = session.consultStartTime;
      state.sessionDate = session.date;

      const patients = await Patient.find({ sessionId: session._id });
      state.queue = patients.map(p => p.toObject());
      
      // Build patients directory from queue
      state.queue.forEach(p => {
        if (!p.patientId) p.patientId = getPatientId(p.name, p.phone);
        else {
          const key = `${p.name.toLowerCase().trim()}|${(p.phone || '').trim()}`;
          state.patientsDirectory[p.patientId] = { id: p.patientId, key, name: p.name, phone: p.phone };
        }
      });
    }
    state.sessionId = session._id;
  } catch (err) {
    console.warn('[DB] MongoDB unavailable:', err.message);
  }
}

// ── Automatic Day Reset ─────────────────────────────────────────
async function checkAndResetDay() {
  if (!state.sessionDate) return;
  const now = new Date();
  
  if (state.sessionDate.getFullYear() === now.getFullYear() &&
      state.sessionDate.getMonth() === now.getMonth() &&
      state.sessionDate.getDate() === now.getDate()) {
    return; // Still the same day
  }
  
  console.log('[SYSTEM] Day changed. Resetting session...');
  
  // Reset state
  state.queue = [];
  state.currentToken = 0;
  state.nextTokenCounter = 1;
  state.totalServed = 0;
  state.consultStartTime = null;
  state.previousToken = 0;
  state.lastCallTime = null;
  state.sessionDate = now;

  // Clear rolling averages for the new day
  state.waitSettings.durations = { normal: [], emergency: [], quick: [] };

  try {
    const session = await Session.create({
      date: now,
      waitSettings: state.waitSettings,
      currentToken: 0,
      nextTokenCounter: 1,
      totalServed: 0,
      consultStartTime: null,
    });
    state.sessionId = session._id;
  } catch (e) {
    console.error('Failed to create new daily session:', e);
  }
  
  broadcast();
}
setInterval(checkAndResetDay, 60000);

// Live wait time ticker
setInterval(() => {
  if (state.queue.some(p => p.status === 'in-consultation')) {
    const times = computeWaitTimes().map(p => ({
      token: p.token,
      estWaitMinAuto: p.estWaitMinAuto,
      estWaitMinManual: p.estWaitMinManual,
      isNext: p.isNext
    }));
    io.emit('wait_time_tick', times);
  }
}, 10000);

// ── Socket.IO event handlers ───────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('queue_update', buildBroadcastPayload());

  socket.on('add_patient', (data) => {
    let { name, phone } = data;
    if (!name || !name.trim()) return;
    name = toTitleCase(name.trim());

    const patientId = getPatientId(name, phone);
    const existing = state.queue.filter(p => p.patientId === patientId);
    
    if (existing.some(p => p.status !== 'done')) {
      socket.emit('error_event', { message: 'Patient is already in the queue or in consultation.' });
      return;
    }
    
    const token = state.nextTokenCounter++;
    const patient = {
      token, patientId, name: name.trim(), phone: phone ? phone.trim() : '',
      status: 'waiting', checkInTime: new Date().toISOString(),
      consultStartTime: null, consultEndTime: null, elapsedMs: 0,
      isQuickConsult: false, sortIndex: null,
      meetingsToday: existing.length + 1, sessionId: state.sessionId,
    };
    state.queue.push(patient);
    persistToDb();
    broadcast();
    socket.emit('patient_added', { token, name: patient.name });
    mockSendSMS(patient.phone, `ClinicQ: You are added to the queue! Your token is #${token}. Check status live here: ${process.env.APP_URL || 'http://localhost:3000'}/patient.html`);
  });

  socket.on('add_emergency', (data) => {
    let { name, phone } = data;
    if (!name || !name.trim()) return;
    name = toTitleCase(name.trim());

    const patientId = getPatientId(name, phone);
    const existing = state.queue.filter(p => p.patientId === patientId);
    
    if (existing.some(p => p.status !== 'done')) {
      socket.emit('error_event', { message: 'Patient is already in the queue or in consultation.' });
      return;
    }
    
    const token = state.nextTokenCounter++;
    const patient = {
      token, patientId, name: name.trim(), phone: phone ? phone.trim() : '',
      status: 'in-consultation', checkInTime: new Date().toISOString(),
      consultStartTime: new Date().toISOString(), consultEndTime: null,
      elapsedMs: 0, isEmergency: true, sortIndex: -1,
      meetingsToday: existing.length + 1, sessionId: state.sessionId,
    };

    const currentInConsult = state.queue.find(p => p.status === 'in-consultation');
    if (currentInConsult) {
      currentInConsult.elapsedMs = (currentInConsult.elapsedMs || 0) + (Date.now() - state.consultStartTime);
      if (currentInConsult.isEmergency) {
        patient.status = 'waiting-emergency';
        patient.consultStartTime = null;
        state.queue.push(patient);
        persistToDb();
        broadcast();
        socket.emit('patient_added', { token, name: patient.name });
        return;
      } else {
        currentInConsult.status = 'on-hold';
        currentInConsult.consultStartTime = null;
      }
    }

    state.previousToken = state.currentToken;
    state.lastCallTime = Date.now();
    state.queue.push(patient);
    state.currentToken = token;
    state.consultStartTime = Date.now();
    persistToDb();
    broadcast();
    socket.emit('patient_added', { token, name: patient.name });
  });

  socket.on('add_quick_consult', (data) => {
    let { name, phone } = data;
    if (!name || !name.trim()) return;
    name = toTitleCase(name.trim());

    const patientId = getPatientId(name, phone);
    const existing = state.queue.filter(p => p.patientId === patientId);
    
    if (existing.some(p => p.status !== 'done')) {
      socket.emit('error_event', { message: 'Patient is already in the queue or in consultation.' });
      return;
    }
    
    const token = state.nextTokenCounter++;
    const patient = {
      token, patientId, name: name.trim(), phone: phone ? phone.trim() : '',
      status: 'quick-consult', checkInTime: new Date().toISOString(),
      consultStartTime: null, consultEndTime: null, elapsedMs: 0,
      isQuickConsult: true, sortIndex: null,
      meetingsToday: existing.length + 1, sessionId: state.sessionId,
    };
    state.queue.push(patient);
    persistToDb();
    broadcast();
    socket.emit('patient_added', { token, name: patient.name });
  });

  socket.on('quick_consult', (data) => {
    const { token } = data;
    const oldPat = state.queue.find(p => p.token === token);
    if (!oldPat || oldPat.status !== 'done') return;

    const existing = state.queue.filter(p => p.patientId === oldPat.patientId);
    if (existing.some(p => p.status !== 'done')) {
      socket.emit('error_event', { message: 'Patient is already in the queue or in consultation.' });
      return;
    }

    const newToken = state.nextTokenCounter++;
    
    const patient = {
      token: newToken,
      patientId: oldPat.patientId,
      name: oldPat.name,
      phone: oldPat.phone,
      status: 'quick-consult',
      checkInTime: new Date().toISOString(),
      consultStartTime: null,
      consultEndTime: null,
      elapsedMs: 0,
      isQuickConsult: true,
      sortIndex: 0,
      meetingsToday: existing.length + 1,
      sessionId: state.sessionId,
    };
    state.queue.push(patient);
    persistToDb();
    broadcast();
  });

  socket.on('reorder_queue', (data) => {
    const { orderedTokens } = data;
    orderedTokens.forEach((token, idx) => {
      const p = state.queue.find(x => x.token === token);
      if (p) p.sortIndex = idx;
    });
    // For anyone not explicitly ordered but in waiting, reset their sort index so they fall back to priority
    state.queue.forEach(p => {
        if (!orderedTokens.includes(p.token) && STATUS_PRIORITY[p.status]) {
            p.sortIndex = null;
        }
    });
    persistToDb();
    broadcast();
  });

  socket.on('swap_consultation', (data) => {
    const { token } = data;
    const targetPat = state.queue.find(p => p.token === token);
    const currentInConsult = state.queue.find(p => p.status === 'in-consultation');
    
    if (!targetPat || targetPat.status === 'done' || targetPat.status === 'in-consultation') return;

    if (currentInConsult) {
      currentInConsult.elapsedMs = (currentInConsult.elapsedMs || 0) + (Date.now() - state.consultStartTime);
      currentInConsult.status = 'on-hold';
      currentInConsult.consultStartTime = null;
    }

    targetPat.status = 'in-consultation';
    targetPat.consultStartTime = new Date().toISOString();
    
    state.previousToken = state.currentToken;
    state.currentToken = targetPat.token;
    state.consultStartTime = Date.now();
    
    persistToDb();
    broadcast();
  });

  socket.on('call_next', () => {
    const waitingPatients = state.queue
      .filter(p => STATUS_PRIORITY[p.status])
      .sort((a, b) => {
        const idxA = a.sortIndex !== null && a.sortIndex !== undefined ? a.sortIndex : 999999;
        const idxB = b.sortIndex !== null && b.sortIndex !== undefined ? b.sortIndex : 999999;
        if (idxA !== idxB) return idxA - idxB;

        const pA = STATUS_PRIORITY[a.status];
        const pB = STATUS_PRIORITY[b.status];
        if (pA !== pB) return pA - pB;

        return new Date(a.checkInTime) - new Date(b.checkInTime);
      });

    const nextPatient = waitingPatients[0];
    if (!nextPatient) return;

    const currentInConsult = state.queue.find(p => p.status === 'in-consultation');
    if (currentInConsult) {
      currentInConsult.status = 'done';
      currentInConsult.consultEndTime = new Date().toISOString();
      currentInConsult.elapsedMs = (currentInConsult.elapsedMs || 0) + (Date.now() - state.consultStartTime);
      
      if (currentInConsult.elapsedMs > 0) {
        const cat = getPatientCategory(currentInConsult);
        state.waitSettings.durations[cat].push(currentInConsult.elapsedMs);
        if (state.waitSettings.durations[cat].length > 20) state.waitSettings.durations[cat].shift();
      }
      state.totalServed++;
    }

    state.previousToken = state.currentToken;
    state.lastCallTime = Date.now();

    nextPatient.status = 'in-consultation';
    nextPatient.consultStartTime = new Date().toISOString();
    state.currentToken = nextPatient.token;
    state.consultStartTime = Date.now();

    persistToDb();
    broadcast();
    mockSendSMS(nextPatient.phone, `ClinicQ: It's your turn! Please proceed to the doctor.`);
    
    // Also check who is next
    const waitingAfter = waitingPatients[1];
    if (waitingAfter) {
      mockSendSMS(waitingAfter.phone, `ClinicQ: You are next in line! Please be ready.`);
    }
  });

  socket.on('mark_done', (data) => {
    const { token } = data;
    const patient = state.queue.find(p => p.token === token);
    if (!patient || patient.status === 'done') return;

    const wasInConsult = patient.status === 'in-consultation';
    patient.status = 'done';
    patient.consultEndTime = new Date().toISOString();

    if (wasInConsult) {
      patient.elapsedMs = (patient.elapsedMs || 0) + (Date.now() - state.consultStartTime);
      if (patient.elapsedMs > 0) {
        const cat = getPatientCategory(patient);
        state.waitSettings.durations[cat].push(patient.elapsedMs);
        if (state.waitSettings.durations[cat].length > 20) state.waitSettings.durations[cat].shift();
      }
      state.totalServed++;
      state.previousToken = patient.token;
      state.currentToken = 0;
      state.consultStartTime = null;
      state.lastCallTime = Date.now();
    }
    persistToDb();
    broadcast();
  });

  socket.on('undo_call', () => {
    if (!state.lastCallTime || (Date.now() - state.lastCallTime > 30000)) return;

    const currentPatient = state.queue.find(p => p.status === 'in-consultation');
    if (currentPatient) {
      if (currentPatient.isEmergency) {
        currentPatient.status = 'waiting-emergency';
      } else if (currentPatient.elapsedMs > 0) {
        currentPatient.status = 'quick-consult'; 
        currentPatient.isQuickConsult = true;
      } else {
        currentPatient.status = 'waiting';
      }
      currentPatient.consultStartTime = null;
    }

    if (state.previousToken > 0) {
      const prevPatient = state.queue.find(p => p.token === state.previousToken);
      if (prevPatient) {
        prevPatient.status = 'in-consultation';
        prevPatient.consultEndTime = null;
        prevPatient.consultStartTime = new Date().toISOString();
        state.totalServed = Math.max(0, state.totalServed - 1);
        
        if (prevPatient.elapsedMs > 0) {
          const cat = getPatientCategory(prevPatient);
          const arr = state.waitSettings.durations[cat];
          const idx = arr.lastIndexOf(prevPatient.elapsedMs);
          if (idx !== -1) arr.splice(idx, 1);
        }
      }
    }

    state.currentToken = state.previousToken;
    state.consultStartTime = Date.now(); 
    state.lastCallTime = null;

    persistToDb();
    broadcast();
  });

  socket.on('remove_patient', (data) => {
    const { token } = data;
    const idx = state.queue.findIndex(p => p.token === token && STATUS_PRIORITY[p.status]);
    if (idx !== -1) {
      state.queue.splice(idx, 1);
      persistToDb();
      broadcast();
    }
  });

  // Update Wait Settings from Receptionist
  socket.on('save_manual_times', (data) => {
    state.waitSettings.manualTimes = data.manualTimes;
    persistToDb();
    broadcast();
  });

  socket.on('set_global_wait_mode', (data) => {
    state.waitSettings.mode = data.mode;
    persistToDb();
    broadcast();
  });

  socket.on('lookup_token', (data) => {
    const { token } = data;
    const waitingList = computeWaitTimes();
    const found = waitingList.find(p => p.token === Number(token));
    if (found) {
      socket.emit('token_status', { found: true, patient: found });
    } else {
      const donePat = state.queue.find(p => p.token === Number(token) && p.status === 'done');
      const inConsult = state.queue.find(p => p.token === Number(token) && p.status === 'in-consultation');
      if (inConsult) {
        socket.emit('token_status', { found: true, status: 'in-consultation', message: "You're being seen now!" });
      } else if (donePat) {
        socket.emit('token_status', { found: true, status: 'done', message: 'Your consultation is complete.' });
      } else {
        socket.emit('token_status', { found: false, message: 'Token not found in today\'s queue.' });
      }
    }
  });

  socket.on('get_history', async (data, cb) => {
    try {
      const start = new Date(data.date); start.setHours(0,0,0,0);
      const end = new Date(data.date); end.setHours(23,59,59,999);
      const session = await Session.findOne({ date: { $gte: start, $lte: end } });
      if (!session) return cb({ done: [] });
      const pts = await Patient.find({ sessionId: session._id, status: 'done' }).sort({ consultEndTime: -1 });
      cb({ done: pts.map(p => p.toObject()) });
    } catch (e) {
      cb({ done: [] });
    }
  });

  socket.on('get_all_patients', async (cb) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return cb(Object.values(state.patientsDirectory).map(p => ({
          ...p,
          totalMeetings: state.queue.filter(q => q.patientId === p.id).length
        })));
      }
      
      const results = await Patient.aggregate([
        {
          $group: {
            _id: "$patientId",
            name: { $last: "$name" },
            phone: { $last: "$phone" },
            totalMeetings: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);
      
      const dir = results.map(r => ({
        id: r._id,
        name: r.name,
        phone: r.phone,
        totalMeetings: r.totalMeetings
      }));
      cb(dir);
    } catch (e) {
      console.warn('Failed to fetch patients directory', e);
      cb([]);
    }
  });

  socket.on('disconnect', () => {});

  socket.on('send_daily_report', async (data) => {
    const { date } = data;
    console.log(`[MOCK EMAIL] Sending daily report for ${date} to manager@clinic.com...`);
    socket.emit('report_sent', { message: `Email report sent to manager@clinic.com!` });
  });
});

// ── REST endpoint — History by Date ───────────────────────────
app.get('/api/history', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.json([]);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const session = await Session.findOne({ date: { $gte: startOfDay, $lte: endOfDay } });
    if (!session) return res.json([]);

    const patients = await Patient.find({ sessionId: session._id, status: 'done' }).sort({ consultEndTime: -1 });
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
connectDb().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🏥 Clinic Queue Server running on http://localhost:${PORT}`);
  });
});
