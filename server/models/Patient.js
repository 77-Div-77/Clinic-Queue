const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema({
  token: { type: Number, required: true },
  patientId: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, default: '' },
  status: { type: String, default: 'waiting' },
  checkInTime: { type: Date, default: Date.now },
  consultStartTime: { type: Date, default: null },
  consultEndTime: { type: Date, default: null },
  elapsedMs: { type: Number, default: 0 },
  isEmergency: { type: Boolean, default: false },
  isQuickConsult: { type: Boolean, default: false },
  sortIndex: { type: Number, default: null },
  meetingsToday: { type: Number, default: 1 },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: false }
});

PatientSchema.index({ clinicId: 1, sessionId: 1, token: 1 }, { unique: true });

module.exports = mongoose.model('Patient', PatientSchema);
