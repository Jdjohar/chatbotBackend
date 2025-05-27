// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async function (req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing token' });

  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    req.user = await User.findById(decoded.userId);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};
