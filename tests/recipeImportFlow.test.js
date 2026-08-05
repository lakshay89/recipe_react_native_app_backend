const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/database');
const User = require('../src/models/User');
const MediaAsset = require('../src/models/MediaAsset');
const RecipeImportSession = require('../src/models/RecipeImportSession');
const RecipeDraft = require('../src/models/RecipeDraft');
const { signAccessToken } = require('../src/services/token.service');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const config = require('../src/config/environment');

describe('Handwritten Recipe Import Session Flow Integration Tests', () => {
  let userA, userB;
  let tokenA, tokenB;
  let assetA, assetB;
  let mockPngBuffer;
  let originalFetch;
  let originalEnv;
  let originalProvider;

  beforeAll(async () => {
    originalProvider = config.STORAGE_PROVIDER;
    config.STORAGE_PROVIDER = 'local';
    await connectDB();
    originalFetch = global.fetch;
    originalEnv = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'mock-api-key';

    // Create test users
    userA = await User.create({
      fullName: 'Importer A',
      email: `importer.a.${Date.now()}@example.com`,
      normalizedEmail: `importer.a.${Date.now()}@example.com`,
      passwordHash: 'dummyhash123',
      status: 'active',
      isEmailVerified: true
    });

    userB = await User.create({
      fullName: 'Importer B',
      email: `importer.b.${Date.now()}@example.com`,
      normalizedEmail: `importer.b.${Date.now()}@example.com`,
      passwordHash: 'dummyhash123',
      status: 'active',
      isEmailVerified: true
    });

    tokenA = signAccessToken(userA);
    tokenB = signAccessToken(userB);

    // Dynamically generate a valid 50x50 PNG using sharp
    mockPngBuffer = await sharp({
      create: {
        width: 50,
        height: 50,
        channels: 3,
        background: { r: 0, g: 255, b: 0 }
      }
    }).png().toBuffer();

    // Create local mock upload file directory
    const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Write temp files so storageService.verifyObject succeeds
    const keyA = `uploads/${userA.id}/recipe_gallery/asset_a.png`;
    const keyB = `uploads/${userB.id}/recipe_gallery/asset_b.png`;
    const pathA = path.join(uploadDir, '../', keyA);
    const pathB = path.join(uploadDir, '../', keyB);
    fs.mkdirSync(path.dirname(pathA), { recursive: true });
    fs.mkdirSync(path.dirname(pathB), { recursive: true });
    fs.writeFileSync(pathA, mockPngBuffer);
    fs.writeFileSync(pathB, mockPngBuffer);

    assetA = await MediaAsset.create({
      assetId: 'asset-a',
      ownerId: userA.id,
      assetType: 'recipe_gallery',
      originalFileName: 'page1.png',
      storageProvider: 'local',
      storageKey: keyA,
      mimeType: 'image/png',
      size: mockPngBuffer.length,
      uploadStatus: 'ready'
    });

    assetB = await MediaAsset.create({
      assetId: 'asset-b',
      ownerId: userB.id,
      assetType: 'recipe_gallery',
      originalFileName: 'page2.png',
      storageProvider: 'local',
      storageKey: keyB,
      mimeType: 'image/png',
      size: mockPngBuffer.length,
      uploadStatus: 'ready'
    });
  });

  afterAll(async () => {
    // Clean up DB records
    await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
    await MediaAsset.deleteMany({ assetId: { $in: ['asset-a', 'asset-b'] } });
    await RecipeImportSession.deleteMany({ ownerId: { $in: [userA.id, userB.id] } });
    await RecipeDraft.deleteMany({ userId: { $in: [userA.id, userB.id] } });

    // Clean up physical mock files
    const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../public/uploads');
    const pathA = path.join(uploadDir, `../uploads/${userA.id}`);
    const pathB = path.join(uploadDir, `../uploads/${userB.id}`);
    if (fs.existsSync(pathA)) fs.rmSync(pathA, { recursive: true, force: true });
    if (fs.existsSync(pathB)) fs.rmSync(pathB, { recursive: true, force: true });

    global.fetch = originalFetch;
    process.env.GEMINI_API_KEY = originalEnv;
    config.STORAGE_PROVIDER = originalProvider;
    await disconnectDB();
  });

  describe('Handwritten Recipe Import Pipeline - Step-by-Step Flow', () => {
    let session;

    test('Step 1: Unauthenticated request should fail to initiate session', async () => {
      const res = await request(app)
        .post('/api/v1/recipe-imports');
      expect(res.status).toBe(401);
    });

    test('Step 1: Initiate session successfully', async () => {
      const res = await request(app)
        .post('/api/v1/recipe-imports')
        .set('Authorization', `Bearer ${tokenA}`);
      
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sessionId).toBeDefined();
      expect(res.body.data.status).toBe('created');
      
      session = res.body.data;
    });

    test('Step 2: User B cannot access User A import session', async () => {
      const res = await request(app)
        .get(`/api/v1/recipe-imports/${session.sessionId}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    test('Step 3: User B cannot link their media asset to User A import session', async () => {
      const res = await request(app)
        .post(`/api/v1/recipe-imports/${session.sessionId}/pages`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ pageNumber: 1, assetId: assetB.assetId });
      expect(res.status).toBe(403);
    });

    test('Step 3: User A linking someone else\'s media asset should fail', async () => {
      const res = await request(app)
        .post(`/api/v1/recipe-imports/${session.sessionId}/pages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ pageNumber: 1, assetId: assetB.assetId }); // B's asset
      expect(res.status).toBe(404);
    });

    test('Step 3: User A links asset successfully', async () => {
      const res = await request(app)
        .post(`/api/v1/recipe-imports/${session.sessionId}/pages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ pageNumber: 1, assetId: assetA.assetId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pages.length).toBe(1);
      expect(res.body.data.pages[0].assetId).toBe(assetA.assetId);
    });

    test('Step 4: Run OCR successfully via mock Gemini', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      text: 'Devanagari: Kadhai Paneer Recipe\nIngredients: 250g Paneer, Capsicum, Spices.',
                      detectedLanguages: ['hi'],
                      detectedScripts: ['Devanagari'],
                      quality: { level: 'good', warnings: [] },
                      uncertainSegments: [],
                      containsRecipe: true
                    })
                  }
                ]
              }
            }
          ]
        })
      });

      const res = await request(app)
        .post(`/api/v1/recipe-imports/${session.sessionId}/process-ocr`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ocrLanguageHint: 'hi' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ocr_review_required');
      expect(res.body.data.rawOCRTextCombined).toContain('Kadhai Paneer');
      expect(res.body.data.pages[0].detectedLanguages).toContain('hi');
    });

    test('Step 5: Save contributor corrections', async () => {
      const res = await request(app)
        .patch(`/api/v1/recipe-imports/${session.sessionId}/transcription`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          correctedOCRTextCombined: 'Devanagari: Kadhai Paneer Recipe\nIngredients: 250g Fresh Paneer, Capsicum, Spices.',
          pages: [{ pageNumber: 1, correctedText: 'Devanagari: Kadhai Paneer Recipe\nIngredients: 250g Fresh Paneer, Capsicum, Spices.' }]
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.correctedOCRTextCombined).toContain('Fresh Paneer');
    });

    test('Step 6: Trigger culinary structure parser successfully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      title: { value: 'Kadhai Paneer', provenance: 'extracted', confidence: 'high' },
                      localName: { value: 'कढ़ाई पनीर', provenance: 'extracted', confidence: 'high' },
                      nativeScript: { value: 'Devanagari', provenance: 'extracted', confidence: 'high' },
                      description: { value: 'Traditional North Indian Paneer curry', provenance: 'suggested', confidence: 'medium' },
                      ingredients: [
                        { name: { value: 'Paneer' }, quantity: { value: '250' }, unit: { value: 'Gram (g)' } }
                      ],
                      cookingSteps: [
                        { stepText: { value: 'Cut Paneer into cubes.' }, stepNumber: 1 },
                        { stepText: { value: 'Sauté capsicum and paneer in kadhai.' }, stepNumber: 2 }
                      ],
                      clarificationQuestions: ['How much water should be added?'],
                      aiSuggestions: [
                        {
                          id: 'sug-1',
                          field: 'description',
                          suggestedValue: 'Traditional North Indian Paneer curry',
                          confidence: 'medium',
                          reason: 'No description was written in the source.',
                          evidence: ''
                        }
                      ]
                    })
                  }
                ]
              }
            }
          ]
        })
      });

      const res = await request(app)
        .post(`/api/v1/recipe-imports/${session.sessionId}/structure`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('recipe_review_required');
      expect(res.body.data.aiSuggestions.length).toBe(1);
      expect(res.body.data.aiSuggestions[0].field).toBe('description');
    });

    test('Step 7: Accept/Reject individual AI suggestions', async () => {
      // Find suggestion id
      const getSession = await request(app)
        .get(`/api/v1/recipe-imports/${session.sessionId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      
      const sugId = getSession.body.data.aiSuggestions[0].id;

      const res = await request(app)
        .patch(`/api/v1/recipe-imports/${session.sessionId}/suggestions/${sugId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ decision: 'accepted' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.aiSuggestions[0].decision).toBe('accepted');
    });

    test('Step 8: Save to Draft successfully', async () => {
      const res = await request(app)
        .post(`/api/v1/recipe-imports/${session.sessionId}/save-to-draft`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.draftId).toBeDefined();
      expect(res.body.data.title).toBe('Kadhai Paneer');
      expect(res.body.data.ingredientsList[0].name).toBe('Paneer');
    });
  });
});
