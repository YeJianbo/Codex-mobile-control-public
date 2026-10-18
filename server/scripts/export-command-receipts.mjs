import path from 'node:path';
import os from 'node:os';
import {parseArgs} from 'node:util';
import {CommandReceipts} from '../dist/services/commandReceipts.js';

const {values}=parseArgs({options:{file:{type:'string'},output:{type:'string'}}});
if(!values.output)throw new Error('用法：node scripts/export-command-receipts.mjs --output <JSON 路径> [--file <原 JSON 路径>]。回退前先停止网关。');
const home=process.env.CODEX_MOBILE_CONTROL_HOME||path.join(os.homedir(),'.codex-mobile-control');
const receipts=new CommandReceipts(values.file||path.join(home,'command-receipts.json'));
try{await receipts.exportJson(path.resolve(values.output));console.log('提交记录已导出。');}
finally{receipts.close();}
