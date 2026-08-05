const mongoose = require('mongoose');
const { ROLE_VALUES, ROLES } = require('../constants/roles');

const userSchema = new mongoose.Schema({
  userCode: { type: String, unique: true, sparse: true },
  fullName: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true },
  normalizedEmail: { type: String, required: true, unique: true, lowercase: true },
  mobile: { type: String, unique: true, sparse: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLE_VALUES, default: ROLES.CONTRIBUTOR, immutable: true },
  status: { type: String, enum: ['pending_verification', 'active', 'suspended', 'deactivated', 'deletion_requested'], default: 'pending_verification' },
  isEmailVerified: { type: Boolean, default: false },
  isProfileComplete: { type: Boolean, default: false },
  preferredLanguage: { type: String, default: 'English', trim: true },
  contributorType: { type: String, default: '', trim: true },
  institutionName: { type: String, default: '', trim: true },
  state: { type: String, default: '', trim: true },
  district: { type: String, default: '', trim: true },
  country: { type: String, default: 'India', trim: true },
  bio: { type: String, default: '', maxlength: 1000 },
  avatar: { type: mongoose.Schema.Types.Mixed, default: null },
  notificationPreferences: {
    recipeApproved: { type: Boolean, default: true },
    recipeRejected: { type: Boolean, default: true },
    reviewerFeedback: { type: Boolean, default: true },
    newCollection: { type: Boolean, default: true },
    appAnnouncements: { type: Boolean, default: false },
  },
  lastLoginAt: Date,
}, { timestamps: true, toJSON: { virtuals: true, transform(doc, ret) { delete ret.passwordHash; delete ret.__v; return ret; } } });

userSchema.pre('save', function assignUserCode() {
  if (!this.userCode) this.userCode = `EI-${this._id.toString().slice(-8).toUpperCase()}`;
});

module.exports = mongoose.model('User', userSchema);
