import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readAndroidRelease} from '../dist/services/androidUpdates.js';
import {permittedPublicRequest,isPublicAndroidDownload} from './public-routes.mjs';

test('publishing keeps the served APK and update metadata together',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-app-update-'));
  try{
    const bytes=Buffer.from('fixture APK'),apk=path.join(dir,'release.apk'),metadata=path.join(dir,'output-metadata.json'),target=path.join(dir,'downloads');
    await fs.writeFile(apk,bytes);await fs.writeFile(metadata,JSON.stringify({applicationId:'com.localcodex.control',elements:[{versionName:'0.6.468',versionCode:440}]}));
    execFileSync(process.execPath,[fileURLToPath(new URL('./publish-android.mjs',import.meta.url)),'--apk',apk,'--metadata',metadata,'--target',target],{windowsHide:true});
    const release=await readAndroidRelease(target);
    assert.equal(release.versionCode,440);assert.equal(release.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(await fs.readFile(path.join(target,'android.apk')),bytes);
    await fs.writeFile(path.join(target,'android.apk'),'incomplete');await assert.rejects(readAndroidRelease(target),/正在发布/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('update metadata follows the existing public APK channel without opening other downloads',()=>{
  for(const method of ['GET','HEAD']){
    assert(isPublicAndroidDownload(method,'/downloads/android.json'));assert(permittedPublicRequest(method,'/downloads/android.json'));
  }
  assert.equal(permittedPublicRequest('POST','/downloads/android.json'),false);
  assert.equal(permittedPublicRequest('GET','/downloads/other.json'),false);
});
