import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
const input=JSON.parse(await new Promise(resolve=>{let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>resolve(data));}));
const require=createRequire(path.join(process.argv[2],'package.json'));
const load=name=>import(pathToFileURL(require.resolve(name)).href);
const home=process.env.DSH_HOME?path.resolve(process.env.DSH_HOME.replace(/^~(?=[\\/]|$)/,os.homedir())):path.join(os.homedir(),'.dsh');
let ctx;
try{
  const [{Context},{LocalCredentialProvider},{createLaunchEnvironmentSnapshot},{parseDocument,isSeq},{withFileLock,writeFileAtomic}]=await Promise.all([
    load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-credentials-local'),load('@deepseek-ai/dsh-launch-environment'),load('yaml'),load('@deepseek-ai/dsh-atomic-write')
  ]);
  const read=async filename=>{try{return await fs.readFile(filename,'utf8');}catch(e){if(e.code==='ENOENT')return '';throw e;}};
  const patchFile=path.join(home,'cordis.patch.yml');
  const acpPatchFile=path.join(home,'profiles','acp','cordis.patch.yml');
  const desktopPatchFile=path.join(home,'profiles','desktop','cordis.patch.yml');
  const parse=raw=>{const doc=parseDocument(raw||'[]');if(doc.errors.length||!isSeq(doc.contents))throw new Error('patch');return doc;};
  const homeDoc=parse(await read(patchFile)),profileDoc=parse(await read(acpPatchFile)),desktopDoc=parse(await read(desktopPatchFile));
  const overrides=[...profileDoc.toJS(),...homeDoc.toJS()];
  const config=id=>overrides.filter(x=>x?.id===id&&Object.hasOwn(x,'config')).at(-1)?.config||{};
  const llm=config('llm-deepseek'),defaults=config('agent-default-model');
  // Desktop provider declarations are also mounted by the mobile ACP adapter.
  const piConfigs=[...desktopDoc.toJS(),...overrides].filter(row=>row?.id==='llm-pi-ai').map(row=>row.config||{});
  const providers=Object.assign({},...piConfigs.map(row=>row.providers||{}));
  const declaredModel=defaults.model||config('acp').model||'deepseek-flash';
  const declaredProvider=defaults.provider||config('acp').provider||'deepseek-official';
  const matches=Object.entries(providers).filter(([,value])=>value.models?.some(model=>model.id===declaredModel));
  const activeProvider=providers[declaredProvider]?declaredProvider:matches.length===1?matches[0][0]:declaredProvider;
  const userEnv=parseEnv(await read(path.join(home,'.env')));
  ctx=new Context();ctx.provide('launchEnvironment',createLaunchEnvironmentSnapshot([{source:'process',values:process.env},{source:'user-env',values:userEnv}]));
  await ctx.plugin(LocalCredentialProvider,{dshHome:home,watch:false}).await();
  const routeFor=provider=>provider==='deepseek-official'?{api:'anthropic-messages',apiKeyEnv:llm.apiKeyEnv||'DEEPSEEK_API_KEY',baseURL:llm.baseURL||process.env.DEEPSEEK_BASE_URL||userEnv.DEEPSEEK_BASE_URL||'https://api.deepseek.com/anthropic'}:providers[provider];
  const currentRoute=routeFor(activeProvider);
  if(!currentRoute)throw new Error('未找到所选供应商，请检查原生模型配置');
  const ref=currentRoute.apiKeyEnv||('DSH_'+activeProvider.toUpperCase().replace(/[^A-Z0-9]/g,'_')+'_API_KEY'),credential=await ctx.credentials.describe(ref);
  const currentBase=String(currentRoute.baseURL||'').replace(/\/+$/,'');
  let baseUrl='';try{const url=new URL(currentBase);if(!url.username&&!url.password&&!url.search&&!url.hash)baseUrl=currentBase;}catch{}
  const status=()=>({app:'deepseek',name:'DeepSeek Harness',installed:true,configured:credential.configured&&!!baseUrl,hasKey:credential.configured,keyWritable:credential.writable,keySource:credential.source||'',provider:activeProvider,baseUrl,model:declaredModel,apiMode:currentRoute.api,modelChoices:(currentRoute.models||[]).map(model=>model.id),providerChoices:['deepseek-official',...Object.keys(providers)].map(id=>({id,name:providers[id]?.displayName||id,baseUrl:String(routeFor(id)?.baseURL||''),apiMode:routeFor(id)?.api})),configPath:patchFile});
  if(input.action==='status')process.stdout.write(JSON.stringify(status()));
  else{
    const selected=input.provider||activeProvider;
    const route=routeFor(selected);
    if(!route)throw new Error('未找到所选供应商，请先在原生设置中添加');
    const selectedRef=route.apiKeyEnv||('DSH_'+selected.toUpperCase().replace(/[^A-Z0-9]/g,'_')+'_API_KEY');
    const selectedCredential=await ctx.credentials.describe(selectedRef);
    if(!selectedCredential.writable&&input.apiKey)throw new Error('当前密钥来自进程环境变量，请先在电脑环境变量中修改');
    if((selected!==activeProvider||input.baseUrl!==currentBase)&&!input.apiKey)throw new Error('更换服务地址或供应商时请重新填写 API Key');
    const key=input.apiKey||(await ctx.credentials.resolve(selectedRef))?.value;
    if(!key)throw new Error('请填写 API Key');
    if(['models','test'].includes(input.action)){
      if(input.action==='models'&&input.baseUrl===String(route.baseURL||'').replace(/\/+$/,'')&&route.models?.length){
        const models=[...new Set(route.models.map(model=>model.id))];
        process.stdout.write(JSON.stringify({ok:true,models,message:'已读取原生配置中的 '+models.length+' 个模型'}));
      }else{
      const base=input.baseUrl.replace(/\/+$/,'');
      const mode=input.apiMode||route.api||'anthropic-messages';
      const anthropic=mode==='anthropic-messages';
      const official=new URL(base).hostname==='api.deepseek.com';
      const root=official?base.replace(/\/anthropic(?:\/v1)?$/,'').replace(/\/v1$/,''):base;
      const apiRoot=base.endsWith('/v1')?base:base+'/v1';
      const url=input.action==='models'?(root.endsWith('/v1')?root+'/models':root+'/v1/models'):apiRoot+(anthropic?'/messages':mode==='openai-responses'?'/responses':'/chat/completions');
      const headers={...(route.headers||{}),...(anthropic&&!(input.action==='models'&&official)?{'x-api-key':key,'anthropic-version':'2023-06-01'}:{Authorization:'Bearer '+key})};
      const payload=anthropic?{model:input.model,max_tokens:64,stream:false,thinking:{type:'disabled'},messages:[{role:'user',content:'Reply with only OK.'}]}:mode==='openai-responses'?{model:input.model,max_output_tokens:512,stream:false,input:'Reply with only OK.'}:{model:input.model,max_tokens:512,stream:false,messages:[{role:'user',content:'Reply with only OK.'}]};
      const started=Date.now();let response,body;try{
        response=await fetch(url,{method:input.action==='models'?'GET':'POST',headers:{...headers,'Content-Type':'application/json'},...(input.action==='test'?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(20000),redirect:'error'});
      }catch{throw new Error('无法连接服务，请检查地址和网络');}
      if(!response.ok)throw new Error(response.status===401||response.status===403?'服务拒绝认证，请检查 API Key':'服务检查失败（HTTP '+response.status+'）');
      try{const reader=response.body.getReader();let raw='';const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;raw+=decoder.decode(value,{stream:true});if(raw.length>2*1024*1024){await reader.cancel();throw new Error('large');}}body=JSON.parse(raw+decoder.decode());}catch{throw new Error('服务未返回可识别的响应');}
      if(input.action==='models'){
        if(!Array.isArray(body.data))throw new Error('服务未返回可识别的模型目录');
        const models=[...new Set(body.data.map(item=>item.id).filter(id=>typeof id==='string'&&id.length<=256&&!/[\r\n\0]/.test(id)&&id&&!id.includes(key)))].slice(0,500);
        if(!models.length)throw new Error('服务未返回可用模型');
        process.stdout.write(JSON.stringify({ok:true,models,message:'已获取 '+models.length+' 个模型'}));
      }else{
        const rawReply=anthropic?(body.content||[]).filter(item=>item.type==='text').map(item=>item.text||'').join(''):mode==='openai-responses'?(body.output||[]).flatMap(row=>row.content||[]).filter(item=>item.type==='output_text').map(item=>item.text||'').join(''):body.choices?.[0]?.message?.content||'';
        const reply=String(rawReply).replaceAll(key,'[已隐藏]').replace(/[\u0000-\u001f]/g,' ').slice(0,160);
        if(!reply.trim())throw new Error('服务未返回模型文本回复，请确认模型及接口协议');
        const elapsedMs=Date.now()-started;process.stdout.write(JSON.stringify({ok:true,elapsedMs,reply,message:'连接成功 · '+elapsedMs+' ms · 回复：'+reply}));
      }
      }
    }else{
      await fs.mkdir(home,{recursive:true});
      // 与原生编辑器共用锁；重新读取后只更新两个插件，保留其它补丁和注释。
      await withFileLock(patchFile,async()=>{
        const doc=parse(await read(patchFile));
        const selectedRoute={...route,baseURL:input.baseUrl,apiKeyEnv:selectedRef,...(input.apiMode?{api:input.apiMode}:{})};
        if(selected!=='deepseek-official'&&!selectedRoute.models?.some(model=>model.id===input.model))selectedRoute.models=[...(selectedRoute.models||[]),{id:input.model}];
        const providerFields=selected==='deepseek-official'?['llm-deepseek',{baseURL:input.baseUrl,apiKeyEnv:selectedRef}]:['llm-pi-ai',{...Object.assign({},...piConfigs),providers:{...providers,[selected]:selectedRoute}}];
        for(const [id,fields]of [providerFields,['agent-default-model',{provider:selected,model:input.model}]]){
          const existing=[...profileDoc.toJS(),...doc.toJS()].filter(row=>row?.id===id&&Object.hasOwn(row,'config')).at(-1)?.config||{};
          const rows=doc.contents.items.filter(node=>node?.get?.('id')===id);let node=rows.at(-1);
          if(!node){node=doc.createNode({id,...(id==='llm-pi-ai'?{name:'@deepseek-ai/dsh-llm-pi-ai'}:{}),config:{}});doc.contents.add(node);}
          node.set('config',{...existing,...fields});
        }
        if(input.apiKey)await ctx.credentials.set(selectedRef,input.apiKey);
        await writeFileAtomic(patchFile,doc.toString(),{mode:0o600,dirMode:0o700});
      });
      // ACP has its own deployment model; the CLI default alone does not
      // replace the model shipped in dsh-acp-app's application patch.
      await withFileLock(acpPatchFile,async()=>{
        const doc=parse(await read(acpPatchFile));
        let node=doc.contents.items.filter(node=>node?.get?.('id')==='acp').at(-1);
        if(!node){node=doc.createNode({id:'acp',config:{}});doc.contents.add(node);}
        const current=node.get('config')?.toJSON?.()||{};
        node.set('config',{...current,provider:selected,model:input.model});
        await writeFileAtomic(acpPatchFile,doc.toString(),{mode:0o600,dirMode:0o700});
      });
      process.stdout.write(JSON.stringify({ok:true,message:'已保存，新建 DeepSeek 会话后生效'}));
    }
  }
}catch(error){const allowed=['当前密钥来自','更换服务地址','请填写 API Key','无法连接服务','服务拒绝认证','服务检查失败','服务未返回','未找到所选供应商'];process.stdout.write(JSON.stringify({error:allowed.some(prefix=>error.message?.startsWith(prefix))?error.message:'无法读取或保存 DeepSeek 配置，请检查原生配置文件'}));process.exitCode=1;}
finally{if(ctx)await ctx.fiber.dispose();}
