import {z} from 'zod';

const weekdays=['MO','TU','WE','TH','FR','SA','SU'] as const;
export const automationScheduleSchema=z.object({
  frequency:z.enum(['MINUTELY','HOURLY','DAILY','WEEKLY']),
  interval:z.number().int().min(1).max(10080),
  hour:z.number().int().min(0).max(23).optional(),
  minute:z.number().int().min(0).max(59).optional(),
  days:z.array(z.enum(weekdays)).min(1).max(7).optional(),
}).strict().superRefine((value,ctx)=>{
  const calendar=value.frequency==='DAILY'||value.frequency==='WEEKLY';
  // Legacy clients may still send an interval-only daily/weekly rule.
  if((value.hour===undefined)!==(value.minute===undefined))ctx.addIssue({code:'custom',message:'请填写完整的运行时间'});
  if(!calendar&&(value.hour!==undefined||value.days!==undefined))ctx.addIssue({code:'custom',message:'间隔任务只支持分钟或小时'});
  if(value.days!==undefined&&value.frequency!=='WEEKLY')ctx.addIssue({code:'custom',message:'星期选择只适用于每周任务'});
  if(value.frequency==='WEEKLY'&&value.hour!==undefined&&!value.days?.length)ctx.addIssue({code:'custom',message:'请选择运行星期'});
});
export type AutomationSchedule=z.infer<typeof automationScheduleSchema>;

export function automationRule(value:AutomationSchedule){
  const schedule=automationScheduleSchema.parse(value);
  const parts=[`FREQ=${schedule.frequency}`,`INTERVAL=${schedule.interval}`];
  if(schedule.days)parts.push('BYDAY='+weekdays.filter(day=>schedule.days!.includes(day)).join(','));
  if(schedule.hour!==undefined)parts.push(`BYHOUR=${schedule.hour}`,`BYMINUTE=${schedule.minute}`, 'BYSECOND=0');
  return parts.join(';');
}
