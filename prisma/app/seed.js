// PATH: prisma/app/seed.js

/*
  Deterministic bootstrap for first superadmin + core roles.

  - Upserts roles:
      superadmin, admin, manager, finance, analyst, staff,
      support, operations, warehouse, inventory_manager,
      marketing, content_manager, dispatcher, auditor, readonly, customer
  - Upserts a single superadmin user using env:
      ADMIN_SEED_EMAIL
      ADMIN_SEED_PHONE
      ADMIN_SEED_PASSWORD
      (optional) ADMIN_SEED_NAME
  - Marks that user as CUSTOMER_AND_STAFF with:
      - customerCode: "CUST-ROOT" (if not already set)
      - StaffProfile.staffCode: "ADM-ROOT" (if not already set)
  - Links that user to the "superadmin" role via UserRole
  - Safe to re-run (idempotent)
*/

const { PrismaClient, LoginPreference, UserKind } = require("@prisma/client");
const prisma = new PrismaClient();

let bcrypt;
try {
  // bcryptjs is preferred so the hash matches what Auth.js expects
  // Make sure you have it installed: npm i bcryptjs
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  bcrypt = require("bcryptjs");
} catch (e) {
  console.warn(
    "[seed] bcryptjs not found. Please install it with `npm i bcryptjs` so the seeded password works with login."
  );
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(
      `[seed] Missing required env variable: ${name}. Add it to your .env before running the seed.`
    );
  }
  return String(v).trim();
}

async function hashPassword(plain) {
  if (!bcrypt) {
    throw new Error(
      "[seed] bcryptjs is required to hash ADMIN_SEED_PASSWORD. Install it with `npm i bcryptjs`."
    );
  }
  const saltRounds = 12;
  return bcrypt.hash(plain, saltRounds);
}

async function upsertCoreRoles() {
  // Extended role set to match src/lib/rbac.js
  const ROLE_NAMES = [
    "superadmin",
    "admin",
    "manager",
    "finance",
    "analyst",
    "staff",

    // e-commerce specific / backoffice roles
    "support",
    "operations",
    "warehouse",
    "inventory_manager",
    "marketing",
    "content_manager",
    "dispatcher",
    "auditor",
    "readonly",

    // customer role (used as default in some flows)
    "customer",
  ];

  console.log("[seed] Upserting core roles…");

  const roles = {};
  for (const name of ROLE_NAMES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    roles[name] = role;
  }

  console.log(
    "[seed] Roles ensured:",
    Object.values(roles)
      .map((r) => r.name)
      .join(", ")
  );

  return roles;
}

/**
 * Ensure the superadmin user has the correct kind + codes + staff profile.
 * - kind: CUSTOMER_AND_STAFF
 * - customerCode: "CUST-ROOT" (if not set)
 * - StaffProfile.staffCode: "ADM-ROOT" (if not set)
 */
async function ensureSuperadminIdentity(user) {
  const updates = {};

  // Business kind: this user is both customer and staff
  if (user.kind !== UserKind.CUSTOMER_AND_STAFF) {
    updates.kind = UserKind.CUSTOMER_AND_STAFF;
  }

  // Customer-facing code used on orders/invoices
  if (!user.customerCode) {
    updates.customerCode = "CUST-ROOT";
  }

  if (Object.keys(updates).length > 0) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: updates,
    });
    console.log(
      `[seed] Updated user identity kind/codes: kind=${user.kind}, customerCode=${user.customerCode}`
    );
  }

  // Ensure StaffProfile exists with a stable staffCode
  let profile = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
  });

  if (!profile) {
    profile = await prisma.staffProfile.create({
      data: {
        userId: user.id,
        staffCode: "ADM-ROOT",
        jobTitle: "Root Superadmin",
        department: "HQ",
        require2FA: true,
        sensitive: true,
      },
    });
    console.log(
      `[seed] Created StaffProfile for user id=${user.id} with staffCode=${profile.staffCode}`
    );
  } else if (!profile.staffCode) {
    profile = await prisma.staffProfile.update({
      where: { id: profile.id },
      data: { staffCode: "ADM-ROOT" },
    });
    console.log(
      `[seed] Updated StaffProfile for user id=${user.id} with staffCode=${profile.staffCode}`
    );
  } else {
    console.log(
      `[seed] StaffProfile already present for user id=${user.id} staffCode=${profile.staffCode}`
    );
  }

  return { user, profile };
}

async function upsertSuperadminUser() {
  console.log("[seed] Ensuring root superadmin user…");

  const emailEnv = (process.env.ADMIN_SEED_EMAIL || "").trim();
  const phoneEnv = (process.env.ADMIN_SEED_PHONE || "").trim();
  const passwordEnv = (process.env.ADMIN_SEED_PASSWORD || "").trim();
  const nameEnv = (process.env.ADMIN_SEED_NAME || "Root Superadmin").trim();

  if (!emailEnv && !phoneEnv) {
    throw new Error(
      "[seed] You must set at least one of ADMIN_SEED_EMAIL or ADMIN_SEED_PHONE."
    );
  }
  if (!passwordEnv) {
    throw new Error("[seed] ADMIN_SEED_PASSWORD is required.");
  }

  const passwordHash = await hashPassword(passwordEnv);
  const now = new Date();

  // Try to find existing by env email or env phone
  let user = null;
  if (emailEnv) {
    user = await prisma.user.findUnique({ where: { email: emailEnv } });
  }
  if (!user && phoneEnv) {
    user = await prisma.user.findUnique({ where: { phone: phoneEnv } });
  }

  if (!user) {
    // Fallback: maybe superadmin exists from older runs with different email
    const existingSuperadmins = await prisma.userRole.findMany({
      where: {
        role: { name: "superadmin" },
      },
      include: {
        user: true,
        role: true,
      },
      take: 1,
    });

    if (existingSuperadmins.length > 0 && existingSuperadmins[0].user) {
      user = existingSuperadmins[0].user;
    }
  }

  if (!user) {
    // Create a brand-new root superadmin user
    user = await prisma.user.create({
      data: {
        email: emailEnv || null,
        phone: phoneEnv || null,
        name: nameEnv,
        passwordHash,
        isActive: true,
        loginPreference: LoginPreference.TWO_FA, // enum-safe
        emailVerifiedAt: emailEnv ? now : null,
        emailVerified: emailEnv ? now : null,
        phoneVerifiedAt: phoneEnv ? now : null,
        termsAcceptedAt: now,
        // business identity
        kind: UserKind.CUSTOMER_AND_STAFF,
        customerCode: "CUST-ROOT",
      },
    });
    console.log(
      `[seed] Created superadmin user with id=${user.id}, email=${user.email || "—"}, phone=${
        user.phone || "—"
      }`
    );
  } else {
    // Update existing user – keep existing data but sync critical fields
    const data = {
      name: nameEnv,
      passwordHash,
      isActive: true,
      loginPreference: LoginPreference.TWO_FA,
      emailVerifiedAt: emailEnv ? user.emailVerifiedAt || now : user.emailVerifiedAt,
      emailVerified: emailEnv ? user.emailVerified || now : user.emailVerified,
      phoneVerifiedAt: phoneEnv ? user.phoneVerifiedAt || now : user.phoneVerifiedAt,
      termsAcceptedAt: user.termsAcceptedAt || now,
    };

    // Only overwrite email/phone if env provides them (and they differ)
    if (emailEnv && emailEnv !== user.email) {
      data.email = emailEnv;
    }
    if (phoneEnv && phoneEnv !== user.phone) {
      data.phone = phoneEnv;
    }

    user = await prisma.user.update({
      where: { id: user.id },
      data,
    });

    console.log(
      `[seed] Updated existing superadmin user id=${user.id}, email=${user.email || "—"}, phone=${
        user.phone || "—"
      }`
    );
  }

  // Ensure business side identity (kind + codes + StaffProfile)
  await ensureSuperadminIdentity(user);
  // Re-read to return the latest user record
  user = await prisma.user.findUnique({ where: { id: user.id } });

  return user;
}

async function attachSuperadminRole(user, roles) {
  const superRole = roles.superadmin;
  if (!superRole) {
    throw new Error("[seed] superadmin role is missing in roles map.");
  }

  console.log("[seed] Linking user to superadmin role…");

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: superRole.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: superRole.id,
    },
  });

  console.log(
    `[seed] Ensured role 'superadmin' is attached to user id=${user.id} (email=${user.email ||
      "—"})`
  );
}

async function main() {
  console.log("────────────────────────────────────────────");
  console.log(" Seeding app_db (roles + root superadmin)…");
  console.log("────────────────────────────────────────────");

  const roles = await upsertCoreRoles();
  const user = await upsertSuperadminUser();
  await attachSuperadminRole(user, roles);

  console.log("────────────────────────────────────────────");
  console.log(" Seed complete.");
  console.log(" You can now log in as the seeded superadmin.");
  console.log("────────────────────────────────────────────");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("[seed] ERROR:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
