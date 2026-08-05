const jwt = require('jsonwebtoken');
const config = require('../../config/environment');
const User = require('../../models/User');
const Session = require('../../models/Session');
const RefreshToken = require('../../models/RefreshToken');
const ApiError = require('../../utils/ApiError');
const { normalizeEmail, normalizeMobile } = require('../../utils/normalizeText');
const { hashPassword, verifyPassword } = require('../../services/password.service');
const { createOtp, verifyOtp } = require('../../services/otp.service');
const { createSessionTokens, rotateRefreshToken, revokeRefreshToken } = require('../../services/token.service');

const publicUser = (user) => user.toJSON();

const register = async (input) => {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedMobile = normalizeMobile(input.mobile);
  const duplicate = await User.findOne({ $or: [{ normalizedEmail }, { mobile: normalizedMobile }] });
  if (duplicate?.normalizedEmail === normalizedEmail) throw new ApiError(409, 'An account already exists for this email', 'EMAIL_ALREADY_EXISTS');
  if (duplicate) throw new ApiError(409, 'An account already exists for this mobile number', 'MOBILE_ALREADY_EXISTS');
  const user = await User.create({ fullName: input.fullName, email: input.email.trim(), normalizedEmail, mobile: normalizedMobile, passwordHash: await hashPassword(input.password) });
  const { record, otp } = await createOtp({ userId: user.id, email: normalizedEmail, purpose: 'verify_email' });
  return { user: publicUser(user), verificationId: record.id, expiresAt: record.expiresAt, ...(config.NODE_ENV !== 'production' ? { developmentOtp: otp } : {}) };
};

const verifyEmail = async ({ verificationId, otp }) => {
  const record = await verifyOtp({ id: verificationId, otp, purpose: 'verify_email' });
  const user = await User.findByIdAndUpdate(record.userId, { isEmailVerified: true, status: 'active' }, { new: true });
  return publicUser(user);
};

const resendVerification = async ({ email }) => {
  const user = await User.findOne({ normalizedEmail: normalizeEmail(email) });
  if (!user || user.isEmailVerified) return { message: 'If the account requires verification, a new code has been issued' };
  const { record, otp } = await createOtp({ userId: user.id, email: user.normalizedEmail, purpose: 'verify_email' });
  return { message: 'If the account requires verification, a new code has been issued', verificationId: record.id, expiresAt: record.expiresAt, ...(config.NODE_ENV !== 'production' ? { developmentOtp: otp } : {}) };
};

const findByIdentifier = (identifier, selectPassword = false) => {
  const normalized = identifier.includes('@') ? normalizeEmail(identifier) : normalizeMobile(identifier);
  const query = User.findOne(identifier.includes('@') ? { normalizedEmail: normalized } : { mobile: normalized });
  return selectPassword ? query.select('+passwordHash') : query;
};

const login = async (input, context) => {
  const user = await findByIdentifier(input.identifier, true);
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw new ApiError(401, 'Email/mobile or password is incorrect', 'INVALID_CREDENTIALS');
  if (!user.isEmailVerified) throw new ApiError(403, 'Email verification is required', 'EMAIL_NOT_VERIFIED');
  if (user.status !== 'active') throw new ApiError(403, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
  user.lastLoginAt = new Date();
  await user.save();
  const tokens = await createSessionTokens(user, { ...input.device, ...context });
  return { user: publicUser(user), tokens };
};

const forgotPassword = async ({ identifier }) => {
  const user = await findByIdentifier(identifier);
  const generic = { message: 'If an eligible account exists, a reset code has been issued' };
  if (!user || user.status !== 'active') return generic;
  const { record, otp } = await createOtp({ userId: user.id, email: user.normalizedEmail, purpose: 'reset_password' });
  return { ...generic, resetId: record.id, expiresAt: record.expiresAt, ...(config.NODE_ENV !== 'production' ? { developmentOtp: otp } : {}) };
};

const verifyResetCode = async ({ resetId, otp }) => {
  const record = await verifyOtp({ id: resetId, otp, purpose: 'reset_password' });
  const resetAuthorization = jwt.sign({ sub: record.userId.toString(), purpose: 'reset_password' }, config.ACCESS_TOKEN_SECRET, { expiresIn: `${config.PASSWORD_RESET_EXPIRES_MINUTES}m` });
  return { resetAuthorization };
};

const resetPassword = async ({ resetAuthorization, password }) => {
  let payload;
  try { payload = jwt.verify(resetAuthorization, config.ACCESS_TOKEN_SECRET); } catch (error) { throw new ApiError(401, 'Reset authorization is invalid or expired', 'INVALID_RESET_AUTHORIZATION'); }
  if (payload.purpose !== 'reset_password') throw new ApiError(401, 'Reset authorization is invalid', 'INVALID_RESET_AUTHORIZATION');
  const user = await User.findById(payload.sub).select('+passwordHash');
  if (!user) throw new ApiError(404, 'Account not found', 'NOT_FOUND');
  user.passwordHash = await hashPassword(password);
  await user.save();
  const now = new Date();
  await Promise.all([Session.updateMany({ userId: user.id, revokedAt: null }, { revokedAt: now }), RefreshToken.updateMany({ userId: user.id, revokedAt: null }, { revokedAt: now })]);
};

module.exports = { register, verifyEmail, resendVerification, login, rotateRefreshToken, revokeRefreshToken, forgotPassword, verifyResetCode, resetPassword };
