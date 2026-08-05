const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/apiResponse');
const authService = require('./auth.service');
const Session = require('../../models/Session');
const RefreshToken = require('../../models/RefreshToken');
const ApiError = require('../../utils/ApiError');

exports.register = asyncHandler(async (req, res) => sendSuccess(res, 'Registration created. Verify your email to continue.', await authService.register(req.body), 201));
exports.verifyEmail = asyncHandler(async (req, res) => sendSuccess(res, 'Email verified successfully', { user: await authService.verifyEmail(req.body) }));
exports.resendVerification = asyncHandler(async (req, res) => sendSuccess(res, 'Verification request processed', await authService.resendVerification(req.body)));
exports.login = asyncHandler(async (req, res) => sendSuccess(res, 'Login successful', await authService.login(req.body, { ipAddress: req.ip, userAgent: req.get('user-agent') || '' })));
exports.refresh = asyncHandler(async (req, res) => sendSuccess(res, 'Session refreshed', { tokens: await authService.rotateRefreshToken(req.body.refreshToken) }));
exports.logout = asyncHandler(async (req, res) => { await authService.revokeRefreshToken(req.body.refreshToken); return sendSuccess(res, 'Logged out successfully'); });
exports.forgotPassword = asyncHandler(async (req, res) => sendSuccess(res, 'Password reset request processed', await authService.forgotPassword(req.body)));
exports.verifyResetOtp = asyncHandler(async (req, res) => sendSuccess(res, 'Reset code verified', await authService.verifyResetCode(req.body)));
exports.resetPassword = asyncHandler(async (req, res) => { await authService.resetPassword(req.body); return sendSuccess(res, 'Password reset successfully'); });
exports.sessions = asyncHandler(async (req, res) => {
  const sessions = await Session.find({ userId: req.user.id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).lean();
  return sendSuccess(res, 'Active sessions retrieved', sessions);
});
exports.revokeSession = asyncHandler(async (req, res) => {
  const session = await Session.findOne({ _id: req.params.sessionId, userId: req.user.id });
  if (!session) throw new ApiError(404, 'Session not found', 'NOT_FOUND');
  const now = new Date();
  session.revokedAt = now;
  await Promise.all([session.save(), RefreshToken.updateMany({ sessionId: session.id, revokedAt: null }, { revokedAt: now })]);
  return sendSuccess(res, 'Session revoked');
});
