const checkUploadLimit = async (req, res, next) => {
  const user = await User.findById(req.user.id);

  if (user.uploadCount >= 5) {
    return res.status(403).json({ error: 'Upload limit reached (5)' });
  }

  next();
};
