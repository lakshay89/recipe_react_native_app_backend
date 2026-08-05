const { z } = require('zod');

const email = z.string().trim().email().max(254);
const mobile = z.string().trim().regex(/^(?:\+91|0)?[6-9]\d{9}$/, 'A valid Indian mobile number is required');
const password = z.string().min(8).max(128).regex(/[A-Za-z]/, 'Password must contain a letter').regex(/\d/, 'Password must contain a number');
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');

module.exports = {
  register: { body: z.object({ fullName: z.string().trim().min(2).max(120), email, mobile, password, termsAccepted: z.literal(true), role: z.unknown().optional() }).strip() },
  verifyEmail: { body: z.object({ verificationId: objectId, otp: z.string().regex(/^\d{6}$/) }).strict() },
  resendVerification: { body: z.object({ email }).strict() },
  login: { body: z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(1).max(128), device: z.object({ deviceId: z.string().max(200).optional(), deviceName: z.string().max(200).optional(), platform: z.string().max(50).optional() }).optional() }).strict() },
  refresh: { body: z.object({ refreshToken: z.string().min(20) }).strict() },
  logout: { body: z.object({ refreshToken: z.string().min(20) }).strict() },
  forgotPassword: { body: z.object({ identifier: z.string().trim().min(3).max(254) }).strict() },
  verifyResetOtp: { body: z.object({ resetId: objectId, otp: z.string().regex(/^\d{6}$/) }).strict() },
  resetPassword: { body: z.object({ resetAuthorization: z.string().min(20), password }).strict() },
  sessionId: { params: z.object({ sessionId: objectId }) },
  password,
};
