const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.get('/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const embedCode = `
<script data-user-id="${user._id}" data-api-key="${user.widgetApiKey}" src="https://chatbotbackend-mpah.onrender.com/static/chatbot-widget.js"></script>
    `;
    res.json({ embedCode });
  } catch (err) {
    console.error('Widget error:', err);
    res.status(500).json({ error: 'Failed to generate widget code' });
  }
});

router.post('/settings', async (req, res) => {
  const { userId, theme, position, avatar } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.widgetSettings = { theme, position, avatar };
    await user.save();
    res.json({ message: 'Widget settings updated' });
  } catch (err) {
    console.error('Widget settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});
router.get('/settings/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.widgetSettings);
  } catch (err) {
    console.error('Settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

module.exports = router;