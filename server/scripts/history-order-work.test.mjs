import test from 'node:test';
import assert from 'node:assert/strict';
import {StateStore} from '../dist/services/stateStore.js';

test('merged history keeps stable chronological order and parses each distinct timestamp once',t=>{
 const early='2026-10-17T00:00:00Z',middle='2026-10-17T00:00:01Z',late='2026-10-17T00:00:02Z';
 const rows=Array.from({length:100},(_,i)=>({type:'message.delta',threadId:'t',eventId:'chunk-'+i,text:String(i),createdAt:middle}));
 const complete=[{...rows[0],eventId:'late',createdAt:late},...rows,{...rows[0],eventId:'early',createdAt:early}];
 const originalIds=complete.map(event=>event.eventId);
 const upload={type:'user.message',threadId:'t',eventId:'upload',text:'attachment',images:[{id:'image',name:'image.png'}],createdAt:early};
 const undated={type:'tool.completed',threadId:'t',eventId:'undated',detail:'saved operation'};
 const fake={state:{events:[upload,undated,{...rows[0],text:'stale duplicate'},{...rows[0],threadId:'other',eventId:'other'}]},codexLiveHistory:{read:()=>complete}};
 const parse=Date.parse,parsed=[];
 t.mock.method(Date,'parse',value=>{parsed.push(value);return parse(value);});
 const result=StateStore.prototype.eventsForThread.call(fake,'t');
 assert.deepEqual(result.map(event=>event.eventId),['undated','upload','early',...rows.map(event=>event.eventId),'late']);
 assert.equal(result.find(event=>event.eventId==='upload'),upload);
 assert.equal(result.find(event=>event.eventId==='chunk-0').text,'0');
 assert.deepEqual(complete.map(event=>event.eventId),originalIds,'sorting must not mutate the parsed history snapshot');
 assert.deepEqual(new Set(parsed),new Set(['',early,middle,late]));
 assert.equal(parsed.length,4,'Each distinct timestamp is parsed once per read, outside repeated comparator work');
});
