import fs from 'node:fs/promises';
import path from 'node:path';

// Windows mock executables for the actual gateway/CLI adapter path. No account or tools.
export async function backendCliFixtures(home){
 const script=path.join(home,'backend-cli-fixture.mjs'),metrics=path.join(home,'backend-cli-metrics.json');
 for(const value of [process.execPath,script])if(/["%\r\n]/.test(value))throw Error('Unsafe fixture command path');
 await fs.writeFile(script,`import readline from 'node:readline';import fs from 'node:fs';
 const agent=process.argv[2],args=process.argv.slice(3),send=o=>console.log(JSON.stringify(o));
 if(args.includes('models')){console.log('fixture-medium\\tFixture (Medium)\\nfixture-high\\tFixture (High)');process.exit(0);}
 const arg=n=>args.includes(n)?args[args.indexOf(n)+1]:undefined;const session=arg('--resume')||arg('--conversation')||'fixture-'+agent;
 readline.createInterface({input:process.stdin}).on('line',line=>{const message=JSON.parse(line);if(message.type==='control_response')return;
 const text=agent==='agy'?message.message.content:message.message.content[0].text;
 let counts={};try{counts=JSON.parse(fs.readFileSync(${JSON.stringify(metrics)},'utf8'));}catch{}counts[agent]=(counts[agent]||0)+1;fs.writeFileSync(${JSON.stringify(metrics)},JSON.stringify(counts));
 send(agent==='agy'?{event:'init',conversation_id:session}:{type:'system',session_id:session,model:'grok-fixture'});
 if(agent==='agy'&&text==='LONG'){
   const chunks=Array.from({length:12050},(_,i)=>'段🙂'+i+'|'),answer='AGY_HEAD|'+chunks.join('')+'AGY_END';
   send({event:'step_update',step_update:{step_type:'agent_response',step_index:1,text_delta:'AGY_HEAD|'}});
   for(const chunk of chunks)send({event:'step_update',step_update:{step_type:'agent_response',step_index:1,text_delta:chunk}});
   process.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',conversation_id:session,response:answer}}),()=>process.exit(0));return;
 }
 if(text==='SLOW'){setInterval(()=>send(agent==='agy'?{event:'step_update',step_update:{step_type:'agent_response',step_index:1,text_delta:'waiting'}}:{type:'stream_event',event:{delta:{type:'text_delta',text:'waiting'}}}),100);return;}
 const failed=text==='FAIL',answer=agent+' fixture '+(args.includes('--resume')||args.includes('--conversation')?'resumed':'started');
 if(!failed)for(const chunk of [answer.slice(0,5),answer.slice(5)])send(agent==='agy'?{event:'step_update',step_update:{step_type:'agent_response',step_index:1,text_delta:chunk}}:{type:'stream_event',event:{delta:{type:'text_delta',text:chunk}}});
 send(agent==='agy'?{event:'result',result:{status:failed?'FAILED':'SUCCESS',conversation_id:session,response:failed?'fixture provider unavailable':answer}}:{type:'result',session_id:session,is_error:failed,result:failed?'fixture provider unavailable':answer});process.stdout.write('',()=>process.exit(0));
 });`);
 const result={metrics};
 for(const [agent,key] of [['agy','CODEX_MOBILE_CONTROL_AGY_BIN'],['claude','CODEX_MOBILE_CONTROL_CLAUDE_BIN']]){
   const windows=process.platform==='win32',file=path.join(home,agent+'-fixture'+(windows?'.cmd':'.sh'));
   const quote=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
   await fs.writeFile(file,windows?`@"${process.execPath}" "${script}" ${agent} %*\r\n`:`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} ${agent} "$@"\n`);if(!windows)await fs.chmod(file,0o700);result[key]=file;
 }
 return result;
}
