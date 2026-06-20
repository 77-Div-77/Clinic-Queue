// =============================================================
//  CLINIC QUEUE MANAGER — SaaS Main Server
//  Stack: Express + Socket.IO + MongoDB (Mongoose) + JWT
// =============================================================

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } catch(e) { console.error('Twilio init failed', e); }
}

// ── Models ────────────────────────────────────────────────────
const Patient = require('./models/Patient');
const Session = require('./models/Session');
const Clinic = require('./models/Clinic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Auth Endpoints ─────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'clinic-super-secret-key-123';

app.post('/api/register', async (req, res) => {
  const { clinicName, username, email, password } = req.body;
  try {
    if (password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    if (!/[A-Z]/.test(password)) return res.status(400).json({ success: false, message: 'Password must contain at least one uppercase letter.' });
    if (!/[a-z]/.test(password)) return res.status(400).json({ success: false, message: 'Password must contain at least one lowercase letter.' });
    if (!/[0-9]/.test(password)) return res.status(400).json({ success: false, message: 'Password must contain at least one number.' });
    if (!/[^A-Za-z0-9]/.test(password)) return res.status(400).json({ success: false, message: 'Password must contain at least one special symbol.' });

    const existingUser = await Clinic.findOne({ username: username.toLowerCase() });
    if (existingUser) return res.status(400).json({ success: false, message: 'Username already taken.' });
    
    const existingEmail = await Clinic.findOne({ email: email.trim() });
    if (existingEmail) return res.status(400).json({ success: false, message: 'Email address already registered.' });
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    
    const clinic = await Clinic.create({
      name: clinicName,
      username: username.toLowerCase(),
      email,
      password: hash
    });
    
    // Auto login
    const token = jwt.sign({ clinicId: clinic._id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('rcp_auth', token, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false });
    res.json({ success: true, clinicId: clinic._id });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // Backwards compatibility for single-tenant users who just enter password
    if (!username && password) {
      const defaultClinic = await Clinic.findOne();
      if (!defaultClinic) return res.status(401).json({ success: false, message: 'No clinic found. Please register first.' });
      const isMatch = await bcrypt.compare(password, defaultClinic.password);
      // Also allow legacy ADMIN_PASSWORD
      if (isMatch || password === (process.env.ADMIN_PASSWORD || 'admin123')) {
        const token = jwt.sign({ clinicId: defaultClinic._id }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('rcp_auth', token, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false });
        return res.json({ success: true, clinicId: defaultClinic._id });
      }
    }

    const clinic = await Clinic.findOne({ 
      $or: [
        { username: username.toLowerCase() },
        { email: username.toLowerCase() }
      ]
    });
    if (!clinic) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    
    const isMatch = await bcrypt.compare(password, clinic.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    
    const token = jwt.sign({ clinicId: clinic._id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('rcp_auth', token, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: false });
    res.json({ success: true, clinicId: clinic._id });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('rcp_auth');
  res.json({ success: true });
});

app.get('/api/me', async (req, res) => {
  try {
    const token = req.cookies.rcp_auth;
    if (!token) return res.json({ loggedIn: false });
    const decoded = jwt.verify(token, JWT_SECRET);
    const clinic = await Clinic.findById(decoded.clinicId);
    if (!clinic) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, clinic: { id: clinic._id, name: clinic.name, email: clinic.email } });
  } catch(e) {
    res.json({ loggedIn: false });
  }
});

// ── Protect Private Pages ─────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/receptionist.html' || req.path === '/history.html') {
    const token = req.cookies.rcp_auth;
    if (!token) return res.redirect('/?signin=1');
    try {
      jwt.verify(token, JWT_SECRET);
    } catch(e) {
      return res.redirect('/?signin=1');
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

const STATUS_PRIORITY = {
  'waiting-emergency': 1,
  'quick-consult': 2,
  'on-hold': 3,
  'waiting': 4
};

function toTitleCase(str) {
  return str.replace(/\w\S*/g, function(txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
  });
}

async function sendSMS(phone, message) {
  if (!phone) return;
  const formattedPhone = phone.startsWith('+') ? phone : '+' + phone;
  
  if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
    try {
      await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedPhone
      });
      console.log(`[TWILIO SMS] Sent to ${formattedPhone}`);
      io.emit('mock_sms_sent', { phone: formattedPhone, message }); // Broadcast to all for UI toast
    } catch(err) {
      console.error(`[TWILIO ERROR]`, err);
    }
  } else {
    console.log(`[MOCK SMS] To ${formattedPhone}: ${message}`);
    io.emit('mock_sms_sent', { phone: formattedPhone, message });
  }
}

// ── ClinicQueue Class (Multi-Tenant State) ────────────────────
class ClinicQueue {
  constructor(clinicId, clinicEmail) {
    this.clinicId = clinicId;
    this.clinicEmail = clinicEmail;
    this.state = {
      sessionId: null,
      queue: [],              
      currentToken: 0,        
      nextTokenCounter: 1,    
      waitSettings: {
        mode: 'auto',
        manualTimes: { normal: 10, emergency: 10, quick: 2 },
        durations: { normal: [], emergency: [], quick: [] }
      },
      totalServed: 0,
      consultStartTime: null, 
      lastCallTime: null,     
      previousToken: 0,       
      patientsDirectory: {},
      sessionDate: null
    };
  }

  getPatientId(name, phone) {
    const key = `${name.toLowerCase().trim()}|${(phone || '').trim()}`;
    let found = Object.values(this.state.patientsDirectory).find(p => p.key === key);
    if (found) return found.id;
    const id = `PID-${Object.keys(this.state.patientsDirectory).length + 1001}`;
    this.state.patientsDirectory[id] = { id, key, name: name.trim(), phone: phone ? phone.trim() : '' };
    return id;
  }

  getAllottedMsForMode(patientType, mode) {
    const settings = this.state.waitSettings;
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

  getPatientCategory(patient) {
    if (patient.isEmergency) return 'emergency';
    if (patient.isQuickConsult || patient.status === 'quick-consult') return 'quick';
    return 'normal';
  }

  computeWaitTimes() {
    const now = Date.now();
    let timeRemAuto = 0;
    let timeRemManual = 0;
    const inConsultPat = this.state.queue.find(p => p.status === 'in-consultation');

    if (this.state.consultStartTime && inConsultPat) {
      const elapsed = (inConsultPat.elapsedMs || 0) + (now - this.state.consultStartTime);
      const cat = this.getPatientCategory(inConsultPat);
      timeRemAuto = Math.max(60000, this.getAllottedMsForMode(cat, 'auto') - elapsed);
      timeRemManual = Math.max(60000, this.getAllottedMsForMode(cat, 'manual') - elapsed);
    }

    let aheadAuto = 0;
    let aheadManual = 0;
    
    const waitingPatients = this.state.queue
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
      const cat = this.getPatientCategory(patient);
      const elapsed = patient.elapsedMs || 0;

      const waitMsAuto = timeRemAuto + aheadAuto;
      const patRemAuto = Math.max(60000, this.getAllottedMsForMode(cat, 'auto') - elapsed);
      aheadAuto += patRemAuto;
      const estWaitMinAuto = Math.ceil(waitMsAuto / 60000);

      const waitMsManual = timeRemManual + aheadManual;
      const patRemManual = Math.max(60000, this.getAllottedMsForMode(cat, 'manual') - elapsed);
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

  buildBroadcastPayload() {
    const enrichedWaiting = this.computeWaitTimes();
    const donePatients = this.state.queue.filter(p => p.status === 'done');
    const inConsult = this.state.queue.filter(p => p.status === 'in-consultation');

    const liveInConsult = inConsult.map(p => ({
      ...p,
      liveElapsedMs: (p.elapsedMs || 0) + (this.state.consultStartTime ? Date.now() - this.state.consultStartTime : 0),
      allottedMs: this.getAllottedMsForMode(this.getPatientCategory(p), this.state.waitSettings.mode)
    }));

    const normalDurs = this.state.waitSettings.durations.normal || [];
    const emgDurs = this.state.waitSettings.durations.emergency || [];
    const quickDurs = this.state.waitSettings.durations.quick || [];
    const allDurs = [...normalDurs, ...emgDurs, ...quickDurs];
    
    const sampleCount = allDurs.length;
    let effectiveAvgMinutes = this.state.waitSettings.manualTimes.normal || 10;
    if (sampleCount >= 2) {
      effectiveAvgMinutes = Math.round(allDurs.reduce((a, b) => a + b, 0) / allDurs.length / 60000);
    }

    const nextPatient = enrichedWaiting[0];
    return {
      queue: enrichedWaiting,
      inConsultation: liveInConsult,
      done: donePatients,
      waitSettings: this.state.waitSettings,
      totalServed: this.state.totalServed,
      canUndo: !!this.state.lastCallTime && (Date.now() - this.state.lastCallTime <= 30000),
      currentToken: this.state.currentToken,
      nextToken: nextPatient ? nextPatient.token : null,
      serverTime: Date.now(),
      waitingCount: enrichedWaiting.length,
      consultStartTime: this.state.consultStartTime,
      effectiveAvgMinutes,
      sampleCount,
      clinicId: this.clinicId
    };
  }

  broadcast() {
    io.to(this.clinicId).emit('queue_update', this.buildBroadcastPayload());
  }

  async persistToDb() {
    if (!this.state.sessionId || mongoose.connection.readyState !== 1) return;
    try {
      await Session.findByIdAndUpdate(this.state.sessionId, {
        currentToken: this.state.currentToken,
        nextTokenCounter: this.state.nextTokenCounter,
        waitSettings: this.state.waitSettings,
        totalServed: this.state.totalServed,
        consultStartTime: this.state.consultStartTime,
      });
      for (const p of this.state.queue) {
        await Patient.findOneAndUpdate(
          { clinicId: this.clinicId, sessionId: this.state.sessionId, token: p.token },
          { ...p, clinicId: this.clinicId },
          { upsert: true, new: true }
        );
      }
    } catch (err) {
      console.warn(`[DB] Persist failed for ${this.clinicId}:`, err.message);
    }
  }

  async initDailySession() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let session = await Session.findOne({ clinicId: this.clinicId, date: { $gte: today } });
      
      if (!session) {
        this.state.waitSettings.durations = { normal: [], emergency: [], quick: [] };
        session = await Session.create({
          clinicId: this.clinicId,
          date: new Date(),
          waitSettings: this.state.waitSettings,
          currentToken: 0,
          nextTokenCounter: 1,
          totalServed: 0,
          consultStartTime: null,
        });
        this.state.sessionDate = session.date;
      } else {
        this.state.sessionId = session._id;
        this.state.currentToken = session.currentToken;
        this.state.nextTokenCounter = session.nextTokenCounter;
        if (session.waitSettings) {
          this.state.waitSettings.mode = session.waitSettings.mode || 'auto';
          this.state.waitSettings.manualTimes = { ...this.state.waitSettings.manualTimes, ...(session.waitSettings.manualTimes || {}) };
          this.state.waitSettings.durations = { ...this.state.waitSettings.durations, ...(session.waitSettings.durations || {}) };
        }
        this.state.totalServed = session.totalServed;
        this.state.consultStartTime = session.consultStartTime;
        this.state.sessionDate = session.date;

        const patients = await Patient.find({ clinicId: this.clinicId, sessionId: session._id });
        this.state.queue = patients.map(p => p.toObject());
        
        this.state.queue.forEach(p => {
          if (!p.patientId) p.patientId = this.getPatientId(p.name, p.phone);
          else {
            const key = `${p.name.toLowerCase().trim()}|${(p.phone || '').trim()}`;
            this.state.patientsDirectory[p.patientId] = { id: p.patientId, key, name: p.name, phone: p.phone };
          }
        });
      }
      this.state.sessionId = session._id;
    } catch (err) {
      console.warn(`[DB] Session init failed for ${this.clinicId}:`, err.message);
    }
  }

  async checkAndResetDay() {
    if (!this.state.sessionDate) return;
    const now = new Date();
    
    if (this.state.sessionDate.getFullYear() === now.getFullYear() &&
        this.state.sessionDate.getMonth() === now.getMonth() &&
        this.state.sessionDate.getDate() === now.getDate()) {
      return; 
    }
    
    this.state.queue = [];
    this.state.currentToken = 0;
    this.state.nextTokenCounter = 1;
    this.state.totalServed = 0;
    this.state.consultStartTime = null;
    this.state.previousToken = 0;
    this.state.lastCallTime = null;
    this.state.sessionDate = now;
    this.state.waitSettings.durations = { normal: [], emergency: [], quick: [] };

    try {
      const session = await Session.create({
        clinicId: this.clinicId,
        date: now,
        waitSettings: this.state.waitSettings,
        currentToken: 0,
        nextTokenCounter: 1,
        totalServed: 0,
        consultStartTime: null,
      });
      this.state.sessionId = session._id;
    } catch (e) {}
    
    this.broadcast();
  }
}

// ── Clinic Manager (Multi-Tenant Map) ─────────────────────────
const activeClinics = new Map();

async function getClinicInstance(clinicId) {
  if (!clinicId) return null;
  const cId = String(clinicId);
  if (!mongoose.Types.ObjectId.isValid(cId)) return null;
  
  if (!activeClinics.has(cId)) {
    const clinicDoc = await Clinic.findById(cId);
    if (!clinicDoc) return null;
    const cq = new ClinicQueue(cId, clinicDoc.email);
    await cq.initDailySession();
    activeClinics.set(cId, cq);
  }
  return activeClinics.get(cId);
}

// Global ticker for all active clinics
setInterval(() => {
  activeClinics.forEach(cq => {
    cq.checkAndResetDay();
    if (cq.state.queue.some(p => p.status === 'in-consultation')) {
      const times = cq.computeWaitTimes().map(p => ({
        token: p.token,
        estWaitMinAuto: p.estWaitMinAuto,
        estWaitMinManual: p.estWaitMinManual,
        isNext: p.isNext
      }));
      io.to(cq.clinicId).emit('wait_time_tick', times);
    }
  });
}, 10000);


// ── MongoDB connection & Data Migration ───────────────────────
async function connectDb() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    console.log('[DB] Connected to MongoDB');

    // MIGRATION: Ensure at least one default clinic exists for legacy data
    let defaultClinic = await Clinic.findOne({ username: 'admin' });
    if (!defaultClinic) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || '!1@2DgDg', salt);
      defaultClinic = await Clinic.create({
        name: 'Default Clinic',
        username: 'admin',
        password: hash,
        email: 'manager@clinicqueue.com'
      });
      console.log('[DB] Migrated: Created Default Clinic');
    }
    // Assign legacy patients and sessions to default clinic
    await Patient.updateMany({ clinicId: null }, { $set: { clinicId: defaultClinic._id } });
    await Patient.updateMany({ clinicId: { $exists: false } }, { $set: { clinicId: defaultClinic._id } });
    await Session.updateMany({ clinicId: null }, { $set: { clinicId: defaultClinic._id } });
    await Session.updateMany({ clinicId: { $exists: false } }, { $set: { clinicId: defaultClinic._id } });

  } catch (err) {
    console.warn('[DB] MongoDB unavailable:', err.message);
  }
}

// ── Socket.IO event handlers ───────────────────────────────────
io.on('connection', (socket) => {
  
  socket.on('join_clinic', async (data) => {
    const { clinicId } = data;
    if (!clinicId) return;
    
    if (socket.currentClinicId) socket.leave(socket.currentClinicId);
    socket.currentClinicId = clinicId;
    socket.join(clinicId);
    
    const cq = await getClinicInstance(clinicId);
    if (cq) {
      socket.emit('queue_update', cq.buildBroadcastPayload());
    }
  });

  socket.on('add_patient', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    let { name, phone } = data;
    if (!name || !name.trim()) return;
    name = toTitleCase(name.trim());

    const patientId = cq.getPatientId(name, phone);
    const existing = cq.state.queue.filter(p => p.patientId === patientId);
    
    if (existing.some(p => p.status !== 'done')) {
      socket.emit('error_event', { message: 'Patient is already in the queue or in consultation.' });
      return;
    }
    
    const token = cq.state.nextTokenCounter++;
    const patient = {
      token, patientId, clinicId: cq.clinicId, name: name.trim(), phone: phone ? phone.trim() : '',
      status: 'waiting', checkInTime: new Date().toISOString(),
      consultStartTime: null, consultEndTime: null, elapsedMs: 0,
      isQuickConsult: false, sortIndex: null,
      meetingsToday: existing.length + 1, sessionId: cq.state.sessionId,
    };
    cq.state.queue.push(patient);
    cq.persistToDb();
    cq.broadcast();
    socket.emit('patient_added', { token, name: patient.name });
    sendSMS(patient.phone, `ClinicQ: You are added to the queue! Your token is #${token}. Check live status: ${process.env.APP_URL || 'http://localhost:3000'}/patient.html?clinicId=${cq.clinicId}`);
  });

  socket.on('add_emergency', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    let { name, phone } = data;
    if (!name || !name.trim()) return;
    name = toTitleCase(name.trim());

    const patientId = cq.getPatientId(name, phone);
    const existing = cq.state.queue.filter(p => p.patientId === patientId);
    
    if (existing.some(p => p.status !== 'done')) {
      socket.emit('error_event', { message: 'Patient is already in the queue or in consultation.' });
      return;
    }
    
    const token = cq.state.nextTokenCounter++;
    const patient = {
      token, patientId, clinicId: cq.clinicId, name: name.trim(), phone: phone ? phone.trim() : '',
      status: 'in-consultation', checkInTime: new Date().toISOString(),
      consultStartTime: new Date().toISOString(), consultEndTime: null,
      elapsedMs: 0, isEmergency: true, sortIndex: -1,
      meetingsToday: existing.length + 1, sessionId: cq.state.sessionId,
    };

    const currentInConsult = cq.state.queue.find(p => p.status === 'in-consultation');
    if (currentInConsult) {
      currentInConsult.elapsedMs = (currentInConsult.elapsedMs || 0) + (Date.now() - cq.state.consultStartTime);
      if (currentInConsult.isEmergency) {
        patient.status = 'waiting-emergency';
        patient.consultStartTime = null;
        cq.state.queue.push(patient);
        cq.persistToDb();
        cq.broadcast();
        socket.emit('patient_added', { token, name: patient.name });
        return;
      } else {
        currentInConsult.status = 'on-hold';
        currentInConsult.consultStartTime = null;
      }
    }

    cq.state.previousToken = cq.state.currentToken;
    cq.state.lastCallTime = Date.now();
    cq.state.queue.push(patient);
    cq.state.currentToken = token;
    cq.state.consultStartTime = Date.now();
    cq.persistToDb();
    cq.broadcast();
    socket.emit('patient_added', { token, name: patient.name });
  });

  socket.on('add_quick_consult', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    let { name, phone } = data;
    if (!name || !name.trim()) return;
    name = toTitleCase(name.trim());

    const patientId = cq.getPatientId(name, phone);
    const existing = cq.state.queue.filter(p => p.patientId === patientId);
    
    if (existing.some(p => p.status !== 'done')) {
      socket.emit('error_event', { message: 'Patient is already in the queue or in consultation.' });
      return;
    }
    
    const token = cq.state.nextTokenCounter++;
    const patient = {
      token, patientId, clinicId: cq.clinicId, name: name.trim(), phone: phone ? phone.trim() : '',
      status: 'quick-consult', checkInTime: new Date().toISOString(),
      consultStartTime: null, consultEndTime: null, elapsedMs: 0,
      isQuickConsult: true, sortIndex: null,
      meetingsToday: existing.length + 1, sessionId: cq.state.sessionId,
    };
    cq.state.queue.push(patient);
    cq.persistToDb();
    cq.broadcast();
    socket.emit('patient_added', { token, name: patient.name });
  });

  socket.on('quick_consult', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    const { token } = data;
    const oldPat = cq.state.queue.find(p => p.token === token);
    if (!oldPat || oldPat.status !== 'done') return;

    const existing = cq.state.queue.filter(p => p.patientId === oldPat.patientId);
    if (existing.some(p => p.status !== 'done')) {
      socket.emit('error_event', { message: 'Patient is already in the queue or in consultation.' });
      return;
    }

    const newToken = cq.state.nextTokenCounter++;
    
    const patient = {
      token: newToken,
      patientId: oldPat.patientId,
      clinicId: cq.clinicId,
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
      sessionId: cq.state.sessionId,
    };
    cq.state.queue.push(patient);
    cq.persistToDb();
    cq.broadcast();
  });

  socket.on('reorder_queue', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    const { orderedTokens } = data;
    orderedTokens.forEach((token, idx) => {
      const p = cq.state.queue.find(x => x.token === token);
      if (p) p.sortIndex = idx;
    });
    cq.state.queue.forEach(p => {
        if (!orderedTokens.includes(p.token) && STATUS_PRIORITY[p.status]) {
            p.sortIndex = null;
        }
    });
    cq.persistToDb();
    cq.broadcast();
  });

  socket.on('swap_consultation', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    const { token } = data;
    const targetPat = cq.state.queue.find(p => p.token === token);
    const currentInConsult = cq.state.queue.find(p => p.status === 'in-consultation');
    
    if (!targetPat || targetPat.status === 'done' || targetPat.status === 'in-consultation') return;

    if (currentInConsult) {
      currentInConsult.elapsedMs = (currentInConsult.elapsedMs || 0) + (Date.now() - cq.state.consultStartTime);
      currentInConsult.status = 'on-hold';
      currentInConsult.consultStartTime = null;
    }

    targetPat.status = 'in-consultation';
    targetPat.consultStartTime = new Date().toISOString();
    
    cq.state.previousToken = cq.state.currentToken;
    cq.state.currentToken = targetPat.token;
    cq.state.consultStartTime = Date.now();
    
    cq.persistToDb();
    cq.broadcast();
  });

  socket.on('call_next', async () => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    const waitingPatients = cq.state.queue
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

    const currentInConsult = cq.state.queue.find(p => p.status === 'in-consultation');
    if (currentInConsult) {
      currentInConsult.status = 'done';
      currentInConsult.consultEndTime = new Date().toISOString();
      currentInConsult.elapsedMs = (currentInConsult.elapsedMs || 0) + (Date.now() - cq.state.consultStartTime);
      
      if (currentInConsult.elapsedMs > 0) {
        const cat = cq.getPatientCategory(currentInConsult);
        cq.state.waitSettings.durations[cat].push(currentInConsult.elapsedMs);
        if (cq.state.waitSettings.durations[cat].length > 20) cq.state.waitSettings.durations[cat].shift();
      }
      cq.state.totalServed++;
    }

    cq.state.previousToken = cq.state.currentToken;
    cq.state.lastCallTime = Date.now();

    nextPatient.status = 'in-consultation';
    nextPatient.consultStartTime = new Date().toISOString();
    cq.state.currentToken = nextPatient.token;
    cq.state.consultStartTime = Date.now();

    cq.persistToDb();
    cq.broadcast();
    sendSMS(nextPatient.phone, `ClinicQ: It's your turn! Please proceed to the doctor.`);
    
    const waitingAfter = waitingPatients[1];
    if (waitingAfter) {
      sendSMS(waitingAfter.phone, `ClinicQ: You are next in line! Please be ready.`);
    }
  });

  socket.on('mark_done', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    const { token } = data;
    const patient = cq.state.queue.find(p => p.token === token);
    if (!patient || patient.status === 'done') return;

    const wasInConsult = patient.status === 'in-consultation';
    patient.status = 'done';
    patient.consultEndTime = new Date().toISOString();

    if (wasInConsult) {
      patient.elapsedMs = (patient.elapsedMs || 0) + (Date.now() - cq.state.consultStartTime);
      if (patient.elapsedMs > 0) {
        const cat = cq.getPatientCategory(patient);
        cq.state.waitSettings.durations[cat].push(patient.elapsedMs);
        if (cq.state.waitSettings.durations[cat].length > 20) cq.state.waitSettings.durations[cat].shift();
      }
      cq.state.totalServed++;
      cq.state.previousToken = patient.token;
      cq.state.currentToken = 0;
      cq.state.consultStartTime = null;
      cq.state.lastCallTime = Date.now();
    }
    cq.persistToDb();
    cq.broadcast();
  });

  socket.on('undo_call', async () => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    if (!cq.state.lastCallTime || (Date.now() - cq.state.lastCallTime > 30000)) return;

    const currentPatient = cq.state.queue.find(p => p.status === 'in-consultation');
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

    if (cq.state.previousToken > 0) {
      const prevPatient = cq.state.queue.find(p => p.token === cq.state.previousToken);
      if (prevPatient) {
        prevPatient.status = 'in-consultation';
        prevPatient.consultEndTime = null;
        prevPatient.consultStartTime = new Date().toISOString();
        cq.state.totalServed = Math.max(0, cq.state.totalServed - 1);
        
        if (prevPatient.elapsedMs > 0) {
          const cat = cq.getPatientCategory(prevPatient);
          const arr = cq.state.waitSettings.durations[cat];
          const idx = arr.lastIndexOf(prevPatient.elapsedMs);
          if (idx !== -1) arr.splice(idx, 1);
        }
      }
    }

    cq.state.currentToken = cq.state.previousToken;
    cq.state.consultStartTime = Date.now(); 
    cq.state.lastCallTime = null;

    cq.persistToDb();
    cq.broadcast();
  });

  socket.on('remove_patient', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    const { token } = data;
    const idx = cq.state.queue.findIndex(p => p.token === token && STATUS_PRIORITY[p.status]);
    if (idx !== -1) {
      cq.state.queue.splice(idx, 1);
      cq.persistToDb();
      cq.broadcast();
    }
  });

  socket.on('save_manual_times', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    cq.state.waitSettings.manualTimes = data.manualTimes;
    cq.persistToDb();
    cq.broadcast();
  });

  socket.on('set_global_wait_mode', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    cq.state.waitSettings.mode = data.mode;
    cq.persistToDb();
    cq.broadcast();
  });

  socket.on('lookup_token', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    const { token } = data;
    const waitingList = cq.computeWaitTimes();
    const found = waitingList.find(p => p.token === Number(token));
    if (found) {
      socket.emit('token_status', { found: true, patient: found });
    } else {
      const donePat = cq.state.queue.find(p => p.token === Number(token) && p.status === 'done');
      const inConsult = cq.state.queue.find(p => p.token === Number(token) && p.status === 'in-consultation');
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
    if (!socket.currentClinicId) return cb({ done: [] });
    try {
      const start = new Date(data.date); start.setHours(0,0,0,0);
      const end = new Date(data.date); end.setHours(23,59,59,999);
      const session = await Session.findOne({ clinicId: socket.currentClinicId, date: { $gte: start, $lte: end } });
      if (!session) return cb({ done: [] });
      const pts = await Patient.find({ sessionId: session._id, status: 'done' }).sort({ consultEndTime: -1 });
      cb({ done: pts.map(p => p.toObject()) });
    } catch (e) {
      cb({ done: [] });
    }
  });

  socket.on('get_all_patients', async (cb) => {
    if (!socket.currentClinicId) return cb([]);
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return cb([]);

    try {
      if (mongoose.connection.readyState !== 1) {
        return cb(Object.values(cq.state.patientsDirectory).map(p => ({
          ...p,
          totalMeetings: cq.state.queue.filter(q => q.patientId === p.id).length
        })));
      }
      
      const results = await Patient.aggregate([
        { $match: { clinicId: new mongoose.Types.ObjectId(socket.currentClinicId) } },
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

  socket.on('send_daily_report', async (data) => {
    if (!socket.currentClinicId) return;
    const cq = await getClinicInstance(socket.currentClinicId);
    if (!cq) return;

    const { date } = data;
    const targetEmail = cq.clinicEmail; // Dynamic per-clinic
    if (!targetEmail) {
       socket.emit('error_event', { message: 'No email registered for this clinic.' });
       return;
    }
    
    try {
      const startOfDay = new Date(date);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setUTCHours(23, 59, 59, 999);
      
      const records = await Patient.find({
        clinicId: socket.currentClinicId,
        status: 'done',
        checkInTime: { $gte: startOfDay, $lte: endOfDay }
      });
      
      const totalServed = records.length;
      let totalMs = 0;
      records.forEach(r => totalMs += (r.elapsedMs || 0));
      const avgMs = totalServed > 0 ? totalMs / totalServed : 0;
      const m = Math.floor(avgMs / 60000);
      const s = Math.floor((avgMs % 60000) / 1000);
      
      const htmlMsg = `
        <div style="font-family:sans-serif; max-width:600px; margin:0 auto; padding:20px; border:1px solid #ddd; border-radius:8px;">
          <h2 style="color:#2563eb;">ClinicQueue Daily Report: ${date}</h2>
          <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
          <p style="font-size:16px;"><strong>Total Patients Served:</strong> <span style="color:#059669;font-weight:bold;">${totalServed}</span></p>
          <p style="font-size:16px;"><strong>Average Duration:</strong> <span style="color:#7c3aed;font-weight:bold;">${m}m ${s}s</span></p>
          <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
          <p style="color:#666; font-size:14px;">This is an automated report generated by the ClinicQueue system.</p>
        </div>
      `;

      if (process.env.SENDGRID_API_KEY) {
        const msg = {
          to: targetEmail,
          from: process.env.CLINIC_MANAGER_EMAIL || 'noreply@clinicqueue.com',
          subject: `ClinicQueue Daily Report - ${date}`,
          html: htmlMsg,
        };
        await sgMail.send(msg);
        console.log(`[SENDGRID] Report sent to ${targetEmail}`);
        socket.emit('report_sent', { message: `Report emailed to ${targetEmail} via SendGrid!` });
      } else {
        console.log(`[MOCK EMAIL] Sending daily report for ${date} to ${targetEmail}...`);
        socket.emit('report_sent', { message: `Mock email report sent to ${targetEmail}!` });
      }
    } catch(err) {
      console.error('Email error:', err);
      if (err.response) console.error(err.response.body);
      socket.emit('error_event', { message: 'Failed to send report. Check SendGrid API keys.' });
    }
  });
});

// ── REST endpoint — History by Date ───────────────────────────
app.get('/api/history', async (req, res) => {
  try {
    const { date } = req.query;
    const token = req.cookies.rcp_auth;
    if (!token || !date) return res.json([]);
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const session = await Session.findOne({ clinicId: decoded.clinicId, date: { $gte: startOfDay, $lte: endOfDay } });
    if (!session) return res.json([]);

    const patients = await Patient.find({ clinicId: decoded.clinicId, sessionId: session._id, status: 'done' }).sort({ consultEndTime: -1 });
    res.json(patients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
connectDb().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🏥 Clinic Queue Server (Multi-Tenant) running on http://localhost:${PORT}`);
  });
});
