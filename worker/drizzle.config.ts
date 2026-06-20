import { defineConfig } from 'drizzle-kit'

// Drizzle Kit: migrations + studio. The schema is shared with the app and lives at
// ../src/lib/db/schema.ts; migrations are written to ../drizzle (both at the app root).
export default defineConfig({
  schema: '../src/lib/db/schema.ts',
  out: '../drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
})
