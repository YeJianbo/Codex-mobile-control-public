import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type CodexGoal = {
  objective:string;
  status:'active'|'paused'|'blocked'|'usage_limited'|'budget_limited';
  tokensUsed:number;
  tokenBudget:number|null;
};

// Codex owns this database. The gateway only opens it read-only and never
// creates or modifies goal state.
export function readCodexGoals():Map<string,CodexGoal>{
  const file=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'goals_1.sqlite');
  if(!fs.existsSync(file))return new Map();
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(file,{readOnly:true});
    const rows=db.prepare("SELECT thread_id,objective,status,token_budget,tokens_used FROM thread_goals WHERE status <> 'complete'").all() as Array<Record<string,unknown>>;
    return new Map(rows.map(row=>[String(row.thread_id),{
      objective:String(row.objective),
      status:row.status as CodexGoal['status'],
      tokensUsed:Number(row.tokens_used)||0,
      tokenBudget:row.token_budget==null?null:Number(row.token_budget),
    }]));
  }catch{return new Map();}
  finally{try{db?.close();}catch{/* Codex may replace the database during a refresh. */}}
}
