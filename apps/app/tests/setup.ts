// Test environment setup
process.env.NODE_ENV = 'test';
process.env.DATABASE_TYPE = 'sqlite';
process.env.JWT_SECRET = 'test-secret-key-minimum-64-characters-for-testing-purposes-only-secure-enough';
process.env.ENCRYPTION_SALT = 'test-salt-for-encryption';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.AI_IMPORT_ENABLED = 'false';
