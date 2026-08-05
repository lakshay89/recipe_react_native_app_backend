const crypto = require('crypto');
const config = require('../config/environment');
const EmailOtp = require('../models/EmailOtp');
const ApiError = require('../utils/ApiError');

const hashOtp = (otp) => crypto.createHmac('sha256', config.OTP_SECRET).update(String(otp)).digest('hex');

const createOtp = async ({ userId, email, purpose }) => {
  await EmailOtp.updateMany({ userId, purpose, consumedAt: null }, { consumedAt: new Date() });
  const otp = String(crypto.randomInt(100000, 1000000));
  const minutes = purpose === 'reset_password' ? config.PASSWORD_RESET_EXPIRES_MINUTES : config.OTP_EXPIRES_MINUTES;
  const record = await EmailOtp.create({ userId, email, purpose, otpHash: hashOtp(otp), expiresAt: new Date(Date.now() + minutes * 60000) });
  return { record, otp };
};

const verifyOtp = async ({ id, otp, purpose }) => {
  const record = await EmailOtp.findOne({ _id: id, purpose });
  if (!record || record.consumedAt) throw new ApiError(400, 'OTP is invalid', 'OTP_INVALID');
  if (record.expiresAt <= new Date()) throw new ApiError(400, 'OTP has expired', 'OTP_EXPIRED');
  if (record.attempts >= record.maxAttempts) throw new ApiError(429, 'OTP attempt limit exceeded', 'OTP_ATTEMPTS_EXCEEDED');
  if (hashOtp(otp) !== record.otpHash) {
    record.attempts += 1;
    await record.save();
    throw new ApiError(400, 'OTP is invalid', 'OTP_INVALID');
  }
  record.consumedAt = new Date();
  await record.save();
  return record;
};

module.exports = { createOtp, verifyOtp };
