const User = require('../models/User');

  module.exports = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      console.error('Missing API key in request');
      return res.status(401).json({ error: 'Missing API key' });
    }

    try {
      const user = await User.findOne({ widgetApiKey: apiKey });
      if (!user) {
        console.error(`Invalid API key: ${apiKey}`);
        return res.status(401).json({ error: 'Invalid API key' });
      }
      req.user = { id: user._id };
      next();
    } catch (err) {
      console.error('API key authentication error:', err);
      res.status(401).json({ error: 'Invalid API key' });
    }
  };