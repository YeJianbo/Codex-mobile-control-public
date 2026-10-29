import {fromJSONSchema} from 'zod';

export const mcpElicitationMethod='mcpServer/elicitation/request';
type JsonRecord=Record<string,unknown>;
const record=(value:unknown):JsonRecord|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:undefined;
export function elicitationParams(detail?:string):JsonRecord {
  return record(JSON.parse(detail||'{}').mcpElicitation)??{};
}
function form(params:JsonRecord):boolean{return ['form','openai/form','openaiForm'].includes(String(params.mode));}
export function confirmationElicitation(params:JsonRecord):boolean {
  const schema=record(params.requestedSchema),properties=record(schema?.properties);
  // Only a form with no fields is a permission confirmation. Defaults on a
  // nonempty form are input suggestions, not authorization to answer for users.
  if(!form(params)||schema?.type!=='object'||!properties||Object.keys(properties).length)return false;
  if(Array.isArray(schema.required)&&schema.required.length)return false;
  if(Object.keys(schema).some(key=>!['$schema','type','properties','required','additionalProperties','title','description'].includes(key)))return false;
  try{return fromJSONSchema(schema).safeParse({}).success;}catch{return false;}
}
export function elicitationPrompt(params:JsonRecord):{title:string;detail:string;question:boolean} {
  const message=String(params.message??params.description??'');
  const title=String(params.title??`${String(params.serverName??'MCP')} 请求确认`);
  if(!form(params)){
    const guidance=params.mode==='url'?`请在电脑打开以下地址完成授权：\n${String(params.url??'')}`:'请在电脑完成设备身份验证';
    return {title,detail:JSON.stringify({mcpElicitation:params,message:`${message}\n${guidance}`}),question:false};
  }
  if(confirmationElicitation(params))return {title,detail:JSON.stringify({mcpElicitation:params,message}),question:false};
  const schema=record(params.requestedSchema),properties=record(schema?.properties);
  const simple=schema?.type==='object'&&properties&&Object.keys(properties).length>0&&Object.values(properties).every(value=>record(value)&&['string','boolean','number','integer','array'].includes(String(record(value)?.type)));
  const required=Array.isArray(schema?.required)?schema.required:[];
  const questions=simple?Object.entries(properties).map(([id,value])=>{
    const field=record(value)!;
    const values=field.type==='boolean'?['true','false']:Array.isArray(field.enum)?field.enum:undefined;
    return {id,header:String(field.title??id),question:[message,String(field.description??field.title??id),required.includes(id)?'': '可选字段，输入 null 跳过'].filter(Boolean).join('\n'),
      options:values?.map(value=>({label:String(value),description:''})),isOther:true};
  }):[{id:'content',header:'表单',question:`${message}\n请填写 JSON：\n${JSON.stringify(params.requestedSchema,null,2)}`,isOther:true}];
  return {title,detail:JSON.stringify({mcpElicitation:params,questions,isBlocking:true,simple:Boolean(simple)}),question:true};
}
export function elicitationAnswer(detail:string|undefined,answers:Record<string,{answers:string[]}>):unknown {
  const prompt=JSON.parse(detail||'{}'),params=elicitationParams(detail),schema=record(params.requestedSchema);
  let content:unknown;
  if(prompt.simple){
    const result:JsonRecord=Object.create(null),required=Array.isArray(schema?.required)?schema.required:[];
    for(const [id,value] of Object.entries(record(schema?.properties)??{})){
      const raw=answers[id]?.answers;
      if(!raw||raw.length!==1)throw new Error('请回答所有问题');
      if(raw[0].trim()==='null'&&!required.includes(id))continue;
      const type=record(value)?.type;
      if(type==='string')result[id]=raw[0];
      else {try{result[id]=JSON.parse(raw[0]);}catch{throw new Error(`${id} 的填写格式不正确`);}}
    }
    content=result;
  }else{
    const raw=answers.content?.answers;
    if(!raw||raw.length!==1)throw new Error('请填写表单');
    try{content=JSON.parse(raw[0]);}catch{throw new Error('请填写有效的 JSON');}
  }
  const validator=fromJSONSchema(params.requestedSchema as JsonRecord);
  const checked=validator.safeParse(content);
  if(!checked.success)throw new Error(`表单内容不符合要求：${checked.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('；')}`);
  return checked.data;
}
export function elicitationDecision(detail:string|undefined,decision:'accept'|'decline'):{action:'accept'|'decline';content:unknown} {
  if(decision==='decline')return {action:'decline',content:null};
  if(!confirmationElicitation(elicitationParams(detail)))throw new Error('此请求需要在电脑完成授权或设备验证');
  return {action:'accept',content:{}};
}
