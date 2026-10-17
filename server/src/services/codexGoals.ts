import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type CodexGoal = {
  objective:string;
  status:'active'|'paused'|'blocked'|'usage_limited'|'budget_limited'|'complete';
  tokensUsed:number;
  tokenBudget:number|null;
  timeUsedSeconds?:number;
  goalId?:string;
  createdAtMs?:number;
  updatedAtMs?:number;
};

// Codex owns this database. The gateway reads it without writing SQL;
// goal updates go through the app-server thread/goal/set API.
export function readCodexGoals():Map<string,CodexGoal>{
  return new Map([...(readCodexGoalSnapshot()??[])].filter(([,goal])=>goal.status!=='complete'));
}
export function readCodexGoalSnapshot():Map<string,CodexGoal>|null{
  const file=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'goals_1.sqlite');
  if(!fs.existsSync(file))return null;
  let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(file,{readOnly:true});
    const columns=new Set((db.prepare('PRAGMA table_info(thread_goals)').all() as {name:string}[]).map(row=>row.name));
    const extra=['time_used_seconds','goal_id','created_at_ms','updated_at_ms'].filter(column=>columns.has(column));
    const rows=db.prepare(`SELECT thread_id,objective,status,token_budget,tokens_used${extra.length?','+extra.join(','):''} FROM thread_goals`).all() as Array<Record<string,unknown>>;
    return new Map(rows.map(row=>[String(row.thread_id),{
      objective:String(row.objective),
      status:row.status as CodexGoal['status'],
      tokensUsed:Number(row.tokens_used)||0,
      tokenBudget:row.token_budget==null?null:Number(row.token_budget),
      ...(row.time_used_seconds!=null?{timeUsedSeconds:Math.max(0,Number(row.time_used_seconds)||0)}:{}),
      ...(row.goal_id?{goalId:String(row.goal_id)}:{}),
      ...(row.created_at_ms!=null?{createdAtMs:Number(row.created_at_ms)}:{}),
      ...(row.updated_at_ms!=null?{updatedAtMs:Number(row.updated_at_ms)}:{}),
    }]));
  }catch{return null;}
  finally{try{db?.close();}catch{/* Codex may replace the database during a refresh. */}}
}

export class GoalCompletionTracker {
  constructor(private previous:Map<string,CodexGoal>|null=null){}
  accept(current:Map<string,CodexGoal>|null){
    if(!current)return [];
    const completed=[...current].filter(([id,goal])=>{
      const before=this.previous?.get(id);
      return goal.status==='complete'&&before&&before.status!=='complete'&&before.goalId===goal.goalId;
    }).map(([threadId,goal])=>({threadId,goal}));
    this.previous=current;
    return completed;
  }
}
