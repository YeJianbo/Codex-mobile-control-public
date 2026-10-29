import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {registerAgentInstructions,stripSessionInstructionPrefix} from '../dist/services/agentInstructions.js';

test('project instructions use the authorized workspace and detect concurrent edits',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cmc-instructions-'));
  const oldCodex=process.env.CODEX_HOME;
  process.env.CODEX_HOME=path.join(root,'codex');
  const first='12345678-1234-1234-1234-123456789abc',second='12345678-1234-1234-1234-123456789abd',other='12345678-1234-1234-1234-123456789abe';
  const project=path.join(root,'project'),otherProject=path.join(root,'other');
  const app=Fastify();
  registerAgentInstructions(app,async(_request,id)=>{
    if(id===first||id===second||id==='claude-'+first)return project;
    if(id===other)return otherProject;
    throw Error('not authorized');
  },undefined);
  const url=(id,agent='codex',scope='project')=>`/api/agent-instructions?scope=${scope}&agent=${agent}&threadId=${id}`;
  try{
    await fs.mkdir(project);
    await fs.writeFile(path.join(project,'AGENTS.md'),'original');
    const initial=(await app.inject({method:'GET',url:url(first)})).json();
    assert.equal(initial.file,path.join(project,'AGENTS.md'));
    assert.equal(initial.content,'original');
    assert.equal((await app.inject({method:'PUT',url:url(first),payload:{content:'shared',revision:initial.revision}})).statusCode,200);
    assert.equal((await app.inject({method:'GET',url:url(second)})).json().content,'shared');
    assert.equal((await app.inject({method:'GET',url:url(other)})).json().content,'');
    assert.equal((await app.inject({method:'GET',url:url(first,'codex','session')})).json().file,initial.file);
    assert.notEqual((await app.inject({method:'PUT',url:url(first),payload:{content:'stale',revision:initial.revision}})).statusCode,200);
    assert.equal((await app.inject({method:'GET',url:url('claude-'+first,'claude')})).json().file,path.join(project,'CLAUDE.md'));
    assert.notEqual((await app.inject({method:'GET',url:url(first,'claude')})).statusCode,200);
    assert.notEqual((await app.inject({method:'GET',url:url('12345678-1234-1234-1234-123456789abf')})).statusCode,200);
    assert.notEqual((await app.inject({method:'GET',url:url(first)+'&file=../outside'})).statusCode,200);
    const global='/api/agent-instructions?scope=global&agent=codex';
    const before=(await app.inject({method:'GET',url:global})).json();
    assert.equal((await app.inject({method:'PUT',url:global,payload:{content:'global',revision:before.revision}})).statusCode,200);
    assert.equal(await fs.readFile(path.join(root,'codex','AGENTS.md'),'utf8'),'global');
    assert.equal(stripSessionInstructionPrefix('<cmc-session-instructions>\nold\n</cmc-session-instructions>\n\nmessage'),'message');
  }finally{
    await app.close();
    if(oldCodex===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=oldCodex;
    await fs.rm(root,{recursive:true,force:true});
  }
});
