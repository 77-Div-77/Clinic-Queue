// =============================================================
//  CLINIC QUEUE MANAGER — Main Server
//  Stack: Express + Socket.IO + MongoDB (Mongoose)
//  Falls back to pure in-memory if MongoDB is unavailable
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
app.use(express.static(path.join(__dirname, '../public')));

// ── In-memory state (single source of truth) ──────────────────
let state = {
  sessionId: null,
  queue: [],              // Array of patient objects (waiting + in-consultation)
  currentToken: 0,        // Token currently being seen (0 = nobody yet)
  nextTokenCounter: 1,    // Next token to assign
  avgConsultMinutes: 10,  // Receptionist-configurable
  consultDurations: [],   // Actual durations in ms for rolling average
  totalServed: 0,
  consultStartTime: null, // When current consultation started
  lastCallTime: null,     // For undo window
  previousToken: 0,       // Token before last call (for undo)
};

// ── Rolling average helper ─────────────────────────────────────
function computeEffectiveAvgMs() {
  const { consultDurations, avgConsultMinutes } = state;
  if (consultDurations.length >= 2) {
    const recent = consultDurations.slice(-10); // last 10 consultations max
    const sum = recent.reduce((a, b) => a + b, 0);
    return sum / recent.length; // divide by actual slice length — correct rolling avg
  }
  return avgConsultMinutes * 60 * 1000; // fallback to manually set value
}

// ── Wait time computation (per patient, server-side) ──────────
function computeWaitTimes() {
  const effectiveAvgMs = computeEffectiveAvgMs();
  const now = Date.now();

  // Time remaining for the patient currently in consultation
  let timeRemainingForCurrent = 0;
  if (state.consultStartTime && state.currentToken > 0) {
    const elapsed = now - state.consultStartTime;
    timeRemainingForCurrent = Math.max(0, effectiveAvgMs - elapsed);
  }

  let ahead = 0;
  const waitingPatients = state.queue.filter(p => p.status === 'waiting');

  return waitingPatients.map((patient, idx) => {
    const waitMs = timeRemainingForCurrent + (ahead * effectiveAvgMs);
    ahead++;
    const waitMin = Math.ceil(waitMs / 60000);
    return {
      ...patient,
      tokensAhead: idx,
      estimatedWaitMin: waitMin,
    };
  });
}

// ── Build full state payload for broadcast ─────────────────────
function buildBroadcastPayload() {
  const effectiveAvgMs = computeEffectiveAvgMs();
  const enrichedWaiting = computeWaitTimes();
  const donePatients = state.queue.filter(p => p.status === 'done');
  const inConsult = state.queue.filter(p => p.status === 'in-consultation');

  // Next token to be called
  const nextPatient = state.queue.find(p => p.status === 'waiting');

  return {
    currentToken: state.currentToken,
    nextToken: nextPatient ? nextPatient.token : null,
    avgConsultMinutes: state.avgConsultMinutes,
    effectiveAvgMinutes: Math.round(effectiveAvgMs / 60000 * 10) / 10,
    consultStartTime: state.consultStartTime,
    totalServed: state.totalServed,
    waitingCount: enrichedWaiting.length,
    queue: enrichedWaiting,
    inConsultation: inConsult,
    done: donePatients,
    canUndo: state.lastCallTime && (Date.now() - state.lastCallTime < 30000),
    sampleCount: state.consultDurations.length,
  };
}

// ── Broadcast to all clients ───────────────────────────────────
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
      avgConsultMinutes: state.avgConsultMinutes,
      consultDurations: state.consultDurations,
      totalServed: state.totalServed,
      consultStartTime: state.consultStartTime,
    });
    // Upsert all patients
    for (const p of state.queue) {
      await Patient.findOneAndUpdate(
        { sessionId: state.sessionId, token: p.token },
        p,
        { upsert: true, new: true }
      );
    }
  } catch (err) {
    console.warn('[DB] Persist failed (non-fatal):', err.message);
  }
}

// ── MongoDB connection (optional — graceful fallback) ──────────
async function connectDb() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    console.log('[DB] Connected to MongoDB');

    // Rehydrate today's session if exists
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let session = await Session.findOne({ date: { $gte: today } });
    if (!session) {
      session = await Session.create({
        date: new Date(),
        avgConsultMinutes: 10,
        currentToken: 0,
        nextTokenCounter: 1,
        consultDurations: [],
        totalServed: 0,
        consultStartTime: null,
      });
      console.log('[DB] New session created:', session._id);
    } else {
      // Rehydrate state from DB
      state.sessionId = session._id;
      state.currentToken = session.currentToken;
      state.nextTokenCounter = session.nextTokenCounter;
      state.avgConsultMinutes = session.avgConsultMinutes;
      state.consultDurations = session.consultDurations;
      state.totalServed = session.totalServed;
      state.consultStartTime = session.consultStartTime;

      const patients = await Patient.find({ sessionId: session._id });
      state.queue = patients.map(p => p.toObject());
      console.log(`[DB] Rehydrated session with ${patients.length} patients`);
    }
    state.sessionId = session._id;
  } catch (err) {
    console.warn('[DB] MongoDB unavailable — running in pure in-memory mode:', err.message);
  }
}

// ── Socket.IO event handlers ───────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Send current state immediately to new connection
  socket.emit('queue_update', buildBroadcastPayload());

  // ── ADD PATIENT ──────────────────────────────────────────────
  socket.on('add_patient', (data) => {
    const { name, phone } = data;
    if (!name || !name.trim()) {
      socket.emit('error_event', { message: 'Patient name is required' });
      return;
    }

    const token = state.nextTokenCounter++;
    const patient = {
      token,
      name: name.trim(),
      phone: phone ? phone.trim() : '',
      status: 'waiting',
      checkInTime: new Date().toISOString(),
      consultStartTime: null,
      consultEndTime: null,
      sessionId: state.sessionId,
    };

    state.queue.push(patient);
    console.log(`[Q] Added patient: Token #${token} — ${patient.name}`);

    persistToDb();
    broadcast();

    // Acknowledge to receptionist with token number
    socket.emit('patient_added', { token, name: patient.name });
  });

  // ── CALL NEXT ────────────────────────────────────────────────
  socket.on('call_next', () => {
    const nextPatient = state.queue.find(p => p.status === 'waiting');
    if (!nextPatient) {
      socket.emit('error_event', { message: 'No patients waiting in queue' });
      return;
    }

    // Mark current in-consultation patient as done
    const currentInConsult = state.queue.find(p => p.status === 'in-consultation');
    if (currentInConsult) {
      currentInConsult.status = 'done';
      currentInConsult.consultEndTime = new Date().toISOString();

      // Record actual consultation duration for rolling average
      if (state.consultStartTime) {
        const duration = Date.now() - state.consultStartTime;
        state.consultDurations.push(duration);
        if (state.consultDurations.length > 20) state.consultDurations.shift(); // keep last 20
      }
      state.totalServed++;
    }

    // Save undo snapshot
    state.previousToken = state.currentToken;
    state.lastCallTime = Date.now();

    // Advance to next patient
    nextPatient.status = 'in-consultation';
    nextPatient.consultStartTime = new Date().toISOString();
    state.currentToken = nextPatient.token;
    state.consultStartTime = Date.now();

    console.log(`[Q] Called token #${state.currentToken} — ${nextPatient.name}`);

    persistToDb();
    broadcast();
  });

  // ── MARK DONE (manual) ───────────────────────────────────────
  socket.on('mark_done', (data) => {
    const { token } = data;
    const patient = state.queue.find(p => p.token === token);
    if (!patient || patient.status === 'done') {
      socket.emit('error_event', { message: 'Patient not found or already done' });
      return;
    }

    const wasInConsult = patient.status === 'in-consultation';
    patient.status = 'done';
    patient.consultEndTime = new Date().toISOString();

    if (wasInConsult) {
      if (state.consultStartTime) {
        const duration = Date.now() - state.consultStartTime;
        state.consultDurations.push(duration);
        if (state.consultDurations.length > 20) state.consultDurations.shift();
      }
      state.totalServed++;
      state.currentToken = 0;
      state.consultStartTime = null;
    }

    console.log(`[Q] Marked done: Token #${token}`);
    persistToDb();
    broadcast();
  });

  // ── SET AVG CONSULT TIME ─────────────────────────────────────
  socket.on('set_avg_time', (data) => {
    const minutes = parseFloat(data.minutes);
    if (isNaN(minutes) || minutes < 1 || minutes > 120) {
      socket.emit('error_event', { message: 'Average time must be between 1 and 120 minutes' });
      return;
    }
    state.avgConsultMinutes = minutes;
    console.log(`[Q] Avg consult time set to ${minutes} min`);
    persistToDb();
    broadcast();
  });

  // ── UNDO LAST CALL (30-second window) ───────────────────────
  socket.on('undo_call', () => {
    if (!state.lastCallTime || (Date.now() - state.lastCallTime > 30000)) {
      socket.emit('error_event', { message: 'Undo window expired (30 seconds)' });
      return;
    }

    // Revert current patient back to waiting
    const currentPatient = state.queue.find(p => p.status === 'in-consultation');
    if (currentPatient) {
      currentPatient.status = 'waiting';
      currentPatient.consultStartTime = null;
    }

    // Revert previous done patient to in-consultation if it was the prior token
    if (state.previousToken > 0) {
      const prevPatient = state.queue.find(p => p.token === state.previousToken);
      if (prevPatient && prevPatient.status === 'done') {
        prevPatient.status = 'in-consultation';
        prevPatient.consultEndTime = null;
        state.totalServed = Math.max(0, state.totalServed - 1);
        if (state.consultDurations.length > 0) state.consultDurations.pop();
      }
    }

    state.currentToken = state.previousToken;
    state.consultStartTime = state.lastCallTime - (state.avgConsultMinutes * 60000 * 0.5);
    state.lastCallTime = null;

    console.log(`[Q] Undo last call — reverted to token #${state.currentToken}`);
    persistToDb();
    broadcast();
  });

  // ── REMOVE PATIENT ───────────────────────────────────────────
  socket.on('remove_patient', (data) => {
    const { token } = data;
    const idx = state.queue.findIndex(p => p.token === token && p.status === 'waiting');
    if (idx === -1) {
      socket.emit('error_event', { message: 'Patient not found or cannot be removed' });
      return;
    }
    const removed = state.queue.splice(idx, 1)[0];
    console.log(`[Q] Removed patient: Token #${removed.token} — ${removed.name}`);
    persistToDb();
    broadcast();
  });

  // ── GET PATIENT STATUS (for patient self-lookup) ─────────────
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

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// ── REST endpoint — health check ──────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    dbConnected: mongoose.connection.readyState === 1,
    queueLength: state.queue.filter(p => p.status === 'waiting').length,
    currentToken: state.currentToken,
    uptime: process.uptime(),
  });
});

// ── REST endpoint — full state snapshot ───────────────────────
app.get('/api/state', (req, res) => {
  res.json(buildBroadcastPayload());
});

// ── Boot ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
connectDb().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🏥 Clinic Queue Server running on http://localhost:${PORT}`);
    console.log(`   Receptionist: http://localhost:${PORT}/receptionist.html`);
    console.log(`   Patient View: http://localhost:${PORT}/patient.html\n`);
  });
});
