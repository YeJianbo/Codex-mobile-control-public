import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';

const releaseSchema=z.object({
  packageName:z.literal('com.localcodex.control'),versionName:z.string().min(1),versionCode:z.number().int().positive(),
  size:z.number().int().positive().max(100*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/),
  notes:z.string().max(20000).default(''),publishedAt:z.string(),
});

export async function readAndroidRelease(directory:string){
  const release=releaseSchema.parse(JSON.parse(await fs.readFile(path.join(directory,'android.json'),'utf8')));
  const apk=await fs.stat(path.join(directory,'android.apk'));
  if(!apk.isFile()||apk.size!==release.size)throw Error('Android 更新正在发布，请稍后重试');
  return release;
}
