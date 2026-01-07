// FILE: scripts/db/ping.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const r = await prisma.$queryRaw`SELECT 1 AS ok`;
  console.log('DB OK:', r);
  process.exit(0);
} catch (e) {
  console.error('DB ERROR:', e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
