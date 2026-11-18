import { defineConfig } from "vitest/config";

export const DDB_PORT = 8010;

// Integration tests run the real Lambda handlers against DynamoDB Local (started in Docker by globalSetup).
// Set DDB_ENDPOINT to reuse a DynamoDB Local you already run (CI service container), and Docker is skipped.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    fileParallelism: false, // one shared table and stream
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "local",
      AWS_SECRET_ACCESS_KEY: "local",
      AWS_ENDPOINT_URL_DYNAMODB: process.env.DDB_ENDPOINT ?? `http://localhost:${DDB_PORT}`,
      TABLE_NAME: "xpense-it",
      ORIGIN_SECRET: "it-origin-secret",
      UPLOAD_BUCKET: "it-uploads",
      INGEST_QUEUE_URL: "https://sqs.local/ingest",
      FORECAST_QUEUE_URL: "https://sqs.local/forecast",
      USER_POOL_ID: "us-east-1_local",
      CLIENT_ID: "local",
      DDB_MAX_ATTEMPTS: "1",
    },
  },
});
