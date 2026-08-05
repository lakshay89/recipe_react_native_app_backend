const request = require('supertest');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config/environment');
const { connectDB, disconnectDB } = require('../src/config/database');
const User = require('../src/models/User');
const RecipeDraft = require('../src/models/RecipeDraft');
const { signAccessToken } = require('../src/services/token.service');

describe('Auth & Draft Ownership Integration Tests', () => {
  let userA, userB;
  let tokenA, tokenB;
  const draftIdA = `draft-auth-A-${Date.now()}`;
  const draftIdB = `draft-auth-B-${Date.now()}`;

  beforeAll(async () => {
    await connectDB();

    // 1. Create User A and User B
    userA = await User.create({
      fullName: 'User A',
      email: `usera.${Date.now()}@example.com`,
      normalizedEmail: `usera.${Date.now()}@example.com`,
      passwordHash: 'dummyhash123',
      status: 'active',
      isEmailVerified: true
    });

    userB = await User.create({
      fullName: 'User B',
      email: `userb.${Date.now()}@example.com`,
      normalizedEmail: `userb.${Date.now()}@example.com`,
      passwordHash: 'dummyhash123',
      status: 'active',
      isEmailVerified: true
    });

    // 2. Generate Access Tokens
    tokenA = signAccessToken(userA);
    tokenB = signAccessToken(userB);
  });

  afterAll(async () => {
    // Cleanup users and drafts
    await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
    await RecipeDraft.deleteMany({ draftId: { $in: [draftIdA, draftIdB] } });
    await disconnectDB();
  });

  describe('Draft Access Security Checks (401 cases)', () => {
    test('should return 401 if Authorization header is missing', async () => {
      const response = await request(app)
        .get('/api/v1/recipes/drafts');
      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    test('should return 401 if token is malformed', async () => {
      const response = await request(app)
        .get('/api/v1/recipes/drafts')
        .set('Authorization', 'Bearer invalidtoken123');
      expect(response.status).toBe(401);
    });
  });

  describe('Cross-User Draft Ownership Enforcements', () => {
    test('should allow User A to create their draft', async () => {
      const response = await request(app)
        .post('/api/v1/recipes/drafts')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          draftId: draftIdA,
          title: 'User A Recipe',
          state: 'Goa'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.userId).toBe(userA.id);
    });

    test('should reject User B trying to overwrite/update User A draft', async () => {
      const response = await request(app)
        .post('/api/v1/recipes/drafts')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          draftId: draftIdA, // same draftId
          title: 'Hacked by B'
        });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('UNAUTHORIZED_ACCESS');
    });

    test('should return 404 (ownership-safe) when User B tries to read User A draft', async () => {
      const response = await request(app)
        .get(`/api/v1/recipes/drafts/${draftIdA}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('DRAFT_NOT_FOUND');
    });

    test('should return 404 (ownership-safe) when User B tries to delete User A draft', async () => {
      const response = await request(app)
        .delete(`/api/v1/recipes/drafts/${draftIdA}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('DRAFT_NOT_FOUND');
    });
  });

  describe('Guest Draft Migration', () => {
    const guestDraftId = `draft-guest-${Date.now()}`;

    beforeAll(async () => {
      // Create a draft owned by guest_user in the db
      await RecipeDraft.create({
        draftId: guestDraftId,
        userId: 'guest_user',
        title: 'Guest Kheer'
      });
    });

    afterAll(async () => {
      await RecipeDraft.deleteMany({ draftId: guestDraftId });
    });

    test('should migrate guest draft to User A successfully', async () => {
      const payload = [
        {
          draftId: guestDraftId,
          title: 'Guest Kheer (Updated during migration)'
        }
      ];

      const response = await request(app)
        .post('/api/v1/recipes/drafts/migrate')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data[0].draftId).toBe(guestDraftId);
      expect(response.body.data[0].userId).toBe(userA.id);
      expect(response.body.data[0].title).toBe('Guest Kheer (Updated during migration)');
    });
  });
});
