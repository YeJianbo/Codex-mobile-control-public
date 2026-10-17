import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile(new URL('../public/console.js',import.meta.url),'utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a);return source.slice(a,b);}
const code=section('async function refreshTerminals(','function renderTerminalList()')+section('async function readTerminalOutput()','async function newTerminal()');
const record=(commandId,outputLength)=>({commandId,outputLength,status:'running',command:commandId,cwd:'D:/fixture',output:''});
const output=(offset,end,text,hasMoreAfter=false)=>({output:{offset,end,text,hasMoreAfter}});
async function until(check){for(let i=0;i<40;i++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('terminal reader did not settle');}
function fixture(records=[record('a',6)]){
 const nodes=new Map(),calls=[],terminal={text:'',writes:[],resets:0,reset(){this.text='';this.resets++;},write(text){this.text+=text;this.writes.push(text);},focus(){}};
 const state={generation:1,page:'terminal',terminalRequest:0,terminalCommands:records,activeTerminal:'',terminal,terminalOutput:'',terminalBuffer:null,terminalOutputRead:null};
 const context={state,document:{hidden:false},$:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false});return nodes.get(id);},ensureTerminal(){},renderTerminalList(){},fitTerminal(){},updateControls(){},statusLabel:value=>value,errorMessage:error=>error.message};
 context.api=async url=>{calls.push(url);return context.respond(url);};vm.createContext(context);vm.runInContext(code,context);return {context,state,nodes,calls,terminal};
}

test('background terminal refresh only reads metadata and never requests output bodies',async()=>{
 const {context,state,calls}=fixture();state.page='chat';state.activeTerminal='a';context.respond=async()=>({commands:[record('a',1000000)]});await context.refreshTerminals();
 assert.equal(calls.length,1);assert.match(calls[0],/includeOutput=false/);assert.match(calls[0],/previewChars=0/);assert.equal(state.terminalBuffer,null);
 state.page='terminal';context.respond=async url=>url.includes('/commands?')?{commands:[record('a',3)]}:output(0,3,'abc');await context.refreshTerminals();assert.equal(state.terminalBuffer.text,'abc');
 context.respond=async()=>{throw Error('background metadata timeout');};await assert.doesNotReject(()=>context.refreshTerminals({quiet:true}));assert.equal(state.terminalBuffer.text,'abc');
});

test('selected output is paged and subsequent reads only append new text, including split emoji',async()=>{
 const {context,state,calls,terminal}=fixture([record('a',5)]);
 context.respond=async url=>new URL(url,'http://fixture').searchParams.get('offset')==='0'?output(0,2,'a\ud83d',true):output(2,5,'\ude00bc');
 await context.selectTerminal('a');assert.equal(terminal.text,'a😀bc');assert.deepEqual(terminal.writes.filter(Boolean),['a','😀bc']);assert.equal(calls.length,2);
 state.terminalCommands[0].outputLength=7;context.respond=async()=>output(5,7,'de');await context.readTerminalOutput();assert.match(calls.at(-1),/offset=5&/);assert.equal(terminal.text,'a😀bcde');assert.equal(terminal.writes.at(-1),'de');
});

test('late output from a previously selected terminal cannot overwrite the new terminal',async()=>{
 const {context,state,terminal}=fixture([record('a',1),record('b',1)]),pending=[];context.respond=url=>new Promise(resolve=>pending.push({url,resolve}));
 const first=context.selectTerminal('a'),second=context.selectTerminal('b');assert.equal(pending.length,2);pending[1].resolve(output(0,1,'B'));await second;pending[0].resolve(output(0,1,'A'));await first;
 assert.equal(state.activeTerminal,'b');assert.equal(state.terminalBuffer.id,'b');assert.equal(terminal.text,'B');
});

test('concurrent reads are shared and a failed page resumes from the last successful offset',async()=>{
 const {context,state,calls,terminal,nodes}=fixture(),pending=[];context.respond=url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject}));
 const first=context.selectTerminal('a'),duplicate=context.readTerminalOutput();assert.equal(calls.length,1);pending[0].resolve(output(0,3,'abc',true));await until(()=>pending.length===2);pending[1].reject(Error('temporary output failure'));
 const settled=await Promise.allSettled([first,duplicate]);assert(settled.every(result=>result.status==='rejected'));assert.equal(terminal.text,'abc');assert.equal(state.terminalBuffer.end,3);assert.match(nodes.get('terminalStatus').textContent,/temporary output failure/);
 context.respond=async()=>output(3,6,'def');await context.readTerminalOutput();assert.match(calls.at(-1),/offset=3&/);assert.equal(terminal.text,'abcdef');assert.equal(state.terminalOutputError,'');
});

test('shortened output metadata invalidates the old buffer and reloads the selected record',async()=>{
 const {context,state,terminal}=fixture([record('a',10)]);state.activeTerminal='a';state.terminalBuffer={id:'a',text:'abcdefghij',end:10};state.terminalOutput='abcdefghij';terminal.text='abcdefghij';
 context.respond=async url=>url.includes('/commands?')?{commands:[record('a',3)]}:output(0,3,'new');await context.refreshTerminals();assert.equal(terminal.text,'new');assert.equal(state.terminalBuffer.end,3);
});

test('stale length metadata cannot cause an endless series of empty output reads',async()=>{
 const {context,calls,terminal}=fixture([record('a',10)]);context.respond=async url=>new URL(url,'http://fixture').searchParams.get('offset')==='0'?output(0,3,'abc'):output(3,3,'');
 await context.selectTerminal('a');assert.equal(calls.length,2);assert.equal(terminal.text,'abc');
});
