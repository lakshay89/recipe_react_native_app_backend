const request = require('supertest');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/database');
const User = require('../src/models/User');
const RecipeDraft = require('../src/models/RecipeDraft');
const MediaAsset = require('../src/models/MediaAsset');
const { signAccessToken } = require('../src/services/token.service');
const config = require('../src/config/environment');

// Mock Cloudflare R2 Client and Presigned URL helpers
jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => {
      return {
        send: jest.fn().mockImplementation((command) => {
          if (command.name === 'HeadObjectCommand' || command.constructor.name === 'HeadObjectCommand') {
            return Promise.resolve({ ContentLength: 120, Metadata: {} });
          }
          if (command.name === 'GetObjectCommand' || command.constructor.name === 'GetObjectCommand') {
            const key = command.input?.Key || '';
            const path = require('path');
            const fs = require('fs');
            const filePath = path.join(__dirname, '../public/uploads', '../', key);
            
            const { Readable } = require('stream');
            const stream = new Readable();
            
            let buffer;
            if (fs.existsSync(filePath)) {
              buffer = fs.readFileSync(filePath);
            } else {
              buffer = Buffer.from(`mock-fallback-${key}`);
            }
            
            stream.push(buffer);
            stream.push(null);
            return Promise.resolve({ Body: stream });
          }
          return Promise.resolve({});
        })
      };
    }),
    PutObjectCommand: class PutObjectCommand {
      constructor(args) { this.input = args; }
    },
    GetObjectCommand: class GetObjectCommand {
      constructor(args) { this.input = args; }
    },
    DeleteObjectCommand: class DeleteObjectCommand {
      constructor(args) { this.input = args; }
    },
    HeadObjectCommand: class HeadObjectCommand {
      constructor(args) { this.input = args; }
    }
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => {
  return {
    getSignedUrl: jest.fn().mockResolvedValue('https://mocked-r2-signed-url.com/presigned-action')
  };
});

describe('Cloudflare R2 Storage & Validation Integration Tests', () => {
  let testUser, userToken;
  const draftId = `draft-r2-${Date.now()}`;
  let originalStorageProvider;

  beforeAll(async () => {
    await connectDB();

    // Force STORAGE_PROVIDER to r2 for R2 tests
    originalStorageProvider = config.STORAGE_PROVIDER;
    config.STORAGE_PROVIDER = 'r2';

    testUser = await User.create({
      fullName: 'R2 Architect Test',
      email: `r2.test.${Date.now()}@example.com`,
      normalizedEmail: `r2.test.${Date.now()}@example.com`,
      passwordHash: 'dummyhash',
      status: 'active',
      isEmailVerified: true
    });

    userToken = signAccessToken(testUser);

    await RecipeDraft.create({
      draftId,
      userId: testUser.id,
      title: 'Monsoon Chai',
      version: 1
    });
  });

  afterAll(async () => {
    config.STORAGE_PROVIDER = originalStorageProvider;
    await User.deleteMany({ _id: testUser._id });
    await RecipeDraft.deleteMany({ draftId });
    await MediaAsset.deleteMany({ ownerId: testUser.id });
    await disconnectDB();
  });

  describe('Security validations & Whitelists', () => {
    test('Should reject initialization of unrecognized asset type', async () => {
      const response = await request(app)
        .post('/api/v1/media/uploads/initiate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          assetType: 'unknown_asset_type',
          originalFileName: 'malicious.exe',
          mimeType: 'application/octet-stream',
          size: 100
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_ASSET_TYPE');
    });

    test('Should reject initialization of unsupported MIME types for avatars', async () => {
      const response = await request(app)
        .post('/api/v1/media/uploads/initiate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          assetType: 'avatar',
          originalFileName: 'profile.gif',
          mimeType: 'image/gif', // GIF not whitelisted for avatar
          size: 1024
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('UNSUPPORTED_MIME_TYPE');
    });

    test('Should reject initialization of oversized audio assets', async () => {
      const response = await request(app)
        .post('/api/v1/media/uploads/initiate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          assetType: 'oral_history',
          originalFileName: 'interview.mp3',
          mimeType: 'audio/mpeg',
          size: 20 * 1024 * 1024 // 20MB exceeds 15MB whitelist limit
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('FILE_TOO_LARGE');
    });
  });

  describe('Content Inspection (Magic Numbers & Scripts)', () => {
    let executableAssetId;

    beforeEach(async () => {
      // Create a pending asset record first
      const res = await request(app)
        .post('/api/v1/media/uploads/initiate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          assetType: 'recipe_hero',
          originalFileName: 'dish.png',
          mimeType: 'image/png',
          size: 1024,
          draftId
        });
      executableAssetId = res.body.data.asset.assetId;
    });

    test('Should reject executable binary contents disguised as image', async () => {
      // Create executable file header starts with MZ
      const payloadPath = path.join(__dirname, 'mock_exec.png');
      const payload = Buffer.concat([
        Buffer.from([0x4d, 0x5a, 0x00, 0x00]), // Windows EXE header 'MZ'
        Buffer.alloc(100)
      ]);
      fs.writeFileSync(payloadPath, payload);

      // Perform direct upload simulation locally
      await request(app)
        .post('/api/v1/media/uploads/direct')
        .field('assetId', executableAssetId)
        .attach('file', payloadPath);

      // Verify completion rejects executable signature
      const completeRes = await request(app)
        .post(`/api/v1/media/uploads/${executableAssetId}/complete`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(completeRes.status).toBe(400);
      expect(completeRes.body.code).toBe('SECURITY_VIOLATION_EXECUTABLE');

      if (fs.existsSync(payloadPath)) {
        fs.unlinkSync(payloadPath);
      }
    });

    test('Should reject files containing inline script tags', async () => {
      const payloadPath = path.join(__dirname, 'mock_script.png');
      const payload = Buffer.from('<html><script>alert(1)</script></html>');
      fs.writeFileSync(payloadPath, payload);

      await request(app)
        .post('/api/v1/media/uploads/direct')
        .field('assetId', executableAssetId)
        .attach('file', payloadPath);

      const completeRes = await request(app)
        .post(`/api/v1/media/uploads/${executableAssetId}/complete`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(completeRes.status).toBe(400);
      expect(completeRes.body.code).toBe('SECURITY_VIOLATION_SCRIPT');

      if (fs.existsSync(payloadPath)) {
        fs.unlinkSync(payloadPath);
      }
    });
  });

  describe('Duplicate Upload Checking', () => {
    let assetId1, assetId2;
    const testFile = path.join(__dirname, 'duplicate_pixel.jpg');

    beforeAll(() => {
      const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      fs.writeFileSync(testFile, Buffer.from(base64Png, 'base64'));
    });

    afterAll(() => {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    });

    test('First upload completes and registers checksum', async () => {
      // 1. Initiate 1st
      const initRes1 = await request(app)
        .post('/api/v1/media/uploads/initiate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          assetType: 'recipe_hero',
          originalFileName: 'pixel1.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          draftId
        });
      assetId1 = initRes1.body.data.asset.assetId;

      // 2. Direct upload
      await request(app)
        .post('/api/v1/media/uploads/direct')
        .field('assetId', assetId1)
        .attach('file', testFile);

      // 3. Complete
      const compRes1 = await request(app)
        .post(`/api/v1/media/uploads/${assetId1}/complete`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(compRes1.status).toBe(200);
      expect(compRes1.body.data.uploadStatus).toBe('ready');
      expect(compRes1.body.data.checksum).toBeDefined();
    });

    test('Second upload of identical file throws duplicate error', async () => {
      // 1. Initiate 2nd
      const initRes2 = await request(app)
        .post('/api/v1/media/uploads/initiate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          assetType: 'recipe_hero',
          originalFileName: 'pixel2.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          draftId
        });
      assetId2 = initRes2.body.data.asset.assetId;

      // 2. Direct upload same file
      await request(app)
        .post('/api/v1/media/uploads/direct')
        .field('assetId', assetId2)
        .attach('file', testFile);

      // 3. Complete should throw 409 DUPLICATE_UPLOAD
      const compRes2 = await request(app)
        .post(`/api/v1/media/uploads/${assetId2}/complete`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(compRes2.status).toBe(409);
      expect(compRes2.body.code).toBe('DUPLICATE_UPLOAD');
    });
  });
});
