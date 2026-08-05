const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config/environment');
const Session = require('../models/Session');
const RefreshToken = require('../models/RefreshToken');
const ApiError = require('../utils/ApiError');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const refreshExpiry = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const signAccessToken = (user) => jwt.sign({ sub: user.id, role: user.role, type: 'access' }, config.ACCESS_TOKEN_SECRET, { expiresIn: config.ACCESS_TOKEN_EXPIRES_IN });

const issueRefreshToken = async (user, session) => {
  const tokenId = crypto.randomUUID();
  const token = jwt.sign({ sub: user.id, sid: session.id, jti: tokenId, type: 'refresh' }, config.REFRESH_TOKEN_SECRET, { expiresIn: config.REFRESH_TOKEN_EXPIRES_IN });
  await RefreshToken.create({ userId: user.id, sessionId: session.id, tokenId, tokenHash: hashToken(token), expiresAt: session.expiresAt });
  return { token, tokenId };
};

const createSessionTokens = async (user, context = {}) => {
  const expiresAt = refreshExpiry();
  const session = await Session.create({ userId: user.id, ...context, expiresAt });
  const refresh = await issueRefreshToken(user, session);
  return { accessToken: signAccessToken(user), refreshToken: refresh.token, expiresIn: config.ACCESS_TOKEN_EXPIRES_IN, sessionId: session.id };
};

const rotateRefreshToken = async (rawToken) => {
  let payload;
  try { payload = jwt.verify(rawToken, config.REFRESH_TOKEN_SECRET); } catch (error) { throw new ApiError(401, 'Refresh token is invalid or expired', 'INVALID_REFRESH_TOKEN'); }
  if (payload.type !== 'refresh') throw new ApiError(401, 'Refresh token is invalid', 'INVALID_REFRESH_TOKEN');
  const stored = await RefreshToken.findOne({ tokenId: payload.jti });
  if (!stored || stored.tokenHash !== hashToken(rawToken)) throw new ApiError(401, 'Refresh token is invalid', 'INVALID_REFRESH_TOKEN');
  if (stored.revokedAt) {
    await Promise.all([
      RefreshToken.updateMany({ sessionId: stored.sessionId, revokedAt: null }, { revokedAt: new Date() }),
      Session.updateOne({ _id: stored.sessionId }, { revokedAt: new Date() }),
    ]);
    throw new ApiError(401, 'Refresh token reuse detected; session revoked', 'REFRESH_TOKEN_REUSED');
  }
  const session = await Session.findOne({ _id: stored.sessionId, revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!session) throw new ApiError(401, 'Session is expired or revoked', 'SESSION_REVOKED');
  const User = require('../models/User');
  const user = await User.findById(stored.userId);
  if (!user || user.status !== 'active') throw new ApiError(401, 'Account is unavailable', 'ACCOUNT_UNAVAILABLE');
  const replacement = await issueRefreshToken(user, session);
  stored.revokedAt = new Date();
  stored.replacedByTokenId = replacement.tokenId;
  await stored.save();
  session.lastUsedAt = new Date();
  await session.save();
  return { accessToken: signAccessToken(user), refreshToken: replacement.token, expiresIn: config.ACCESS_TOKEN_EXPIRES_IN, sessionId: session.id };
};

const revokeRefreshToken = async (rawToken) => {
  const stored = await RefreshToken.findOne({ tokenHash: hashToken(rawToken) });
  if (!stored) return;
  stored.revokedAt = stored.revokedAt || new Date();
  await stored.save();
  await Session.updateOne({ _id: stored.sessionId }, { revokedAt: new Date() });
};

module.exports = { createSessionTokens, rotateRefreshToken, revokeRefreshToken, signAccessToken };
