import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle dependencies for cleaner deployment
  noExternal: ['@skyplanner/auth', '@skyplanner/database'],
  // Keep these as external (installed via npm)
  external: [
    'express',
    'cors',
    'helmet',
    'bcryptjs',
    'jsonwebtoken',
    'nodemailer',
    'pino',
    'pino-pretty',
    'node-cron',
    'multer',
    'uuid',
    'xlsx',
    'dotenv',
    '@supabase/supabase-js',
    'better-sqlite3',
    'express-rate-limit',
  ],
});
