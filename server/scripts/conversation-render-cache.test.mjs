import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import {conversationBlocks,groupToolActivity,activeConversationTask} from '../public/console-core.js';

const source=readFileSync(new URL('../public/console.js',import.meta.url),'utf8');
const helperStart=source.indexOf('function userMessageSignature('),helperEnd=source.indexOf('let conversationThread = null;',helperStart);
const loopStart=source.indexOf('  const knownKeys=new Set(conversationCache.keys());'),loopEnd=source.indexOf('  if (pending&&!pending.goal)',loopStart);
assert(helperStart>=0&&helperEnd>helperStart&&loopStart>=0&&loopEnd>loopStart);
const helper=source.slice(helperStart,helperEnd),loop=source.slice(loopStart,loopEnd);

function fixture(){
  let made=0;
  const stats={eventSerializations:0,largeSerializations:0};
  const context=vm.createContext({
    state:{threadId:'t',generation:1,chatProject:'p',approvals:[]},
    outgoingMessageKeys:new Map(),approvalFeedback:new Map(),approvalKey:event=>event.approvalId,
    running:false,conversationCache:new Map(),
    JSON:{stringify(value){
      if(value?.type)stats.eventSerializations++;
      const result=JSON.stringify(value);
      if(result?.length>10000)stats.largeSerializations++;
      return result;
    }},
    createBlock:event=>({id:++made,event,dataset:{},classList:{toggle(){}}}),
  });
  vm.runInContext(helper+'globalThis.render=()=>{'+loop+'conversationCache=nextCache;return nodes;};',context);
  return {context,stats,made:()=>made,render(events,{raw=false}={}){
    context.blocks=raw?events:groupToolActivity(conversationBlocks(events,'t'));
    return context.render();
  }};
}
const event=(type,id,extra={})=>({threadId:'t',type,eventId:id,...extra});

test('unchanged historical process and patch nodes reuse without serializing body data',()=>{
  const f=fixture(),events=[];
  for(let i=0;i<30;i++)events.push(
    event('turn.started','start'+i,{turnId:''+i}),event('user.message','u'+i,{text:'question'}),
    event('reasoning.summary','r'+i,{text:'thought'.repeat(5000)}),
    event('file.changed','edit'+i,{files:['a.js'],diff:'patch'.repeat(10000)}),
    event('message.delta','a'+i,{text:'answer'.repeat(5000)}),
    event('turn.completed','end'+i,{turnId:''+i,status:'completed'}));
  const first=f.render(events),count=f.made(),second=f.render(events);
  assert.equal(first.length,second.length);
  first.forEach((node,i)=>assert.equal(node,second[i]));
  assert.equal(f.made(),count);
  assert.equal(f.stats.eventSerializations,0);
  assert.equal(f.stats.largeSerializations,0);
});

test('a delta updates its active reply and edited historical messages still refresh',()=>{
  const f=fixture(),events=[event('user.message','u',{text:'ask'}),event('message.delta','a',{itemId:'reply',text:'first'})];
  const first=f.render(events),next=f.render([...events,event('message.delta','more',{itemId:'reply',text:' second'})]);
  assert.equal(first[0],next[0]);assert.notEqual(first[1],next[1]);
  assert.equal(next[1].event.text,'first second');assert.equal(f.made(),3);
  const replaced=f.render([{...events[0],text:'edited'},events[1]]);
  assert.notEqual(replaced[0],next[0]);assert.notEqual(replaced[1],next[1]);
});

test('approval feedback and connection or project changes invalidate cached output',()=>{
  const f=fixture(),approval=event('approval.requested','request',{approvalId:'approval'});
  f.context.state.approvals=[{id:'approval',status:'pending'}];
  const render=()=>f.render([approval],{raw:true})[0],first=render();
  f.context.approvalFeedback.set('approval',{pending:true});const sending=render();assert.notEqual(sending,first);
  f.context.approvalFeedback.get('approval').pending=false;assert.notEqual(render(),sending);
  const rendered=render();f.context.state.approvals[0].status='resolved';assert.notEqual(render(),rendered);
  const beforeProject=render();f.context.state.chatProject='other';assert.notEqual(render(),beforeProject);
  const beforeGeneration=render();f.context.state.generation++;assert.notEqual(render(),beforeGeneration);
});

test('nested changes refresh; equivalent wrappers reuse the node and its rendered data',()=>{
  const f=fixture(),first=event('files.summary','files',{activities:[event('file.changed','edit',{files:['a.js'],fileChanges:[{path:'a.js',added:1,removed:0}]})]});
  const initial=f.render([first],{raw:true})[0],equivalent=structuredClone(first);
  assert.equal(f.render([equivalent],{raw:true})[0],initial);
  equivalent.activities[0]={...equivalent.activities[0],fileChanges:[{path:'a.js',added:2,removed:0}]};
  const changed=f.render([equivalent],{raw:true})[0];assert.notEqual(changed,initial);
  const appended={...equivalent,activities:[...equivalent.activities,event('file.changed','edit2',{files:['b.js']})]};
  assert.notEqual(f.render([appended],{raw:true})[0],changed);
});

test('task progress reads only the current exchange without loading operation bodies',()=>{
  let oldReads=0,bodyReads=0;
  const old=Array.from({length:5000},()=>({get type(){oldReads++;return 'tool.started';}}));
  const latest={...event('tool.started','latest',{itemId:'latest'}),get text(){bodyReads++;return 'large output';}};
  const current=[event('user.message','user'),event('tool.started','done',{itemId:'done'}),latest,event('tool.completed','completed',{itemId:'done'})];
  assert.equal(activeConversationTask([...old,...current]),latest);
  assert.equal(oldReads,0);assert.equal(bodyReads,0);
  assert.equal(activeConversationTask([...old,event('user.message','new')]),undefined);
  assert.equal(oldReads,0);
});

test('task progress retains completion matching for out-of-order and boundary-free records',()=>{
  const first=event('tool.started','first',{itemId:'first'}),latest=event('tool.started','latest',{itemId:'latest'});
  assert.equal(activeConversationTask([first,latest]),latest);
  assert.equal(activeConversationTask([event('tool.completed','done',{itemId:'latest'}),first,latest]),first);
  assert.equal(activeConversationTask([event('tool.completed','done'),event('tool.started','unknown')]),undefined);
  assert.equal(activeConversationTask([]),undefined);
});
