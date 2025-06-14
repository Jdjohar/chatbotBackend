const User = require('../models/User');

module.exports = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing API key' });

  try {
    const user = await User.findOne({ widgetApiKey: apiKey });
    if (!user) return res.status(401).json({ error: 'Invalid API key' });
    req.user = { id: user._id };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid API key' });
  }
};