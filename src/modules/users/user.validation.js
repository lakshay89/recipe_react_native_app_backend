const { z } = require('zod');
const authValidation = require('../auth/auth.validation');

const profileBody = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  mobile: z.string().trim().regex(/^(?:\+91|0)?[6-9]\d{9}$/).optional(),
  preferredLanguage: z.string().trim().min(2).max(50).optional(),
  contributorType: z.string().trim().min(2).max(100).optional(),
  institutionName: z.string().trim().max(200).optional(),
  instituteName: z.string().trim().max(200).optional(),
  state: z.string().trim().min(2).max(100).optional(),
  district: z.string().trim().min(2).max(100).optional(),
  country: z.string().trim().min(2).max(100).optional(),
  bio: z.string().trim().max(1000).optional(),
  notificationPreferences: z.object({ recipeApproved: z.boolean().optional(), recipeRejected: z.boolean().optional(), reviewerFeedback: z.boolean().optional(), newCollection: z.boolean().optional(), appAnnouncements: z.boolean().optional() }).optional(),
}).strict();

module.exports = {
  updateProfile: { body: profileBody.refine((body) => Object.keys(body).length > 0, 'At least one profile field is required') },
  changePassword: { body: z.object({ currentPassword: z.string().min(1), newPassword: authValidation.password }).strict() },
};
