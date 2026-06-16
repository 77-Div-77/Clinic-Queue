const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  date: { type: Date, required: true, default: Date.now },
  avgConsultMinutes: { type: Number, default: 10 },
  currentToken: { type: Number, default: 0 },
  nextTokenCounter: { type: Number, default: 1 },
  consultDurations: [{ type: Number }], // actual durations in ms
  totalServed: { type: Number, default: 0 },
  consultStartTime: { type: Number, default: null }, // Unix ms timestamp
});

module.exports = mongoose.model('Session', SessionSchema);
