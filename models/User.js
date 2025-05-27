const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  uploadCount: { type: Number, default: 0 },
  questionCount: { type: Number, default: 0 },
  // Optionally:
  chatHistory: [
    {
      message: String,
      response: String,
      timestamp: { type: Date, default: Date.now },
    },
  ],
});


module.exports = mongoose.model('User', userSchema);
