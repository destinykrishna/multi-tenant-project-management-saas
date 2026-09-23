import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required').default('redis://localhost:6379'),

  // SMTP Email Configuration
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .transform((val) => val === 'true')
    .or(z.boolean())
    .default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  EMAIL_FROM: z.string().default('noreply@multitenantbackend.com'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Google OAuth Integration
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z
    .string()
    .default('http://localhost:3000/api/v1/integrations/google/callback'),

  // Token Encryption Key (Optional, falls back to SHA256 derived key from JWT_SECRET)
  TOKEN_ENCRYPTION_KEY: z.string().default(''),

  // RAG & Embeddings
  EMBEDDING_PROVIDER: z.enum(['mock', 'openai', 'gemini', 'groq']).default('mock'),
  EMBEDDING_API_KEY: z.string().default(''),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSION: z.coerce.number().int().positive().default(1536),
  RAG_DEFAULT_TOP_K: z.coerce.number().int().positive().default(5),
  RAG_MIN_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  RAG_MAX_CONTEXT_LENGTH: z.coerce.number().int().positive().default(12000),

  // LLM Configuration
  LLM_PROVIDER: z.enum(['mock', 'groq', 'openai', 'gemini']).default('mock'),
  GROQ_API_KEY: z.string().default(''),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),

  // AI & Agent Execution Limits
  AI_MAX_STEPS: z.coerce.number().int().positive().default(10),
  AI_MAX_TOOL_CALLS: z.coerce.number().int().positive().default(5),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2048),

  // Cloudflare CDN & Edge Security
  CLOUDFLARE_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .or(z.boolean())
    .default(false),
  CLOUDFLARE_ZONE_ID: z.string().default(''),
  CLOUDFLARE_API_TOKEN: z.string().default(''),
  CLOUDFLARE_TURNSTILE_SECRET_KEY: z.string().default(''),
  CLOUDFLARE_ORIGIN_PULL_SECRET: z.string().default(''),

  // Platform Administration & Infrastructure Operations
  PLATFORM_ADMIN_SECRET: z.string().default(''),

  // Reverse Proxy & Nginx
  TRUST_PROXY: z
    .string()
    .transform((val) => (val === 'true' ? 1 : val === 'false' ? 0 : Number(val) || 1))
    .or(z.number())
    .or(z.boolean())
    .default(1),

  // Background Workers
  ENABLE_INLINE_WORKERS: z
    .string()
    .transform((val) => val === 'true')
    .or(z.boolean())
    .optional(),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error('❌ Environment validation failed:\n' + formatted);
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
