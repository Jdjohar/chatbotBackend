const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing token' });

  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    req.userId = decoded.userId;  // sets userId
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}


module.exports = authenticateToken;
