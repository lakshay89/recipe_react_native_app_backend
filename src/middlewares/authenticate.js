const jwt = require('jsonwebtoken');
const config = require('../config/environment');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

module.exports = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new ApiError(401, 'Authentication is required', 'AUTHENTICATION_REQUIRED');
    let payload;
    try { payload = jwt.verify(token, config.ACCESS_TOKEN_SECRET); } catch (error) { throw new ApiError(401, 'Access token is invalid or expired', 'INVALID_ACCESS_TOKEN'); }
    if (payload.type !== 'access') throw new ApiError(401, 'Access token is invalid', 'INVALID_ACCESS_TOKEN');
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') throw new ApiError(401, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
    req.user = user;
    return next();
  } catch (error) { return next(error); }
};
