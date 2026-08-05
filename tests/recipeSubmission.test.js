const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/database');
const User = require('../src/models/User');
const RecipeDraft = require('../src/models/RecipeDraft');
const RecipeSubmission = require('../src/models/RecipeSubmission');
const { signAccessToken } = require('../src/services/token.service');

describe('Phase 4: Recipe Submission and Review Workflow Tests', () => {
  let userA, userB;
  let tokenA, tokenB;
  const draftIdA = `draft-submit-A-${Date.now()}`;
  const draftIdB = `draft-submit-B-${Date.now()}`;
  let submissionIdA;

  beforeAll(async () => {
    await connectDB();

    // 1. Create Users
    userA = await User.create({
      fullName: 'User A Contributor',
      email: `usera.submit.${Date.now()}@example.com`,
      normalizedEmail: `usera.submit.${Date.now()}@example.com`,
      passwordHash: 'dummyhash',
      status: 'active',
      isEmailVerified: true
    });

    userB = await User.create({
      fullName: 'User B Contributor',
      email: `userb.submit.${Date.now()}@example.com`,
      normalizedEmail: `userb.submit.${Date.now()}@example.com`,
      passwordHash: 'dummyhash',
      status: 'active',
      isEmailVerified: true
    });

    tokenA = signAccessToken(userA);
    tokenB = signAccessToken(userB);

    // 2. Create complete valid draft for User A
    await RecipeDraft.create({
      draftId: draftIdA,
      userId: userA.id,
      title: 'Valid Heritage Kheer',
      state: 'Punjab',
      district: 'Amritsar',
      version: 5,
      ingredientsList: [{ name: 'Rice', quantity: '100g' }],
      cookingStepsList: [{ stepNumber: 1, instruction: 'Boil rice in milk.' }],
      heritageSource: 'Grandmother recipe book'
    });

    // 3. Create incomplete draft for User A
    await RecipeDraft.create({
      draftId: draftIdB, // using draftIdB but owned by userA
      userId: userA.id,
      title: '', // missing title!
      state: '', // missing state!
      district: 'Amritsar',
      version: 1,
      ingredientsList: [],
      cookingStepsList: []
    });
  });

  afterAll(async () => {
    await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
    await RecipeDraft.deleteMany({ draftId: { $in: [draftIdA, draftIdB] } });
    await RecipeSubmission.deleteMany({ draftId: { $in: [draftIdA, draftIdB] } });
    await disconnectDB();
  });

  describe('Validation & Security checks', () => {
    test('1. Unauthenticated request should return 401', async () => {
      const response = await request(app)
        .post(`/api/v1/recipe-drafts/${draftIdA}/submit`)
        .send({});
      expect(response.status).toBe(401);
    });

    test('2. Invalid token should return 401', async () => {
      const response = await request(app)
        .post(`/api/v1/recipe-drafts/${draftIdA}/submit`)
        .set('Authorization', 'Bearer invalidtoken')
        .send({});
      expect(response.status).toBe(401);
    });

    test('3. User B cannot submit User A draft (returns 404 ownership-safe)', async () => {
      const response = await request(app)
        .post(`/api/v1/recipe-drafts/${draftIdA}/submit`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          draftVersion: 5,
          idempotencyKey: `idemp-1-${Date.now()}`,
          declaration: { informationIsAccurate: true, permissionToSubmit: true, termsAccepted: true },
          consent: { publicationPermission: true, sourceAttributionPermission: true, mediaUsagePermission: true },
          aiDisclosureConfirmed: true
        });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('DRAFT_NOT_FOUND');
    });

    test('4. Incomplete draft submission should fail validation (returns 422)', async () => {
      const response = await request(app)
        .post(`/api/v1/recipe-drafts/${draftIdB}/submit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          draftVersion: 1,
          idempotencyKey: `idemp-2-${Date.now()}`,
          declaration: { informationIsAccurate: true, permissionToSubmit: true, termsAccepted: true },
          consent: { publicationPermission: true, sourceAttributionPermission: true, mediaUsagePermission: true },
          aiDisclosureConfirmed: true
        });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('SUBMISSION_VALIDATION_FAILED');
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    test('5. Stale draft version submit should fail (returns 409)', async () => {
      const response = await request(app)
        .post(`/api/v1/recipe-drafts/${draftIdA}/submit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          draftVersion: 2, // stale, DB has version 5
          idempotencyKey: `idemp-3-${Date.now()}`,
          declaration: { informationIsAccurate: true, permissionToSubmit: true, termsAccepted: true },
          consent: { publicationPermission: true, sourceAttributionPermission: true, mediaUsagePermission: true },
          aiDisclosureConfirmed: true
        });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('DRAFT_STALE');
    });
  });

  describe('Submission Lifecycle Flow', () => {
    const key = `key-idemp-${Date.now()}`;

    test('6. Valid draft submit should succeed and lock draft', async () => {
      const response = await request(app)
        .post(`/api/v1/recipe-drafts/${draftIdA}/submit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          draftVersion: 5,
          idempotencyKey: key,
          declaration: { informationIsAccurate: true, permissionToSubmit: true, termsAccepted: true },
          consent: { publicationPermission: true, sourceAttributionPermission: true, mediaUsagePermission: true },
          aiDisclosureConfirmed: true
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('submitted');
      expect(response.body.data.submissionReference).toMatch(/^EI-\d{4}-\d{4}$/);
      
      submissionIdA = response.body.data.submissionId;

      // Verify draft status is locked
      const updatedDraft = await RecipeDraft.findOne({ draftId: draftIdA });
      expect(updatedDraft.status).toBe('submitted');
    });

    test('7. Locked draft cannot be modified or deleted via drafts API', async () => {
      // Modify attempt
      const modResponse = await request(app)
        .post('/api/v1/recipes/drafts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          draftId: draftIdA,
          title: 'Hacked title change'
        });
      expect(modResponse.status).toBe(403);
      expect(modResponse.body.code).toBe('SUBMISSION_LOCKED');

      // Delete attempt
      const delResponse = await request(app)
        .delete(`/api/v1/recipes/drafts/${draftIdA}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(delResponse.status).toBe(403);
      expect(delResponse.body.code).toBe('SUBMISSION_LOCKED');
    });

    test('8. Repeated submit requests with same key return the same idempotent result', async () => {
      const response = await request(app)
        .post(`/api/v1/recipe-drafts/${draftIdA}/submit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          draftVersion: 5,
          idempotencyKey: key,
          declaration: { informationIsAccurate: true, permissionToSubmit: true, termsAccepted: true },
          consent: { publicationPermission: true, sourceAttributionPermission: true, mediaUsagePermission: true },
          aiDisclosureConfirmed: true
        });

      expect(response.status).toBe(200);
      expect(response.body.data.submissionId).toBe(submissionIdA);
    });

    test('9. Contributor can list only their submissions', async () => {
      const response = await request(app)
        .get('/api/v1/submissions')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].submissionId).toBe(submissionIdA);

      // User B list should be empty
      const responseB = await request(app)
        .get('/api/v1/submissions')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(responseB.body.data.length).toBe(0);
    });

    test('10. Contributor cannot view another user\'s submission', async () => {
      const response = await request(app)
        .get(`/api/v1/submissions/${submissionIdA}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('SUBMISSION_NOT_FOUND');
    });

    test('11. Contributor cannot withdraw another user\'s submission', async () => {
      const response = await request(app)
        .post(`/api/v1/submissions/${submissionIdA}/withdraw`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(response.status).toBe(404);
    });
  });

  describe('Withdraw & Resubmit Flow', () => {
    test('12. Contributor can withdraw a submitted draft', async () => {
      const response = await request(app)
        .post(`/api/v1/submissions/${submissionIdA}/withdraw`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('withdrawn');

      // Verify draft status is unlocked/reverted to draft
      const draft = await RecipeDraft.findOne({ draftId: draftIdA });
      expect(draft.status).toBe('draft');
    });

    test('13. Cannot resubmit a withdrawn submission directly without changes_requested status', async () => {
      const response = await request(app)
        .post(`/api/v1/submissions/${submissionIdA}/resubmit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          draftVersion: 5,
          declaration: { informationIsAccurate: true, permissionToSubmit: true, termsAccepted: true },
          consent: { publicationPermission: true, sourceAttributionPermission: true, mediaUsagePermission: true },
          aiDisclosureConfirmed: true
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    test('14. Resubmit succeeds and pushes a new revision when status is changes_requested', async () => {
      // 1. Force state to changes_requested (simulate moderator action in DB)
      await RecipeSubmission.updateOne(
        { submissionId: submissionIdA },
        { status: 'changes_requested' }
      );

      // 2. Modify draft version to version 6 (simulate edits)
      await RecipeDraft.updateOne(
        { draftId: draftIdA },
        { title: 'Super Delicious Amritsari Kheer', version: 6 }
      );

      // 3. Trigger Resubmission
      const response = await request(app)
        .post(`/api/v1/submissions/${submissionIdA}/resubmit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          draftVersion: 6,
          declaration: { informationIsAccurate: true, permissionToSubmit: true, termsAccepted: true },
          consent: { publicationPermission: true, sourceAttributionPermission: true, mediaUsagePermission: true },
          aiDisclosureConfirmed: true
        });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('resubmitted');
      expect(response.body.data.revision).toBe(2);
      expect(response.body.data.revisions.length).toBe(2);
      expect(response.body.data.revisions[1].recipeSnapshot.title).toBe('Super Delicious Amritsari Kheer');
    });
  });
});
