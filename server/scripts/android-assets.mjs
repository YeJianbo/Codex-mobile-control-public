import {transform} from 'esbuild';
import {readdir,readFile,writeFile} from 'node:fs/promises';
const root=new URL('../../android/app/src/main/assets/console/',import.meta.url);
for(const name of await readdir(root)) {
  if(!name.endsWith('.js')) continue;
  const file=new URL(name,root);
  const result=await transform(await readFile(file,'utf8'),{target:'chrome80',loader:'js',minify:false});
  await writeFile(file,result.code);
}

