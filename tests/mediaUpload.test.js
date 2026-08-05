const request = require('supertest');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/database');
const User = require('../src/models/User');
const RecipeDraft = require('../src/models/RecipeDraft');
const RecipeSubmission = require('../src/models/RecipeSubmission');
const MediaAsset = require('../src/models/MediaAsset');
const { signAccessToken } = require('../src/services/token.service');
const config = require('../src/config/environment');

describe('Phase 5: Secure Cloud Media Storage Integration Tests', () => {
  let userA, userB;
  let tokenA, tokenB;
  const draftIdA = `draft-media-A-${Date.now()}`;
  const draftIdB = `draft-media-B-${Date.now()}`;
  let assetIdA;
  let storageKeyA;
  let originalProvider;

  const uploadDir = path.join(__dirname, '../public/uploads');

  beforeAll(async () => {
    originalProvider = config.STORAGE_PROVIDER;
    config.STORAGE_PROVIDER = 'local';
    await connectDB();

    userA = await User.create({
      fullName: 'User A Storage',
      email: `usera.store.${Date.now()}@example.com`,
      normalizedEmail: `usera.store.${Date.now()}@example.com`,
      passwordHash: 'dummyhash',
      status: 'active',
      isEmailVerified: true
    });

    userB = await User.create({
      fullName: 'User B Storage',
      email: `userb.store.${Date.now()}@example.com`,
      normalizedEmail: `userb.store.${Date.now()}@example.com`,
      passwordHash: 'dummyhash',
      status: 'active',
      isEmailVerified: true
    });

    tokenA = signAccessToken(userA);
    tokenB = signAccessToken(userB);

    // Create Draft A for User A
    await RecipeDraft.create({
      draftId: draftIdA,
      userId: userA.id,
      title: 'Heritage Halwa',
      state: 'Rajasthan',
      district: 'Jaipur',
      version: 1,
      ingredientsList: [{ name: 'Ghee', quantity: '2 tbsp' }],
      cookingStepsList: [{ stepNumber: 1, instruction: 'Melt ghee.' }],
      heritageSource: 'Family archives'
    });

    // Create Draft B for User B
    await RecipeDraft.create({
      draftId: draftIdB,
      userId: userB.id,
      title: 'Other Recipe',
      state: 'Gujarat',
      district: 'Surat',
      version: 1
    });
  });

  afterAll(async () => {
    await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
    await RecipeDraft.deleteMany({ draftId: { $in: [draftIdA, draftIdB] } });
    await RecipeSubmission.deleteMany({ draftId: { $in: [draftIdA, draftIdB] } });
    await MediaAsset.deleteMany({ ownerId: { $in: [userA.id, userB.id] } });
    config.STORAGE_PROVIDER = originalProvider;
    await disconnectDB();
  });

  describe('Upload Initiation', () => {
    test('1. Unauthenticated request returns 401', async () => {
      const response = await request(app)
        .post('/api/v1/media/uploads/initiate')
        .send({
          assetType: 'recipe_hero',
          originalFileName: 'dish.jpg',
          mimeType: 'image/jpeg',
          size: 1024 * 1024,
          draftId: draftIdA
        });
      expect(response.status).toBe(401);
    });

    test('2. User A cannot initiate upload against User B\'s draft (returns 404)', async () => {
      const response = await request(app)
        .post('/api/v1/media/uploads/initiate')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          assetType: 'recipe_hero',
          originalFileName: 'dish.jpg',
          mimeType: 'image/jpeg',
          size: 1024 * 1024,
          draftId: draftIdB // owned by userB
        });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('DRAFT_NOT_FOUND');
    });

    test('3. Rejected for unsupported MIME type (returns 400)', async () => {
      const response = await request(app)
        .post('/api/v1/media/uploads/initiate')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          assetType: 'recipe_hero',
          originalFileName: 'exploit.sh',
          mimeType: 'application/x-sh',
          size: 100,
          draftId: draftIdA
        });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('UNSUPPORTED_MIME_TYPE');
    });

    test('4. Rejected for oversized file (returns 400)', async () => {
      const response = await request(app)
        .post('/api/v1/media/uploads/initiate')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          assetType: 'recipe_hero',
          originalFileName: 'dish.jpg',
          mimeType: 'image/jpeg',
          size: 5 * 1024 * 1024, // 5MB exceeds 4MB limit
          draftId: draftIdA
        });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('FILE_TOO_LARGE');
    });

    test('5. Valid initiation creates pending MediaAsset and returns upload fields', async () => {
      const response = await request(app)
        .post('/api/v1/media/uploads/initiate')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          assetType: 'recipe_hero',
          originalFileName: 'halwa.jpg',
          mimeType: 'image/jpeg',
          size: 1024 * 1024, // 1MB
          draftId: draftIdA
        });

      expect(response.status).toBe(201);
      expect(response.body.data.asset.uploadStatus).toBe('pending');
      expect(response.body.data.uploadInstructions.uploadUrl).toBeDefined();

      assetIdA = response.body.data.asset.assetId;
      storageKeyA = response.body.data.asset.storageKey;
    });
  });

  describe('File Upload & Completion Verification', () => {
    test('6. Completing non-existent file or pending upload returns error', async () => {
      const response = await request(app)
        .post(`/api/v1/media/uploads/${assetIdA}/complete`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(response.status).toBe(500); // verifyObject throws because file does not exist on disk yet
    });

    test('7. Post raw file directly and verify complete transitions status to ready', async () => {
      // Create a dummy image file (1x1 red pixel transparent PNG) to represent successful upload
      const testImagePath = path.join(__dirname, 'temp_halwa.jpg');
      const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      fs.writeFileSync(testImagePath, Buffer.from(base64Png, 'base64'));

      // Perform direct upload simulation
      const uploadResponse = await request(app)
        .post('/api/v1/media/uploads/direct')
        .field('assetId', assetIdA)
        .attach('file', testImagePath);

      expect(uploadResponse.status).toBe(200);
      expect(uploadResponse.body.data.uploadStatus).toBe('uploaded');

      // Now invoke Complete endpoint
      const completeResponse = await request(app)
        .post(`/api/v1/media/uploads/${assetIdA}/complete`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(completeResponse.status).toBe(200);
      expect(completeResponse.body.data.uploadStatus).toBe('ready');

      // Clean up local temp file
      if (fs.existsSync(testImagePath)) {
        fs.unlinkSync(testImagePath);
      }
    });

    test('8. Retrieve signed URL and enforce privacy access control check', async () => {
      // User A can access
      const resA = await request(app)
        .get(`/api/v1/media/${assetIdA}`)
        .set('Authorization', `Bearer ${tokenA}`);
      
      expect(resA.status).toBe(200);
      expect(resA.body.data.accessUrl).toBeDefined();

      // User B cannot access User A's private asset (returns 403)
      const resB = await request(app)
        .get(`/api/v1/media/${assetIdA}`)
        .set('Authorization', `Bearer ${tokenB}`);
      
      expect(resB.status).toBe(403);
    });
  });

  describe('Draft & Submission Integration', () => {
    test('9. Local-only media blocks submission validator checks (returns 422)', async () => {
      // 1. Update draft with local-only file URI
      await RecipeDraft.updateOne(
        { draftId: draftIdA },
        { archiveImages: [{ id: 'img-1', name: 'dish.jpg', uri: 'file:///local_path/dish.jpg', progress: 100 }] }
      );

      // 2. Submit draft A (which has a local image)
      const response = await request(app)
        .post(`/api/v1/recipe-drafts/${draftIdA}/submit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          draftVersion: 1,
          idempotencyKey: `idemp-media-${Date.now()}`,
          declaration: { informationIsAccurate: true, permissionToSubmit: true, termsAccepted: true },
          consent: { publicationPermission: true, sourceAttributionPermission: true, mediaUsagePermission: true },
          aiDisclosureConfirmed: true
        });

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('SUBMISSION_VALIDATION_FAILED');
      expect(response.body.errors[0].code).toBe('LOCAL_URI_UNSUPPORTED');
    });

    test('10. Verified ready cloud assets successfully pass submission validation', async () => {
      // 1. Update draft to link the verified cloud assetId
      await RecipeDraft.updateOne(
        { draftId: draftIdA },
        { archiveImages: [{ id: 'img-1', name: 'halwa.jpg', uri: `file://halwa.jpg`, assetId: assetIdA }] }
      );

      // 2. Submit draft A
      const response = await request(app)
        .post(`/api/v1/recipe-drafts/${draftIdA}/submit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          draftVersion: 1,
          idempotencyKey: `idemp-media-pass-${Date.now()}`,
          declaration: { informationIsAccurate: true, permissionToSubmit: true, termsAccepted: true },
          consent: { publicationPermission: true, sourceAttributionPermission: true, mediaUsagePermission: true },
          aiDisclosureConfirmed: true
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('submitted');
    });
  });
});
