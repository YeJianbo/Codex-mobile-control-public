import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveZcodeModelWindow,withCurrentZcodeContext} from '../src/services/zcodeModelContext.ts';
import {zcodeNativeSessions} from '../src/services/zcodeNativeSessions.ts';

const builtin={config:{providerConfigRules:{providerRules:[{providerId:'account',config:{}}]},modelConfigRules:{modelRules:[
 {modelMatch:'.*glm-5.*',config:{properties:{contextWindow:200000}}},
 {modelMatch:'.*glm-5\\.3.*',config:{properties:{contextWindow:1000000}}},
 {modelMatch:'.*glm-5\\.3-flash.*',config:{properties:{inputFormat:{supportsImage:true}}}},
]}}};

test('current native catalog distinguishes 1M GLM-5.3 and provider-specific windows',()=>{
 const ref={providerId:'account',modelId:'GLM-5.3-Flash'};
 assert.equal(resolveZcodeModelWindow(builtin,{},ref),1000000);
 assert.equal(resolveZcodeModelWindow(builtin,{}, {...ref,modelId:'GLM-5.1'}),200000);
 assert.equal(resolveZcodeModelWindow(builtin,{}, {...ref,providerId:'unknown'}),null);
 const personal={config:{modelConfigRules:{providerModelRules:[{...ref,config:{properties:{contextWindow:512000}}}]}}};
 assert.equal(resolveZcodeModelWindow(builtin,personal,ref),512000);
});

test('a busy old host keeps real usage while the gateway corrects its stale 200K window',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cmc-zcode-context-'));
 const names=['ZCODE_BUILTIN_PROVIDER_CONFIG_FILE','ZCODE_PERSONAL_PROVIDER_CONFIG_FILE','CODEX_MOBILE_CONTROL_ZCODE_BRIDGE_CONFIG'];
 const previous=names.map(name=>process.env[name]),oldList=zcodeNativeSessions.list;
 const original={input:1200000,output:1234,cached:1000000,total:1201234,context:612658,contextWindow:200000,contextState:'reported'};
 fs.writeFileSync(path.join(root,'builtin.json'),JSON.stringify(builtin));
 process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=path.join(root,'builtin.json');
 process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=path.join(root,'personal.json');
 process.env.CODEX_MOBILE_CONTROL_ZCODE_BRIDGE_CONFIG=path.join(root,'bridge.json');
 zcodeNativeSessions.list=async()=>[{thread:{id:'zcode-original'},model:'zcode::account/GLM-5.3-Flash'}];
 try{
  const result=await withCurrentZcodeContext('zcode-original',original);
  assert.deepEqual(result,{...original,contextWindow:1000000});
  assert.equal(original.contextWindow,200000);
 }finally{
  zcodeNativeSessions.list=oldList;
  names.forEach((name,index)=>{if(previous[index]===undefined)delete process.env[name];else process.env[name]=previous[index];});
  fs.rmSync(root,{recursive:true,force:true});
 }
});
