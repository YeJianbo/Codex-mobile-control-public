import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'smol-toml';
import {rootConfig} from './store.mjs';
import {atomicWrite} from './catalog.mjs';
export const OFFICIAL_HTTP_URL='https://chatgpt.com/backend-api/codex';
export function officialHttpProvider(store){
  const config=parse(fs.readFileSync(store.config,'utf8'));
  const ids=[config.model_provider,'aimami1','custom'];
  const id=ids.find(id=>id&&id!=='openai'&&id!=='aimami_local'&&config.model_providers?.[id]?.requires_openai_auth===true);
  if(!id)throw new Error('没有可复用的官方登录 provider 配置；请先在配置中准备一个非内置入口');
  const provider=config.model_providers[id];
  if(provider.auth||provider.env_key||provider.experimental_bearer_token||provider.http_headers||provider.env_http_headers||provider.query_params)throw new Error('现有 provider 包含额外认证、请求头或参数，请先检查，避免带到官方端点');
  return id;
}
export function officialHttp(store){
  const text=fs.readFileSync(store.config,'utf8'),config=parse(text),provider=officialHttpProvider(store);
  if(config.openai_base_url||config.chatgpt_base_url)throw new Error('存在官方端点覆盖，请先通过恢复流程清除');
  const models=store.rebuild().filter(m=>!m.slug.includes('::')&&m.visibility!=='hide'&&!store.data.modelSettings?.[m.slug]?.route);
  if(!models.length)throw new Error('没有启用的官方模型');
  const model=models.find(m=>m.slug===config.model)?.slug||models[0].slug;
  const lines=text.split(/\r?\n/),start=lines.findIndex(line=>line.trim()===`[model_providers.${provider}]`);
  if(start<0)throw new Error('现有 provider 表无法定位，未修改配置');
  let end=start+1;while(end<lines.length&&!/^\s*\[/.test(lines[end]))end++;
  const block=[`[model_providers.${provider}]`,'name = "OpenAI 官方 HTTPS"',`base_url = "${OFFICIAL_HTTP_URL}"`,'wire_api = "responses"','requires_openai_auth = true','supports_websockets = false',''];
  const next=rootConfig([...lines.slice(0,start),...block,...lines.slice(end)].join('\n'),{model_provider:provider,model,model_catalog_json:path.join(store.dir,'official-model-catalog.json')});
  const backup=store.backup();store.writeConfig(next);return {model,provider,transport:'https',baseUrl:OFFICIAL_HTTP_URL,backup};
}
export function officialDirect(store){
  const text=fs.readFileSync(store.config,'utf8'),config=parse(text);
  if(config.model_providers?.openai||config.openai_base_url||config.chatgpt_base_url)throw new Error('存在自定义官方端点，请先检查该配置，避免把代理误标为直连');
  const models=store.rebuild().filter(m=>!m.slug.includes('::')&&m.visibility!=='hide'&&!store.data.modelSettings?.[m.slug]?.route);
  if(!models.length)throw new Error('没有启用且未指定中转的官方模型');
  const model=models.find(m=>m.slug===config.model)?.slug||models[0].slug;
  const next=rootConfig(text,{model_provider:'openai',model,model_catalog_json:path.join(store.dir,'official-model-catalog.json')});
  const backup=store.backup();store.writeConfig(next);return {model,backup};
}
export function relayProfile(store,port){
  const models=store.rebuild().filter(m=>m.slug.includes('::')&&m.visibility!=='hide');
  if(!models.length)throw new Error('请先启用至少一个已配置密钥的新增中转模型');
  const file=path.join(store.home,'local-console-relay.config.toml'),catalog=path.join(store.dir,'relay-model-catalog.json');
  const marker='# Managed by Local Console: relay-only profile';
  if(fs.existsSync(file)&&!fs.readFileSync(file,'utf8').startsWith(marker))throw new Error('同名配置由其他程序创建，请先重命名该文件');
  const text=marker+'\n'+`model_provider = "local_console_relay"\nmodel = ${JSON.stringify(models[0].slug)}\nmodel_catalog_json = ${JSON.stringify(catalog)}\n\n[model_providers.local_console_relay]\nname = "Local Console Relay"\nbase_url = "http://127.0.0.1:${port}/relay/v1"\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = false\n`;
  parse(text);atomicWrite(catalog,{models});fs.writeFileSync(file,text,{mode:0o600});
  return {file,command:'codex --profile local-console-relay',models:models.length,minimumVersion:'0.134.0'};
}
