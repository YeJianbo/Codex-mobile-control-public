import {matchesFilePrompt,matchesUploadedFilePath,isUploadedFilePath,uploadedFileFromPath,type FileAttachment} from './fileUploads.js';
import {matchesUploadedImagePath,isUploadedImagePath,uploadedImageFromPath,type ImageAttachment} from './imageUploads.js';
import type {GatewayEvent} from '../types.js';
import {foldCompactionSummaries} from './contextCompaction.js';

type UserMessage=Extract<GatewayEvent,{type:'user.message'}>;

// Sorting and receipt matching revisit timestamps; keep this cache within one merge.
function eventTimes(){
  const values=new Map<string,number>();
  return (event:GatewayEvent)=>{
    const text=event.createdAt||'';
    let value=values.get(text);
    if(value===undefined){value=Date.parse(text);values.set(text,value);}
    return value;
  };
}

function messagesByText<T>(rows:readonly T[],message:(row:T)=>{threadId:string;text:string}){
  const threads=new Map<string,Map<string,T[]>>();
  for(const row of rows){
    const {threadId,text}=message(row);
    let texts=threads.get(threadId);if(!texts){texts=new Map();threads.set(threadId,texts);}
    let matches=texts.get(text);if(!matches){matches=[];texts.set(text,matches);}
    matches.push(row);
  }
  return threads;
}

function receiptCandidates<T extends {event:UserMessage;index:number}>(rows:readonly T[]){
  const texts=messagesByText(rows.filter(row=>!row.event.files?.length),row=>row.event);
  const filesByThread=new Map<string,T[]>();
  for(const row of rows)if(row.event.files?.length){
    let files=filesByThread.get(row.event.threadId);if(!files){files=[];filesByThread.set(row.event.threadId,files);}
    files.push(row);
  }
  return (event:UserMessage)=>{
    const text=texts.get(event.threadId)?.get(event.text)||[],files=filesByThread.get(event.threadId)||[];
    // File envelopes can alter text. Keep them eligible and restore source
    // order before the existing distance selection, including equal/unknown dates.
    return !files.length?text:!text.length?files:[...text,...files].sort((a,b)=>a.index-b.index);
  };
}

export async function recoverMobileUploadImages(events:GatewayEvent[]):Promise<GatewayEvent[]>{
  const recovered=new Map<string,Promise<ImageAttachment|undefined>>();
  return Promise.all(events.map(async event=>{
    if(event.type!=='user.message'||!event.attachments?.some(file=>isUploadedImagePath(file.path)))return event;
    const images=[...(event.images||[])],attachments=[];
    for(const attachment of event.attachments){
      if(images.some(image=>matchesUploadedImagePath(image,attachment.path)))continue;
      if(!recovered.has(attachment.path))recovered.set(attachment.path,uploadedImageFromPath(attachment.path,attachment.name));
      const image=await recovered.get(attachment.path);
      if(image)images.push(image);else attachments.push(attachment);
    }
    return {...event,images:images.length?images:undefined,attachments:attachments.length?attachments:undefined};
  }));
}

// Upload metadata outlives the live-event window. Historical messages may keep
// only the exact upload path, which is not a project-file permission request.
export async function recoverMobileUploadFiles(events:GatewayEvent[]):Promise<GatewayEvent[]>{
  const recovered=new Map<string,Promise<FileAttachment|undefined>>();
  return Promise.all(events.map(async event=>{
    if(event.type!=='user.message'||!event.attachments?.some(file=>isUploadedFilePath(file.path)))return event;
    const files=[...(event.files||[])],attachments=[];
    for(const attachment of event.attachments){
      if(!recovered.has(attachment.path))recovered.set(attachment.path,uploadedFileFromPath(attachment.path));
      const file=await recovered.get(attachment.path);
      if(file){if(!files.some(existing=>existing.id===file.id))files.push(file);}
      else attachments.push(attachment);
    }
    return {...event,files:files.length?files:undefined,attachments:attachments.length?attachments:undefined};
  }));
}

export function latestMobileThreadLifecycle(historicalEvents:GatewayEvent[],storedEvents:GatewayEvent[]){
  let latest:Extract<GatewayEvent,{type:'turn.started'|'turn.completed'}>|undefined;
  let latestAt=0;
  for(const events of [historicalEvents,storedEvents])for(const event of events){
    if(event.type!=='turn.started'&&event.type!=='turn.completed')continue;
    const at=Date.parse(event.createdAt||'')||0;
    if(!latest||at>=latestAt){latest=event;latestAt=at;}
  }
  return latest;
}

// Desktop rollout messages contain text but not gateway upload IDs. Attach the
// saved IDs before paging so thumbnail requests keep working after refresh.
export function mergeMobileThreadEvents(historicalEvents:GatewayEvent[],storedEvents:GatewayEvent[]):GatewayEvent[]{
  if(!historicalEvents.length)return foldCompactionSummaries(storedEvents);
  const time=eventTimes();
  const attached=new Set<GatewayEvent>();
  const turns=new Map<GatewayEvent,string>();
  let currentTurn='',currentTurnAt=0;
  for(const event of historicalEvents){
    if(event.type==='turn.started'){currentTurn=event.turnId||'';currentTurnAt=time(event)||0;}
    if(event.type==='user.message'){
      const inferred=!currentTurnAt||(time(event)||0)>=currentTurnAt?currentTurn:undefined;
      if(event.turnId||inferred)turns.set(event,event.turnId||inferred!);
    }
    if(event.type==='turn.completed')currentTurn='';
  }
  const historyMessages=historicalEvents.filter((event):event is UserMessage=>event.type==='user.message');
  const realItem=(event:UserMessage)=>event.itemId?.startsWith('history:')?undefined:event.itemId;
  const storedMessages=storedEvents.filter((event):event is UserMessage=>event.type==='user.message'
    &&Boolean(event.requestId||event.turnId||realItem(event)||event.images?.length||event.files?.length));
  const historicalTexts=messagesByText(historyMessages,event=>event);
  const storedRows=storedMessages.map((event,index)=>({event,index}));
  const candidates=receiptCandidates(storedRows);
  const nearestHistory=new Map<UserMessage,UserMessage|undefined>();
  const matches=(event:UserMessage,candidate:UserMessage)=>{
    if(candidate.threadId!==event.threadId)return false;
    if(event.requestId&&candidate.requestId&&event.requestId!==candidate.requestId)return false;
    if(realItem(event)&&realItem(candidate)&&realItem(event)!==realItem(candidate))return false;
    if(turns.get(event)&&candidate.turnId&&turns.get(event)!==candidate.turnId)return false;
    const sameText=candidate.files?.length&&event.attachments?.some(attachment=>isUploadedFilePath(attachment.path))
      ?candidate.text.trim()===event.text.trim()&&candidate.files.every(file=>event.attachments!.some(attachment=>matchesUploadedFilePath(file,attachment.path)))
      :candidate.text===event.text||matchesFilePrompt(event.text,candidate.text,candidate.files);
    if(!sameText)return false;
    // Desktop inbox messages can reach the rollout minutes after acceptance.
    // Exact upload paths identify that submission without a clock heuristic.
    if(candidate.images?.length&&candidate.images.every(image=>event.attachments?.some(file=>matchesUploadedImagePath(image,file.path))))return true;
    if(candidate.files?.length&&candidate.files.every(file=>event.attachments?.some(attachment=>matchesUploadedFilePath(file,attachment.path))))return true;
    if(event.requestId&&event.requestId===candidate.requestId||realItem(event)&&realItem(event)===realItem(candidate)||turns.get(event)&&turns.get(event)===candidate.turnId)return true;
    const when=time(event);
    return Number.isFinite(when)&&Math.abs(time(candidate)-when)<120000;
  };
  const distance=(event:UserMessage,candidate:UserMessage)=>Math.abs(time(candidate)-time(event));
  const merged=historicalEvents.map(event=>{
    if(event.type!=='user.message')return event;
    const saved=candidates(event).filter(({event:candidate})=>!attached.has(candidate)&&matches(event,candidate))
      .sort(({event:a},{event:b})=>distance(event,a)-distance(event,b))
      .find(({event:candidate})=>{
        if(candidate.images?.length||candidate.files?.length||event.requestId===candidate.requestId&&event.requestId||realItem(event)===realItem(candidate)&&realItem(event)||turns.get(event)===candidate.turnId&&candidate.turnId)return true;
        // Older text-only receipts lack Codex item IDs. Pair only the unique
        // nearest transcript entry; two real identical messages remain distinct.
        if(!nearestHistory.has(candidate)){
          const closest=(historicalTexts.get(candidate.threadId)?.get(candidate.text)||[]).filter(history=>matches(history,candidate)).sort((a,b)=>distance(a,candidate)-distance(b,candidate));
          nearestHistory.set(candidate,closest.length===1||closest.length>1&&distance(closest[0],candidate)<distance(closest[1],candidate)?closest[0]:undefined);
        }
        return nearestHistory.get(candidate)===event;
      })?.event;
    if(saved?.type==='user.message'){
      attached.add(saved);
      const synthetic=event.attachments?.filter(file=>/^history-embedded-image:\d+\.(?:png|jpeg|webp|gif)$/.test(file.path))??[];
      const imageAttachments=synthetic.length&&synthetic.length<=(saved.images?.length??0)
        ?event.attachments?.filter(file=>!synthetic.includes(file))
        :event.attachments;
      const attachments=imageAttachments?.filter(attachment=>!saved.files?.some(file=>matchesUploadedFilePath(file,attachment.path))&&!saved.images?.some(image=>matchesUploadedImagePath(image,attachment.path)));
      return {...event,requestId:saved.requestId||event.requestId,turnId:turns.get(event)||saved.turnId,text:saved.text,images:saved.images,files:saved.files,attachments:attachments?.length?attachments:undefined};
    }
    return event;
  });
  const cutoffs=new Map<string,number>();
  const completeItems=new Set(merged.filter(event=>event.type==='message.delta'&&event.textComplete&&event.itemId).map(event=>(event as Extract<GatewayEvent,{type:'message.delta'}>).itemId));
  for(const event of merged)cutoffs.set(event.type,Math.max(cutoffs.get(event.type)||0,time(event)||0));
  const recent=storedEvents.filter(event=>{
    if(event.type==='message.delta'&&event.itemId&&completeItems.has(event.itemId))return false;
    if(event.type==='user.message'&&attached.has(event))return false;
    if(event.type==='user.message'&&(event.images?.length||event.files?.length))return true;
    if(['user.message','message.delta','reasoning.summary'].includes(event.type))
      return Boolean(event.createdAt)&&time(event)>(cutoffs.get(event.type)||0);
    return true;
  });
  return foldCompactionSummaries([...merged,...recent].sort((a,b)=>(time(a)||0)-(time(b)||0)));
}

export function mergeDeepSeekThreadEvents(nativeEvents:GatewayEvent[],storedEvents:GatewayEvent[],owned=false):GatewayEvent[]{
  const time=eventTimes();
  let currentTurn:string|undefined;
  storedEvents=storedEvents.map(event=>{
    if(event.type==='turn.started')currentTurn=event.turnId;
    if(event.type!=='turn.completed')return event;
    const normalized={...event,turnId:event.turnId||currentTurn};currentTurn=undefined;return normalized;
  });
  const receipts:{event:UserMessage;turnId:string;index:number}[]=[];
  let followingTurn:string|undefined;
  // A receipt without a turn ID belongs to the next start before another user message.
  for(let index=storedEvents.length-1;index>=0;index--){
    const event=storedEvents[index];
    if(event.type==='turn.started')followingTurn=event.turnId;
    if(event.type!=='user.message')continue;
    const turnId=event.turnId||followingTurn;
    if(turnId)receipts.push({event,turnId,index});
    followingTurn=undefined;
  }
  receipts.reverse();
  const candidates=receiptCandidates(receipts);
  const mapped=new Map<string,string>(),used=new Set<GatewayEvent>();
  for(const event of nativeEvents){
    if(event.type!=='user.message'||!event.turnId)continue;
    let match:typeof receipts[number]|undefined,distance=Infinity;
    const at=time(event);
    for(const receipt of candidates(event)){
      if(used.has(receipt.event))continue;
      const gap=Math.abs(at-time(receipt.event));
      if(gap<120000&&gap<distance&&(receipt.event.text===event.text||matchesFilePrompt(event.text,receipt.event.text,receipt.event.files))){match=receipt;distance=gap;}
    }
    if(match){mapped.set(event.turnId,match.turnId);used.add(match.event);}
  }
  const closed=new Set(nativeEvents.filter(event=>event.type==='turn.completed').map(event=>(event as Extract<GatewayEvent,{type:'turn.completed'}>).turnId));
  const replaced=new Set([...closed].flatMap(id=>id&&mapped.has(id)?[mapped.get(id)!]:[]));
  const history=nativeEvents.filter(event=>!owned||!('turnId' in event)||!event.turnId||closed.has(event.turnId)||!mapped.has(event.turnId))
    .map(event=>'turnId' in event&&event.turnId&&mapped.has(event.turnId)?{...event,turnId:mapped.get(event.turnId)}:event);
  // A completed native message replaces its gateway stream. Keep the saved
  // user receipt so ordinary attachment and request-ID recovery still applies.
  const saved=storedEvents.filter(event=>!['message.delta','turn.started','turn.completed'].includes(event.type)||!('turnId' in event)||!event.turnId||!replaced.has(event.turnId));
  return mergeMobileThreadEvents(history,saved);
}
