const { rateLimit } = require('express-rate-limit');
const config = require('../config/environment');

const handler = (req, res) => res.status(429).json({
  success: false,
  message: 'Too many requests. Please try again later.',
  code: 'RATE_LIMITED',
  errors: null,
  requestId: req.id,
});

const makeLimiter = (windowMs, limit) => config.NODE_ENV === 'test'
  ? (req, res, next) => next()
  : rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, handler });

module.exports = {
  generalLimiter: makeLimiter(15 * 60 * 1000, 100),
  loginLimiter: makeLimiter(15 * 60 * 1000, 10),
  otpLimiter: makeLimiter(60 * 60 * 1000, 5),
  passwordResetLimiter: makeLimiter(60 * 60 * 1000, 3),
};
