const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: String,
  reply: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Chat', chatSchema);
