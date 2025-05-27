const User = require('./models/User'); // Make sure to import your User model

const checkLimits = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.questionCount >= 20) {
      return res.status(403).json({ error: 'Question limit reached (20)' });
    }

    next();
  } catch (err) {
    console.error('Limit check error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
