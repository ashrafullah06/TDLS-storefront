// FILE: scripts/dev-app.mjs
// Loads env in Next's precedence, then sets DATABASE_URL from APP_DB_USER_POOLER_CB if needed, then starts Next dev.

import fs from 'node:fs';
import { spawn } from 'node:child_process';

// Load env with correct precedence: .env → .env.development → .env.local, but allow later files to override earlier.
let dotenv;
try { ({ config: dotenv } = await import('dotenv')); } catch {}
const load = (p) => { if (dotenv && fs.existsSync(p)) dotenv({ path: p, override: true }); };
load('.env');
load('.env.development');
load('.env.local');

// Prefer existing DATABASE_URL; otherwise fallback to APP_DB_USER_POOLER_CB
const pickDbUrl = () => {
  const a = process.env.DATABASE_URL;
  if (a && /^postgres(ql)?:\/\//.test(a)) return a;
  const b = process.env.APP_DB_USER_POOLER_CB;
  if (b && /^postgres(ql)?:\/\//.test(b)) return b;
  return null;
};

const dbUrl = pickDbUrl();
if (dbUrl) process.env.DATABASE_URL = dbUrl;

const child = spawn(
  'node',
  ['./node_modules/next/dist/bin/next', 'dev', '--turbopack'],
  { stdio: 'inherit', env: process.env }
);

child.on('exit', (code) => process.exit(code ?? 0));
