const text=(value,max=2048)=>typeof value==='string'?value.slice(0,max):'';
const rows=value=>Array.isArray(value)?value:[];
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const requireText=(value,label,max=2048)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(label+'无效');return value.trim();};
function exact(body,keys){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key)))throw Error('请求参数无效');}
function publicSettings(raw){return {configured:raw?.configured===true,publicUrl:text(raw?.publicUrl)};}
export function channelSummary(raw){
  return {channels:rows(raw.channels).map(row=>({kind:text(row.kind,20),available:row.available===true})),accounts:rows(raw.accounts).map(account=>{
    const details=object(account.details);
    return {id:text(account.id,512),channel:text(account.channel,20),label:text(account.label,80),projectPath:text(account.projectPath,4096),state:text(account.state,40),bindingCount:Number(account.bindingCount)||0,
      details:{configured:details.configured===true,appId:text(details.appId,30),ownerId:text(details.ownerId,512),transport:text(details.transport,80),lastError:text(details.lastError,1000)}};
  })};
}
// These fixed operations share the gateway's paired-device services. The admin token never reaches the browser.
export class AccessControl {
  constructor(gateway){this.gateway=gateway;}
  async call(route,method='GET',body){
    const config=this.gateway.config();
    const response=await this.gateway.request(route,{headers:{Authorization:'Bearer '+config.token},method,body,signal:AbortSignal.timeout(45000)});
    const value=await response.json();
    if(!response.ok)throw Error(typeof value.error==='string'?value.error:'网关操作失败，请刷新后重试');
    return value;
  }
  async state(){
    const gateway=await this.gateway.status();
    if(!gateway.running)return {gateway,projects:[],devices:[],channels:{channels:[],accounts:[]},publicAccess:{configured:false,publicUrl:''},errors:{gateway:gateway.lastError||'网关未运行'}};
    const routes={projects:'/api/projects',devices:'/api/devices',channels:'/api/mobile-management/channels',publicAccess:'/api/settings/public-access'};
    const values={},errors={};
    await Promise.all(Object.entries(routes).map(async([key,route])=>{try{values[key]=await this.call(route);}catch(error){errors[key]=error.message;}}));
    const config=this.gateway.config();
    return {gateway:{...gateway,host:config.host,port:config.port,https:config.https?.enabled===true},
      projects:rows(values.projects?.projects).map(row=>({id:text(row.id,100),name:text(row.name,200),path:text(row.path,4096)})),
      devices:rows(values.devices?.devices).map(row=>({id:text(row.id,100),name:text(row.name,200),firstSeenAt:text(row.firstSeenAt,100),lastSeenAt:text(row.lastSeenAt,100),revokedAt:text(row.revokedAt,100)})),
      channels:channelSummary(values.channels||{}),publicAccess:publicSettings(values.publicAccess?.publicAccess),errors};
  }
  async pair(body){
    exact(body,['baseUrl']);
    const query=new URLSearchParams();if(body.baseUrl)query.set('baseUrl',requireText(body.baseUrl,'连接地址'));
    const raw=await this.call('/api/pair/start'+(query.size?'?'+query:''),'POST',{});
    const svg=text(raw.qrSvg,256000);
    return {code:text(raw.code,100),baseUrl:text(raw.baseUrl),publicUrl:text(raw.publicUrl),expiresAt:text(raw.expiresAt,100),setupUrl:text(raw.setupUrl,8192),
      addresses:rows(raw.addresses).map(row=>({name:text(row.name,200),url:text(row.url)})),qrImage:svg.startsWith('<svg')||svg.startsWith('<?xml')?'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'):''};
  }
  async channels(){return channelSummary(await this.call('/api/mobile-management/channels'));}
  async remote(body){
    exact(body,['password','publicUrl']);const value={};
    if(body.password!==undefined){if(typeof body.password!=='string'||body.password.length<6||body.password.length>128||body.password.trim()!==body.password)throw Error('密码需要 6 至 128 个字符，首尾不能有空格');value.password=body.password;}
    if(body.publicUrl!==undefined){
      if(typeof body.publicUrl!=='string'||body.publicUrl.length>2048)throw Error('公网地址无效');
      value.publicUrl=body.publicUrl.trim();if(value.publicUrl){const url=new URL(value.publicUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('公网地址需要 HTTPS 域名，不带路径');value.publicUrl=url.origin;}
    }
    if(!Object.keys(value).length)throw Error('请填写连接设置');
    return {publicAccess:publicSettings((await this.call('/api/settings/public-access/config','PUT',value)).publicAccess)};
  }
  async revoke(body){exact(body,['id','confirmed']);if(body.confirmed!==true)throw Error('请确认解除设备绑定');await this.call('/api/devices/'+encodeURIComponent(requireText(body.id,'设备',100)),'DELETE');return {ok:true};}
  async channel(body){
    exact(body,['action','id','channel','label','projectPath','appId','appSecret','verifyCode','refresh','confirmed']);
    if(body.action==='create'){
      if(!['qq','weixin'].includes(body.channel))throw Error('消息渠道无效');
      const raw=await this.call('/api/mobile-management/channels/accounts','POST',{channel:body.channel,label:requireText(body.label,'渠道名称',80)});
      return {account:channelSummary({accounts:[raw.account]}).accounts[0]};
    }
    const id=requireText(body.id,'渠道账号',512),action=body.action;let payload={};
    if(action==='settings')payload={projectPath:requireText(body.projectPath,'工作目录',4096)};
    else if(action==='credentials')payload={appId:requireText(body.appId,'AppID',30),appSecret:requireText(body.appSecret,'AppSecret',512)};
    else if(action==='login'){
      if(body.verifyCode!==undefined)payload.verifyCode=requireText(body.verifyCode,'验证码',40);
      if(body.refresh!==undefined){if(typeof body.refresh!=='boolean')throw Error('刷新参数无效');payload.refresh=body.refresh;}
    }else if(action==='remove'){if(body.confirmed!==true)throw Error('请确认清除渠道登录');payload={confirm:true};}
    else if(!['connect','disconnect'].includes(action))throw Error('渠道操作无效');
    const raw=await this.call('/api/mobile-management/channels/accounts/'+encodeURIComponent(id)+'/'+action,'POST',payload);
    if(action==='login')return {status:text(raw.status,80),expiresAt:Number(raw.expiresAt)||0,qrImage:typeof raw.qrImage==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(raw.qrImage)&&raw.qrImage.length<=524288?raw.qrImage:''};
    return channelSummary(raw);
  }
}
