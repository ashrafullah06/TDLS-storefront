// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"       // change if needed: "mysql" | "sqlite" | "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String?  @unique
  phone        String?  @unique
  name         String?
  passwordHash String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model OtpCode {
  id         String   @id @default(cuid())
  identifier String
  codeHash   String
  channel    String
  purpose    String   @default("login")
  expiresAt  DateTime
  attempts   Int      @default(0)
  createdAt  DateTime @default(now())

  @@index([identifier, purpose])
  @@index([expiresAt])
}
