import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const home=process.env.CODEX_MOBILE_CONTROL_HOME||path.join(os.homedir(),'.codex-mobile-control');
const configPath=path.join(home,'public-access.json');
const passwordPath=path.join(home,'public-password.txt');
const port=Number(process.argv[2]||48763);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid port');
await fs.mkdir(home,{recursive:true});
try {
  await fs.access(configPath);
  console.log('Public access settings already exist; no credentials changed.');
}catch {
  const password=crypto.randomBytes(32).toString('base64url');
  const settings={
    port,
    passwordSha256:crypto.createHash('sha256').update(password).digest('hex'),
    proxySecret:crypto.randomBytes(40).toString('base64url'),
  };
  await fs.writeFile(configPath,JSON.stringify(settings,null,2),{flag:'wx',mode:0o600});
  await fs.writeFile(passwordPath,password+'\n',{flag:'wx',mode:0o600});
  console.log('Public access settings and phone password saved under '+home);
}
