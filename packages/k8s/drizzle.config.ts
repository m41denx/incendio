import { defineConfig } from "drizzle-kit";

// drizzle-kit is used for local schema evolution and studio only. The agent
// itself bootstraps tables at boot via CREATE TABLE IF NOT EXISTS (see
// src/db/index.ts), so a migration step is not required inside the appliance.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DB_PATH ?? "incendio-k8s.sqlite",
  },
});
