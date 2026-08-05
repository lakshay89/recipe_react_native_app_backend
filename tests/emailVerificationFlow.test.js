const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const { connectDB, disconnectDB } = require('../src/config/database');
const User = require('../src/models/User');
const EmailOtp = require('../src/models/EmailOtp');

describe('Email Verification & OTP Flow Integration Tests', () => {
  let testUser;
  let testVerificationId;
  let testOtp;
  const userEmail = `otp.test.${Date.now()}@example.com`;
  const userMobile = `9${String(Date.now()).substring(4, 13)}`;

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    if (testUser) {
      await User.deleteMany({ email: userEmail });
      await EmailOtp.deleteMany({ userId: testUser._id });
    }
    await disconnectDB();
  });

  describe('Contributor Registration & OTP Generation', () => {
    test('Successful registration creates user and returns verificationId', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Heritage Contributor',
          email: userEmail,
          mobile: userMobile,
          password: 'Password123',
          termsAccepted: true
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.verificationId).toBeDefined();
      expect(response.body.data.developmentOtp).toBeDefined();
      
      testVerificationId = response.body.data.verificationId;
      testOtp = response.body.data.developmentOtp;
      testUser = response.body.data.user;
    });

    test('Already registered user cannot register again', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Heritage Contributor Duplicate',
          email: userEmail,
          mobile: userMobile,
          password: 'Password123',
          termsAccepted: true
        });

      expect(response.status).toBe(409);
      expect(response.body.success).toBe(false);
    });
  });

  describe('OTP Email Verification', () => {
    test('Verification fails with invalid 6-digit OTP format (e.g. 4 digits)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({
          verificationId: testVerificationId,
          otp: '1234'
        });

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
    });

    test('Verification fails with incorrect 6-digit code', async () => {
      const response = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({
          verificationId: testVerificationId,
          otp: '000000'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('OTP_INVALID');
    });

    test('Verification succeeds with correct 6-digit code', async () => {
      const response = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({
          verificationId: testVerificationId,
          otp: testOtp
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.isEmailVerified).toBe(true);

      // Verify the user status is active now
      const verifiedUser = await User.findById(testUser.id);
      expect(verifiedUser.isEmailVerified).toBe(true);
      expect(verifiedUser.status).toBe('active');
    });

    test('Cannot verify again using already used OTP', async () => {
      const response = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({
          verificationId: testVerificationId,
          otp: testOtp
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('OTP_INVALID');
    });
  });

  describe('Resend Verification OTP', () => {
    test('Resend OTP issues a new code for verified user (as idempotent or success confirmation)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({
          email: userEmail
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('Resend OTP for unverified user produces a new OTP successfully', async () => {
      // 1. Create a new unverified user
      const freshEmail = `fresh.${Date.now()}@example.com`;
      const freshMobile = `9${String(Date.now()).substring(4, 13)}9`;
      
      const regRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          fullName: 'Fresh Contributor',
          email: freshEmail,
          mobile: freshMobile.substring(0, 10),
          password: 'Password123',
          termsAccepted: true
        });

      expect(regRes.status).toBe(201);
      const firstId = regRes.body.data.verificationId;

      // 2. Resend verification
      const resendRes = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({
          email: freshEmail
        });

      expect(resendRes.status).toBe(200);
      expect(resendRes.body.success).toBe(true);
      expect(resendRes.body.data.verificationId).toBeDefined();
      expect(resendRes.body.data.verificationId).not.toBe(firstId);

      // Clean up fresh user and their OTPs
      const freshUser = await User.findOne({ email: freshEmail });
      if (freshUser) {
        await EmailOtp.deleteMany({ userId: freshUser._id });
        await User.deleteOne({ _id: freshUser._id });
      }
    });
  });
});
