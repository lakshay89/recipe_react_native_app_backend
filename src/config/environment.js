const { z } = require('zod');
require('dotenv').config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_VERSION: z.string().default('v1'),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/edible_india'),
  MONGODB_URI_TEST: z.string().optional(),
  ACCESS_TOKEN_SECRET: z.string().min(32).default('development-access-secret-change-me-123456789'),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_SECRET: z.string().min(32).default('development-refresh-secret-change-me-123456789'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),
  OTP_SECRET: z.string().min(16).default('development-otp-secret-change-me'),
  OTP_EXPIRES_MINUTES: z.coerce.number().int().positive().default(10),
  PASSWORD_RESET_EXPIRES_MINUTES: z.coerce.number().int().positive().default(15),
  CLIENT_APP_ORIGINS: z.string().default('http://localhost:3000'),
  JSON_BODY_LIMIT: z.string().default('1mb'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  STORAGE_PROVIDER: z.enum(['local', 'r2']).default('local'),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.STORAGE_PROVIDER === 'r2') {
    ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'].forEach((key) => {
      if (!env[key] || env[key].trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when STORAGE_PROVIDER is r2`
        });
      }
    });
  }

  if (env.NODE_ENV === 'production') {
    const unsafe = ['development-access-secret', 'development-refresh-secret', 'development-otp-secret'];
    [env.ACCESS_TOKEN_SECRET, env.REFRESH_TOKEN_SECRET, env.OTP_SECRET].forEach((value, index) => {
      if (unsafe.some((prefix) => value.startsWith(prefix))) {
        ctx.addIssue({ code: 'custom', path: [['ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_SECRET', 'OTP_SECRET'][index]], message: 'Production secrets must be configured' });
      }
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const messages = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${messages}`);
}

module.exports = parsed.data;
