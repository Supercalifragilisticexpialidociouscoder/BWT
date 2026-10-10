import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Integration suites share one MongoDB test database; run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27017/campusflow_test',
      TICKET_SECRET: 'test-secret-test-secret-test-secret-0123456789',
      WEB_ORIGIN: 'http://localhost:5173',
      UPLOAD_DIR: 'test/.uploads',
      DOCUMENT_DIR: 'test/.documents',
    },
  },
});
