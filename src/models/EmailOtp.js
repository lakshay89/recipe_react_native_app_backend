const mongoose = require('mongoose');

const emailOtpSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email: { type: String, required: true },
  purpose: { type: String, enum: ['verify_email', 'reset_password'], required: true },
  otpHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  consumedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
}, { timestamps: true });

emailOtpSchema.index({ email: 1, purpose: 1, createdAt: -1 });
module.exports = mongoose.model('EmailOtp', emailOtpSchema);
