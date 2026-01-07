// this file lives in /scripts, so we go up one level to reach /src
const { PrismaClient } = require("../src/generated/prisma/strapi");
const db = new PrismaClient();

(async () => {
  try {
    const rows = await db.$queryRawUnsafe(
      "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name LIMIT 25;"
    );
    console.table(rows);
    process.exit(0);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
})();
