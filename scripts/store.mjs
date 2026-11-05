// Where the daily jobs read and save the app content: the "docs" table in Supabase.
// Needs the GitHub repository secret SUPABASE_SERVICE_KEY: the Secret key (sb_secret_…) from
// Supabase → Project Settings → API Keys. It never goes into the app.
//
// Saving is safe if an admin saves at the same time: if the document changed while the job was running,
// the job re-reads it and only copies over the fields it is responsible for.
import { writeFile } from "node:fs/promises";

const URL_ = (process.env.SUPABASE_URL || "https://xzyzovlmlppvctbpxnrw.supabase.co").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_KEY || "";
if (!KEY) {
  const msg = "Missing the SUPABASE_SERVICE_KEY secret. Add it on GitHub: repo Settings → Secrets and variables → Actions → New repository secret.";
  if (process.env.SKIP_IF_NO_KEY) { console.log("::warning::" + msg); process.exit(0); }
  console.error(msg);
  process.exit(1);
}
// New-style secret keys (sb_secret_…) go in the apikey header only; the older service_role key (a JWT) also as Bearer.
const H = KEY.startsWith("sb_")
  ? { apikey: KEY, "Content-Type": "application/json" }
  : { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const versions = {}, originals = {};

export async function load(name, fallback) {
  const r = await fetch(`${URL_}/rest/v1/docs?name=eq.${name}&select=content,version`, { headers: H });
  if (!r.ok) throw new Error(`Supabase: couldn't read ${name} (${r.status}) ${await r.text()}`);
  const rows = await r.json();
  if (!rows.length) { versions[name] = 0; originals[name] = ""; return fallback; }
  versions[name] = rows[0].version;
  originals[name] = JSON.stringify(rows[0].content);
  return rows[0].content;
}

/* Save a document. merge(latest) is used if someone else saved it meanwhile: it must apply this job's
   changes onto the latest copy and return it. Returns true if something was saved. */
export async function save(name, obj, merge) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const text = JSON.stringify(obj);
    if (text === originals[name]) return false;
    const v = versions[name];
    let r;
    if (!v) {
      r = await fetch(`${URL_}/rest/v1/docs`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ name, content: obj, updated_by: "daily job" }) });
    } else {
      r = await fetch(`${URL_}/rest/v1/docs?name=eq.${name}&version=eq.${v}`, {
        method: "PATCH", headers: { ...H, Prefer: "return=representation" },
        body: JSON.stringify({ content: obj, version: v + 1, updated_at: new Date().toISOString(), updated_by: "daily job" })
      });
    }
    if (!r.ok && r.status !== 409) throw new Error(`Supabase: couldn't save ${name} (${r.status}) ${await r.text()}`);
    const rows = r.ok ? await r.json() : [];
    if (rows.length) { versions[name] = rows[0].version; originals[name] = text; return true; }
    // Changed meanwhile: merge onto the latest copy and try again.
    console.log(`  ${name} was changed while the job ran — merging.`);
    const latest = await load(name, null);
    if (!merge || !latest) throw new Error(`${name} changed while the job ran and can't be merged`);
    obj = merge(latest);
  }
  throw new Error(`Couldn't save ${name} after several tries`);
}

/* Copy the given fields from the job's list onto the latest list, matching items by key. */
export function mergeFields(latestList, jobList, key, fields) {
  const byKey = new Map((jobList || []).map(x => [x[key], x]));
  for (const item of latestList || []) {
    const mine = byKey.get(item[key]);
    if (!mine) continue;
    for (const f of fields) { if (f in mine) item[f] = mine[f]; else delete item[f]; }
  }
  return latestList;
}

/* Keep a copy of every document in data/ (a backup in the repo's history). */
export async function backup(names) {
  for (const n of names) {
    const doc = await load(n, null);
    if (doc) await writeFile(new URL(`../data/${n}.json`, import.meta.url), JSON.stringify(doc, null, 2) + "\n");
  }
}
