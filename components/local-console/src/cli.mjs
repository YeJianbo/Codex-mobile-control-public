import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {locations, readJson, seed, sync, officialModels} from './catalog.mjs';
import {applyDesktop,restoreDesktop,desktopStatus} from './claude-desktop.mjs';
const args = process.argv.slice(2);
const command = args.shift() || 'status';
const homeArg = args.indexOf('--home');
const home = path.resolve(homeArg >= 0 ? args[homeArg + 1] : process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
const l = locations(home);
function output(v) { console.log(JSON.stringify(v)); }
function status() {
  const current = readJson(l.catalog).value;
  const state = readJson(l.state).value;
  return {home, routerEnabled: state.codexRouterEnabled, noAccountMode: state.codexRouterNoAccountMode,
    official: officialModels(current).map(m => m.slug), total: current.models.length,
    snapshotPresent: fs.existsSync(l.saved), watcher: fs.existsSync(path.join(l.local, 'watcher.lock')) ? readJson(path.join(l.local, 'watcher.lock')).value : null};
}
function watch() {
  fs.mkdirSync(l.local, {recursive: true});
  const lock = path.join(l.local, 'watcher.lock');
  if (fs.existsSync(lock)) {
    const old = readJson(lock).value;
    try { process.kill(old.pid, 0); throw new Error(`Watcher already running as PID ${old.pid}`); }
    catch (e) { if (e.code !== 'ESRCH') throw e; fs.unlinkSync(lock); }
  }
  fs.writeFileSync(lock, JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}), {flag: 'wx'});
  let timer, watcher, watchedIdentity, lastError;
  const log = (entry) => {
    const file = path.join(l.local, 'events.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 262144) fs.renameSync(file, file + '.previous');
    fs.appendFileSync(file, JSON.stringify({at: new Date().toISOString(), ...entry}) + '\n');
  };
  const run = () => {
    try { const result = sync(home); if (result.status === 'restored') log(result); lastError = null; }
    catch (e) { const code = e.code || e.name; if (lastError !== code) {log({status: 'deferred', code}); lastError = code;} }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
  const attach = () => {
    try {
      const s = fs.statSync(l.relay); const identity = `${s.dev}:${s.ino}`;
      if (watcher && watchedIdentity === identity) return;
      watcher?.close();
      watcher = fs.watch(l.relay, (event, name) => {if (!name || ['state.json', 'codex_router_catalog.json'].includes(String(name))) schedule();});
      watchedIdentity = identity;
      watcher.on('error', () => {watcher?.close();watcher = null;});
    } catch { watcher?.close(); watcher = null; }
  };
  attach(); run(); log({status: 'watcher-started', pid: process.pid});
  // Low-rate recovery for directory replacement/missed filesystem notifications.
  const poll = setInterval(() => {attach();run();}, 30000);
  const close = () => {clearInterval(poll);clearTimeout(timer);watcher?.close();try {if(readJson(lock).value.pid === process.pid)fs.unlinkSync(lock);}catch{};process.exit(0);};
  process.on('SIGINT', close);process.on('SIGTERM', close);
}
try {
  if (command === 'status') output(status());
  else if (command === 'seed') output(seed(home, args[0]));
  else if (command === 'sync') output(sync(home));
  else if (command === 'claude-desktop-apply') output(applyDesktop({dir:path.join(home,'codexmate','local-console')}));
  else if (command === 'claude-desktop-restore') output(restoreDesktop({dir:path.join(home,'codexmate','local-console')}));
  else if (command === 'claude-desktop-status') output(desktopStatus({dir:path.join(home,'codexmate','local-console')}));
  else if (command === 'watch') watch();
  else if (command === 'start') {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'watch', '--home', home], {detached: true, windowsHide: true, stdio: 'ignore'});
    child.on('error', e => {console.error(e.message);process.exitCode = 1;});
    child.unref(); output({status: 'starting', pid: child.pid});
  }
  else throw new Error('Usage: node src/cli.mjs status|seed FILE|sync|watch [--home DIR]');
} catch(e) {console.error(e.message);process.exitCode = 1;}
