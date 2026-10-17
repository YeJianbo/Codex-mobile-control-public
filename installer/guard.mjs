import fs from 'node:fs';
import {PublicServices} from '../gateway/scripts/public-services.mjs';
// A fresh offline installation has a password but no user's Cloudflare tunnel.
// Reuse the existing guard once both credential/configuration files are ready.
const configured=PublicServices.prototype.configured;
PublicServices.prototype.configured=function(){return configured.call(this)&&fs.existsSync(this.tunnelConfig);};
await import('../src/supervisor.mjs');
