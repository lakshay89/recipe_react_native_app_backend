const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/apiResponse');
const { normalizeMobile } = require('../../utils/normalizeText');
const { hashPassword, verifyPassword } = require('../../services/password.service');
const User = require('../../models/User');
const ApiError = require('../../utils/ApiError');

exports.me = asyncHandler(async (req, res) => sendSuccess(res, 'Profile retrieved', { user: req.user }));
exports.updateProfile = asyncHandler(async (req, res) => {
  const input = { ...req.body };
  if (input.name) input.fullName = input.name;
  if (input.instituteName !== undefined) input.institutionName = input.instituteName;
  delete input.name;
  delete input.instituteName;
  if (input.mobile) input.mobile = normalizeMobile(input.mobile);
  const required = ['fullName', 'state', 'district', 'preferredLanguage', 'contributorType'];
  const merged = { ...req.user.toObject(), ...input };
  input.isProfileComplete = required.every((field) => String(merged[field] || '').trim());
  const user = await User.findByIdAndUpdate(req.user.id, input, { new: true, runValidators: true });
  return sendSuccess(res, 'Profile updated', { user });
});
exports.changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!(await verifyPassword(req.body.currentPassword, user.passwordHash))) throw new ApiError(400, 'Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
  user.passwordHash = await hashPassword(req.body.newPassword);
  await user.save();
  return sendSuccess(res, 'Password changed successfully');
});
