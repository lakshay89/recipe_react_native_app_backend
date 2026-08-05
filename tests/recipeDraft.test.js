const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/database');
const User = require('../src/models/User');
const RecipeDraft = require('../src/models/RecipeDraft');
const { signAccessToken } = require('../src/services/token.service');

describe('Recipe Draft CRUD Endpoints', () => {
  let testUser;
  let authToken;
  const testDraftId = `draft-${Date.now()}`;

  beforeAll(async () => {
    await connectDB();
    
    // Create test user and token
    testUser = await User.create({
      fullName: 'Test Draft User',
      email: `draftuser.${Date.now()}@example.com`,
      normalizedEmail: `draftuser.${Date.now()}@example.com`,
      passwordHash: 'dummyhash123',
      status: 'active',
      isEmailVerified: true
    });

    authToken = signAccessToken(testUser);

    // Clean up any stale test data
    await RecipeDraft.deleteMany({ userId: testUser.id });
  });

  afterAll(async () => {
    await RecipeDraft.deleteMany({ userId: testUser.id });
    await User.deleteOne({ _id: testUser._id });
    await disconnectDB();
  });

  describe('POST /api/v1/recipes/drafts', () => {
    test('should create a fresh recipe draft successfully', async () => {
      const payload = {
        draftId: testDraftId,
        title: 'Draft Monsoon Kadhai Dal',
        localName: 'कढ़ाई दाल',
        serves: '4',
        prepTime: '20 mins',
        cookTime: '45 mins',
        state: 'Punjab',
        currentStep: 'RecipeIdentity',
        completionPercentage: 12.5,
        ingredientsList: [
          { name: 'Urad Dal', quantity: '250', unit: 'Gram (g)' }
        ]
      };

      const response = await request(app)
        .post('/api/v1/recipes/drafts')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.draftId).toBe(testDraftId);
      expect(response.body.data.title).toBe('Draft Monsoon Kadhai Dal');
      expect(response.body.data.userId).toBe(testUser.id);
    });

    test('should update the existing draft fields (upsert checks)', async () => {
      const updatePayload = {
        draftId: testDraftId,
        title: 'Updated Monsoon Kadhai Dal',
        currentStep: 'RecipeLocation',
        completionPercentage: 25.0
      };

      const response = await request(app)
        .post('/api/v1/recipes/drafts')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updatePayload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.draftId).toBe(testDraftId);
      expect(response.body.data.title).toBe('Updated Monsoon Kadhai Dal');
      expect(response.body.data.completionPercentage).toBe(25.0);
    });

    test('should fail if draftId/recipeId is missing', async () => {
      const badPayload = {
        title: 'Untitled'
      };

      const response = await request(app)
        .post('/api/v1/recipes/drafts')
        .set('Authorization', `Bearer ${authToken}`)
        .send(badPayload);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_DRAFT_REQUEST');
    });
  });

  describe('GET /api/v1/recipes/drafts', () => {
    test('should retrieve all drafts associated with a userId', async () => {
      const response = await request(app)
        .get('/api/v1/recipes/drafts')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].draftId).toBe(testDraftId);
    });
  });

  describe('GET /api/v1/recipes/drafts/:draftId', () => {
    test('should fetch a single draft by ID successfully', async () => {
      const response = await request(app)
        .get(`/api/v1/recipes/drafts/${testDraftId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.draftId).toBe(testDraftId);
      expect(response.body.data.title).toBe('Updated Monsoon Kadhai Dal');
    });

    test('should return 404 for a non-existent draft lookup', async () => {
      const response = await request(app)
        .get('/api/v1/recipes/drafts/nonexistent_id_123')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('DRAFT_NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/recipes/drafts/:draftId', () => {
    test('should delete the recipe draft successfully by ID', async () => {
      const response = await request(app)
        .delete(`/api/v1/recipes/drafts/${testDraftId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.draftId).toBe(testDraftId);

      // Verify it is gone
      const verifyResponse = await request(app)
        .get(`/api/v1/recipes/drafts/${testDraftId}`)
        .set('Authorization', `Bearer ${authToken}`);
      expect(verifyResponse.status).toBe(404);
    });

    test('should return 404 when deleting a non-existent draft', async () => {
      const response = await request(app)
        .delete('/api/v1/recipes/drafts/nonexistent_id_123')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('DRAFT_NOT_FOUND');
    });
  });
});
