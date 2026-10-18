import fs from 'node:fs';
import path from 'node:path';

export const OFFICIAL = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
export function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return { raw, value: JSON.parse(raw.replace(/^\uFEFF/, '')) };
}
export function validModels(value) {
  if (!value || !Array.isArray(value.models) || !value.models.length) return false;
  const names = new Set();
  return value.models.every(m => {
    if (!m || typeof m.slug !== 'string' || !m.slug || names.has(m.slug)) return false;
    names.add(m.slug); return true;
  });
}
export function officialModels(value) {
  if (!validModels(value)) throw new Error('Invalid or empty model catalog');
  return value.models.filter(m => !m.slug.includes('::'));
}
export function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.${process.pid}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
export function locations(home) {
  const relay = path.join(home, 'codexmate', 'relay');
  const local = path.join(home, 'codexmate', 'aimami-local');
  return {relay, local, catalog: path.join(relay, 'codex_router_catalog.json'),
    state: path.join(relay, 'state.json'), saved: path.join(local, 'official-models.json')};
}
export function seed(home, file) {
  const l = locations(home);
  const models = officialModels(readJson(file).value);
  if (!models.length) throw new Error('Seed has no known official models');
  if (fs.existsSync(l.saved)) throw new Error('Official snapshot already exists; refusing to replace it');
  atomicWrite(l.saved, {schemaVersion: 1, models});
  return {status: 'seeded', models: models.map(m => m.slug)};
}
export function sync(home) {
  const l = locations(home);
  // An absent/malformed state cannot authorize re-enabling official routes.
  const stateSnapshot = readJson(l.state);
  const state = stateSnapshot.value;
  if (state.codexRouterEnabled !== true) return {status: 'router-disabled'};
  if (state.codexRouterNoAccountMode === true) return {status: 'no-account-mode'};
  if (state.codexRouterNoAccountMode !== false) return {status: 'unknown-account-mode'};
  const current = readJson(l.catalog);
  if (!validModels(current.value)) throw new Error('Invalid or empty generated catalog; leaving it untouched');
  const saved = readJson(l.saved).value;
  const prior = officialModels(saved);
  if (!prior.length) throw new Error('Official snapshot has no usable models');
  const observed = officialModels(current.value);
  const all = new Map(prior.map(m => [m.slug, m]));
  for (const m of observed) all.set(m.slug, m);
  const models = [...all.values()];
  if (JSON.stringify(prior) !== JSON.stringify(models)) atomicWrite(l.saved, {schemaVersion: 1, models});
  const present = new Set(current.value.models.map(m => m.slug));
  const missing = models.filter(m => !present.has(m.slug));
  if (!missing.length) return {status: 'unchanged', count: present.size};
  // Do not overwrite a generation that changed while this snapshot was read.
  if (fs.readFileSync(l.catalog, 'utf8') !== current.raw || fs.readFileSync(l.state, 'utf8') !== stateSnapshot.raw) return {status: 'concurrent-write'};
  atomicWrite(l.catalog, {...current.value, models: [...missing, ...current.value.models]});
  return {status: 'restored', restored: missing.map(m => m.slug), count: present.size + missing.length};
}
