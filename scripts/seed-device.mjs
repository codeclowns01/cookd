/**
 * seed-device.mjs — Provision a test user + device and write companion credentials.
 * Use this for live E2E testing before device-link edge functions are deployed.
 *
 * Usage:
 *   node scripts/seed-device.mjs [--handle myhandle]
 *   node scripts/seed-device.mjs --cleanup
 *
 * Loads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from cookd-app/.env (two dirs up),
 * then falls back to env vars already in the shell.
 */
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env from cookd-app/.env if present (two dirs up from scripts/)
const envPath = resolve(__dirname, "../../cookd-app/.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2];
  }
}

const URL_ = process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !SVC) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = (path, init = {}) =>
  fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: SVC,
      Authorization: `Bearer ${SVC}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });

const COOKD_DIR = join(homedir(), ".cookd");
const CREDS_PATH = join(COOKD_DIR, "credentials.json");
const META_PATH = join(COOKD_DIR, "seed-meta.json");

async function seed(handle) {
  console.log(`\nSeeding companion device for handle: ${handle}`);

  // 1. Create auth user
  const email = `cookd-seed-${handle}@cookd.dev`;
  const password = "Seed-" + randomBytes(8).toString("hex");
  const ur = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { user_name: handle },
    }),
  });
  const user = await ur.json();
  if (!user.id) {
    console.error("createUser failed:", JSON.stringify(user, null, 2));
    process.exit(1);
  }
  console.log(`  created user  ${user.id}  (${email})`);

  // 2. Create device row
  const rawToken = "cookd_" + randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await admin("/rest/v1/devices", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: user.id,
      label: `${hostname()}-seed`,
      token_hash: tokenHash,
    }),
  });
  const deviceId = randomBytes(16).toString("hex");
  console.log(`  created device  token_hash=${tokenHash.slice(0, 12)}…`);

  // 3. Write credentials
  mkdirSync(COOKD_DIR, { recursive: true });
  const creds = {
    deviceToken: rawToken,
    handle,
    deviceId,
    linkedAt: new Date().toISOString(),
  };
  writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
  console.log(`  wrote credentials  ${CREDS_PATH}`);

  // 4. Write seed meta for cleanup later
  writeFileSync(META_PATH, JSON.stringify({ userId: user.id, handle, email }, null, 2));

  console.log(`\n  handle     : ${handle}`);
  console.log(`  userId     : ${user.id}`);
  console.log(`  deviceToken: ${rawToken.slice(0, 20)}…`);
  console.log(`\nReady. Run:`);
  console.log(`  $env:COOKD_API_URL="https://efocqoekmoiecisrmucn.supabase.co"; node dist/cli.js watch`);
  console.log(`\nClean up later with:`);
  console.log(`  node scripts/seed-device.mjs --cleanup`);
}

async function cleanup() {
  if (!existsSync(META_PATH)) {
    console.error("No seed-meta.json found — nothing to clean up.");
    process.exit(1);
  }
  const { userId, handle } = JSON.parse(readFileSync(META_PATH, "utf8"));
  console.log(`Cleaning up seeded user: ${handle} (${userId})`);
  const r = await admin(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
  if (r.status === 200 || r.status === 204) {
    console.log("  user deleted (devices/limit_states/daily_snapshots cascade)");
    for (const p of [CREDS_PATH, META_PATH]) {
      try { unlinkSync(p); console.log(`  removed ${p}`); } catch { /* already gone */ }
    }
  } else {
    const body = await r.text();
    console.error(`  delete failed: ${r.status} ${body}`);
  }
}

const args = process.argv.slice(2);
if (args.includes("--cleanup")) {
  cleanup().catch((e) => { console.error(e); process.exit(1); });
} else {
  const hIdx = args.indexOf("--handle");
  const handle = hIdx >= 0 ? args[hIdx + 1] : "testchef";
  seed(handle).catch((e) => { console.error(e); process.exit(1); });
}
