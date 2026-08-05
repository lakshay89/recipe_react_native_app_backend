const express = require('express');
const crypto = require('crypto');
const authenticate = require('../middlewares/authenticate');
const RecipeDraft = require('../models/RecipeDraft');
const RecipeSubmission = require('../models/RecipeSubmission');
const { validateDraftForSubmission } = require('../utils/submissionValidator');
const { sendSuccess, sendError } = require('../utils/apiResponse');

const router = express.Router();

// Generate unique human-readable submission reference (EI-YYYY-XXXX)
async function generateUniqueReference() {
  const year = new Date().getFullYear();
  let reference = '';
  let unique = false;
  while (!unique) {
    const random = Math.floor(1000 + Math.random() * 9000);
    reference = `EI-${year}-${random}`;
    const duplicate = await RecipeSubmission.findOne({ submissionReference: reference });
    if (!duplicate) {
      unique = true;
    }
  }
  return reference;
}

// 1. Submit Draft for Review
router.post('/recipe-drafts/:draftId/submit', authenticate, async (req, res, next) => {
  try {
    const { draftId } = req.params;
    const { draftVersion, idempotencyKey, declaration, consent, aiDisclosureConfirmed } = req.body;
    const contributorId = req.user.id;

    if (!idempotencyKey) {
      return sendError(res, {
        message: 'idempotencyKey is required.',
        statusCode: 400,
        code: 'MISSING_IDEMPOTENCY_KEY',
        requestId: req.id
      });
    }

    // 1. Idempotency Check
    const existingSubmission = await RecipeSubmission.findOne({ idempotencyKey });
    if (existingSubmission) {
      if (existingSubmission.contributorId !== contributorId) {
        return sendError(res, {
          message: 'Access denied.',
          statusCode: 404,
          code: 'SUBMISSION_NOT_FOUND',
          requestId: req.id
        });
      }
      return sendSuccess(res, 'Submission processed (idempotent result).', existingSubmission, 200, { requestId: req.id });
    }

    // 2. Draft Ownership Check
    const draft = await RecipeDraft.findOne({ draftId });
    if (!draft || draft.userId !== contributorId) {
      return sendError(res, {
        message: 'Recipe draft not found.',
        statusCode: 404,
        code: 'DRAFT_NOT_FOUND',
        requestId: req.id
      });
    }

    // 3. Stale Draft Check
    if (draftVersion !== undefined && Number(draftVersion) < draft.version) {
      return sendError(res, {
        message: 'Conflict: Draft version submitted is outdated. Please sync first.',
        statusCode: 409,
        code: 'DRAFT_STALE',
        requestId: req.id
      });
    }

    // 4. Duplicate Active Submissions Check
    const activeSub = await RecipeSubmission.findOne({
      draftId,
      status: { $in: ['submitted', 'under_review', 'changes_requested', 'resubmitted'] }
    });
    if (activeSub) {
      return sendError(res, {
        message: 'Conflict: An active submission for this draft already exists.',
        statusCode: 409,
        code: 'ACTIVE_SUBMISSION_EXISTS',
        requestId: req.id
      });
    }

    // 5. Backend validation
    const validationResult = await validateDraftForSubmission(draft, declaration, consent, aiDisclosureConfirmed);
    if (!validationResult.isValid) {
      return sendError(res, {
        message: 'Submission validation failed.',
        statusCode: 422,
        code: 'SUBMISSION_VALIDATION_FAILED',
        errors: validationResult.details,
        requestId: req.id
      });
    }

    // 6. Create Submission
    const submissionId = `sub-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const submissionReference = await generateUniqueReference();

    const snapshot = {
      revisionNumber: 1,
      recipeSnapshot: draft.toObject(),
      declaration,
      consent,
      aiDisclosureConfirmed,
      submittedAt: new Date()
    };

    const statusHistory = {
      actorId: contributorId,
      actorRole: req.user.role || 'contributor',
      previousStatus: null,
      newStatus: 'submitted',
      comment: 'Initial submission',
      timestamp: new Date(),
      revisionNumber: 1
    };

    const submission = await RecipeSubmission.create({
      submissionId,
      draftId,
      contributorId,
      submissionReference,
      status: 'submitted',
      revision: 1,
      revisions: [snapshot],
      statusHistory: [statusHistory],
      idempotencyKey
    });

    // 7. Lock the draft status
    draft.status = 'submitted';
    await draft.save();

    return sendSuccess(res, 'Recipe submitted successfully.', submission, 201, { requestId: req.id });
  } catch (error) {
    next(error);
  }
});

// 2. List All Submissions for Authenticated Contributor
router.get('/submissions', authenticate, async (req, res, next) => {
  try {
    const contributorId = req.user.id;
    const { status, sort = '-createdAt', limit = 20, page = 1 } = req.query;

    const query = { contributorId };
    if (status) {
      query.status = status;
    }

    const skipCount = (Number(page) - 1) * Number(limit);
    const submissions = await RecipeSubmission.find(query)
      .sort(sort)
      .skip(skipCount)
      .limit(Number(limit));

    const total = await RecipeSubmission.countDocuments(query);

    return sendSuccess(res, 'Submissions retrieved successfully.', submissions, 200, {
      total,
      limit: Number(limit),
      page: Number(page),
      requestId: req.id
    });
  } catch (error) {
    next(error);
  }
});

// 3. Get Single Submission Details
router.get('/submissions/:submissionId', authenticate, async (req, res, next) => {
  try {
    const { submissionId } = req.params;
    const contributorId = req.user.id;

    const submission = await RecipeSubmission.findOne({ submissionId });
    if (!submission || submission.contributorId !== contributorId) {
      return sendError(res, {
        message: 'Submission not found.',
        statusCode: 404,
        code: 'SUBMISSION_NOT_FOUND',
        requestId: req.id
      });
    }

    return sendSuccess(res, 'Submission retrieved successfully.', submission, 200, { requestId: req.id });
  } catch (error) {
    next(error);
  }
});

// 4. Withdraw Submission
router.post('/submissions/:submissionId/withdraw', authenticate, async (req, res, next) => {
  try {
    const { submissionId } = req.params;
    const contributorId = req.user.id;

    const submission = await RecipeSubmission.findOne({ submissionId });
    if (!submission || submission.contributorId !== contributorId) {
      return sendError(res, {
        message: 'Submission not found.',
        statusCode: 404,
        code: 'SUBMISSION_NOT_FOUND',
        requestId: req.id
      });
    }

    // Permitted to withdraw only if status is submitted or resubmitted
    if (submission.status !== 'submitted' && submission.status !== 'resubmitted') {
      return sendError(res, {
        message: `Cannot withdraw submission from status: ${submission.status}`,
        statusCode: 400,
        code: 'INVALID_STATUS_TRANSITION',
        requestId: req.id
      });
    }

    const previousStatus = submission.status;
    submission.status = 'withdrawn';
    submission.statusHistory.push({
      actorId: contributorId,
      actorRole: req.user.role || 'contributor',
      previousStatus,
      newStatus: 'withdrawn',
      comment: (req.body && req.body.comment) || 'Withdrawn by contributor',
      timestamp: new Date(),
      revisionNumber: submission.revision
    });

    await submission.save();

    // Unlock the draft so contributor can edit/submit it again
    const draft = await RecipeDraft.findOne({ draftId: submission.draftId });
    if (draft) {
      draft.status = 'draft';
      await draft.save();
    }

    return sendSuccess(res, 'Submission withdrawn successfully.', submission, 200, { requestId: req.id });
  } catch (error) {
    next(error);
  }
});

// 5. Resubmit after Changes Requested
router.post('/submissions/:submissionId/resubmit', authenticate, async (req, res, next) => {
  try {
    const { submissionId } = req.params;
    const { draftVersion, declaration, consent, aiDisclosureConfirmed } = req.body;
    const contributorId = req.user.id;

    const submission = await RecipeSubmission.findOne({ submissionId });
    if (!submission || submission.contributorId !== contributorId) {
      return sendError(res, {
        message: 'Submission not found.',
        statusCode: 404,
        code: 'SUBMISSION_NOT_FOUND',
        requestId: req.id
      });
    }

    // Permitted to resubmit only if status is changes_requested
    if (submission.status !== 'changes_requested') {
      return sendError(res, {
        message: `Cannot resubmit from status: ${submission.status}. Must be changes_requested.`,
        statusCode: 400,
        code: 'INVALID_STATUS_TRANSITION',
        requestId: req.id
      });
    }

    const draft = await RecipeDraft.findOne({ draftId: submission.draftId });
    if (!draft || draft.userId !== contributorId) {
      return sendError(res, {
        message: 'Recipe draft not found.',
        statusCode: 404,
        code: 'DRAFT_NOT_FOUND',
        requestId: req.id
      });
    }

    // Version conflict check
    if (draftVersion !== undefined && Number(draftVersion) < draft.version) {
      return sendError(res, {
        message: 'Conflict: Draft version submitted is outdated. Please sync first.',
        statusCode: 409,
        code: 'DRAFT_STALE',
        requestId: req.id
      });
    }

    // Backend validation
    const validationResult = await validateDraftForSubmission(draft, declaration, consent, aiDisclosureConfirmed);
    if (!validationResult.isValid) {
      return sendError(res, {
        message: 'Submission validation failed.',
        statusCode: 422,
        code: 'SUBMISSION_VALIDATION_FAILED',
        errors: validationResult.details,
        requestId: req.id
      });
    }

    // Increment revision
    const nextRevision = submission.revision + 1;
    const snapshot = {
      revisionNumber: nextRevision,
      recipeSnapshot: draft.toObject(),
      declaration,
      consent,
      aiDisclosureConfirmed,
      submittedAt: new Date()
    };

    const previousStatus = submission.status;
    submission.status = 'resubmitted';
    submission.revision = nextRevision;
    submission.revisions.push(snapshot);
    submission.statusHistory.push({
      actorId: contributorId,
      actorRole: req.user.role || 'contributor',
      previousStatus,
      newStatus: 'resubmitted',
      comment: 'Resubmitted after changes requested',
      timestamp: new Date(),
      revisionNumber: nextRevision
    });

    await submission.save();

    // Ensure draft remains in submitted state
    draft.status = 'submitted';
    await draft.save();

    return sendSuccess(res, 'Recipe resubmitted successfully.', submission, 200, { requestId: req.id });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
