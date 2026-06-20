const mongoose = require('mongoose');

const ClinicSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  email: { type: String, required: true, unique: true, trim: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Clinic', ClinicSchema);
