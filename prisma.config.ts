// PATH: prisma.config.ts
import "dotenv/config"; // ensures .env is loaded automatically
import { defineConfig } from "prisma/config";

export default defineConfig({
  // Default schema for generic `npx prisma ...` commands
  schema: "prisma/app/schema.prisma",
});
