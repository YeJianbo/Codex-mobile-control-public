// Codex Mobile Control: shared ZCode entry. The original CLI stays beside this file.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const original=path.join(__dirname,'zcode.mobile-native.cjs');
const args=process.argv.slice(2);
const configPath=process.env.CODEX_MOBILE_CONTROL_ZCODE_BRIDGE_CONFIG||path.join(process.env.CODEX_MOBILE_CONTROL_HOME||path.join(os.homedir(),'.codex-mobile-control'),'zcode-bridge','config.json');
let config;
if(!args.includes('--prepare-storage')&&(args.includes('app-server')||args.includes('agent-server'))&&fs.existsSync(configPath))config=JSON.parse(fs.readFileSync(configPath,'utf8'));
if(config?.enabled===true){
  const role=args.includes('desktop')||args.includes('--surface=desktop')?'desktop':'gateway';
  process.argv=[process.argv[0],config.proxyPath,'--role',role,'--config',configPath];
  import(require('node:url').pathToFileURL(config.proxyPath).href).catch(error=>{process.stderr.write(String(error.message)+'\n');process.exitCode=1;});
}else{
  process.argv[1]=original;
  require('node:module').runMain();
}
