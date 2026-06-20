const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  date: { type: Date, required: true, default: Date.now },
  waitSettings: { type: Object, default: { mode: 'auto', manualTimes: { normal: 10, emergency: 10, quick: 2 }, durations: { normal: [], emergency: [], quick: [] } } },
  currentToken: { type: Number, default: 0 },
  nextTokenCounter: { type: Number, default: 1 },
  totalServed: { type: Number, default: 0 },
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: false },
  consultStartTime: { type: Number, default: null }, // Unix ms timestamp
});

module.exports = mongoose.model('Session', SessionSchema);
