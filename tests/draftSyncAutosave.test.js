const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/database');
const User = require('../src/models/User');
const RecipeDraft = require('../src/models/RecipeDraft');
const { signAccessToken } = require('../src/services/token.service');

describe('Phase 3: Versioning & Conflict Protection Tests', () => {
  let user;
  let token;
  const draftId = `draft-version-${Date.now()}`;

  beforeAll(async () => {
    await connectDB();

    user = await User.create({
      fullName: 'Conflict Tester',
      email: `conflict.${Date.now()}@example.com`,
      normalizedEmail: `conflict.${Date.now()}@example.com`,
      passwordHash: 'dummyhash123',
      status: 'active',
      isEmailVerified: true
    });

    token = signAccessToken(user);
  });

  afterAll(async () => {
    await User.deleteMany({ _id: user._id });
    await RecipeDraft.deleteMany({ draftId });
    await disconnectDB();
  });

  test('should successfully save draft initially with version 1', async () => {
    const response = await request(app)
      .post('/api/v1/recipes/drafts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draftId,
        title: 'Initial Version',
        version: 1,
        clientUpdatedAt: new Date(Date.now() - 10000).toISOString() // 10s ago
      });

    expect(response.status).toBe(200);
    expect(response.body.data.version).toBe(1);
    expect(response.body.data.title).toBe('Initial Version');
  });

  test('should reject saving if client version is older than server version (409 Conflict)', async () => {
    // Attempting to write with version 0 (older than version 1)
    const response = await request(app)
      .post('/api/v1/recipes/drafts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draftId,
        title: 'Outdated Version',
        version: 0,
        clientUpdatedAt: new Date(Date.now() - 20000).toISOString()
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DRAFT_CONFLICT');
    expect(response.body.errors.serverDraft.version).toBe(1);
  });

  test('should reject saving if client timestamp is older than server timestamp on same version', async () => {
    // Attempting to write with same version 1, but a timestamp 20s ago (server has 10s ago)
    const response = await request(app)
      .post('/api/v1/recipes/drafts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draftId,
        title: 'Outdated Timestamp',
        version: 1,
        clientUpdatedAt: new Date(Date.now() - 20000).toISOString()
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DRAFT_CONFLICT');
  });

  test('should accept saving if client version is newer', async () => {
    const response = await request(app)
      .post('/api/v1/recipes/drafts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draftId,
        title: 'Newer Version',
        version: 2,
        clientUpdatedAt: new Date().toISOString()
      });

    expect(response.status).toBe(200);
    expect(response.body.data.version).toBe(2);
    expect(response.body.data.title).toBe('Newer Version');
  });

  test('should bypass conflict checks and overwrite when force=true is sent', async () => {
    // Attempting to force write an older version
    const response = await request(app)
      .post('/api/v1/recipes/drafts?force=true')
      .set('Authorization', `Bearer ${token}`)
      .send({
        draftId,
        title: 'Forced Older Version',
        version: 1,
        clientUpdatedAt: new Date(Date.now() - 30000).toISOString()
      });

    expect(response.status).toBe(200);
    expect(response.body.data.version).toBe(1);
    expect(response.body.data.title).toBe('Forced Older Version');
  });
});
