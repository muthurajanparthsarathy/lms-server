const userRole = (allowedRoles) => {
  return (req, res, next) => {
    const user = req.user;

    if (user && allowedRoles.includes(user.role)) {
      return next();
    }

    return res.status(403).json({ message: [{ key: 'error', value: 'Access denied' }] });
  };
};

module.exports = { userRole };
