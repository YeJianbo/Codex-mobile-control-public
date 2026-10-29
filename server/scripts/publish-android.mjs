import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2);
const value=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const apk=value('--apk'),metadataPath=value('--metadata');
if(!apk||!metadataPath)throw Error('Usage: node scripts/publish-android.mjs --apk APK --metadata output-metadata.json [--notes-file notes.txt] [--target downloads-directory]');
const metadata=JSON.parse(await fs.readFile(metadataPath,'utf8'));
if(metadata.applicationId!=='com.localcodex.control'||metadata.elements?.length!==1)throw Error('Expected one production Android APK');
const element=metadata.elements[0],bytes=await fs.readFile(apk);
const release={packageName:metadata.applicationId,versionName:element.versionName,versionCode:element.versionCode,size:bytes.length,
  sha256:createHash('sha256').update(bytes).digest('hex'),notes:value('--notes-file')?await fs.readFile(value('--notes-file'),'utf8'):'',publishedAt:new Date().toISOString()};
if(!Number.isInteger(release.versionCode)||release.versionCode<1||!release.versionName)throw Error('Invalid Android build metadata');
const targetIndices=args.flatMap((arg,index)=>arg==='--target'?[index]:[]);
const targets=targetIndices.length?targetIndices.map(index=>args[index+1]):[fileURLToPath(new URL('../public/downloads/',import.meta.url))];
for(const target of targets){
  if(!target)throw Error('Missing target directory');
  await fs.mkdir(target,{recursive:true});
  for(const [name,content] of [['android.apk',bytes],['android.json',JSON.stringify(release,null,2)+'\n']]){
    const file=path.join(target,name);await fs.writeFile(file+'.pending',content);await fs.rename(file+'.pending',file);
  }
}
console.log(JSON.stringify({versionName:release.versionName,versionCode:release.versionCode,size:release.size,targets}));
