const mongoose = require('mongoose');

const revisionSchema = new mongoose.Schema({
  revisionNumber: { type: Number, required: true },
  recipeSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  declaration: {
    informationIsAccurate: { type: Boolean, default: false },
    permissionToSubmit: { type: Boolean, default: false },
    termsAccepted: { type: Boolean, default: false }
  },
  consent: {
    publicationPermission: { type: Boolean, default: false },
    sourceAttributionPermission: { type: Boolean, default: false },
    mediaUsagePermission: { type: Boolean, default: false }
  },
  aiDisclosureConfirmed: { type: Boolean, default: false },
  submittedAt: { type: Date, default: Date.now }
}, { _id: false });

const statusHistorySchema = new mongoose.Schema({
  actorId: { type: String, required: true },
  actorRole: { type: String, required: true },
  previousStatus: { type: String },
  newStatus: { type: String, required: true },
  comment: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
  revisionNumber: { type: Number, required: true }
}, { _id: false });

const recipeSubmissionSchema = new mongoose.Schema({
  submissionId: { type: String, required: true, unique: true, index: true },
  draftId: { type: String, required: true, index: true },
  contributorId: { type: String, required: true, index: true },
  submissionReference: { type: String, required: true, unique: true, index: true },
  status: {
    type: String,
    enum: [
      'submitted',
      'under_review',
      'changes_requested',
      'resubmitted',
      'approved',
      'rejected',
      'withdrawn',
      'published',
      'archived'
    ],
    default: 'submitted',
    index: true
  },
  revision: { type: Number, default: 1 },
  revisions: [revisionSchema],
  curatorId: { type: String, default: null, index: true },
  reviewComments: { type: String, default: '' },
  statusHistory: [statusHistorySchema],
  idempotencyKey: { type: String, required: true, unique: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model('RecipeSubmission', recipeSubmissionSchema);
