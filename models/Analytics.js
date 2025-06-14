// models/Analytics.js
const mongoose = require('mongoose');
const analyticsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  conversationCount: { type: Number, default: 0 },
  commonQuestions: [{ question: String, count: Number }],
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Analytics', analyticsSchema);