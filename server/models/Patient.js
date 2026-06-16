const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema({
  token: { type: Number, required: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, default: '' },
  status: {
    type: String,
    enum: ['waiting', 'in-consultation', 'done'],
    default: 'waiting',
  },
  checkInTime: { type: Date, default: Date.now },
  consultStartTime: { type: Date, default: null },
  consultEndTime: { type: Date, default: null },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
});

PatientSchema.index({ sessionId: 1, token: 1 }, { unique: true });

module.exports = mongoose.model('Patient', PatientSchema);
