import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file
config({ path: resolve(process.cwd(), '.env') });

export default defineConfig({
  test: {
    globals: true,
  },
});
