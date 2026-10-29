const clockPattern=/^([01]\d|2[0-3]):[0-5]\d$/;
const duration=18000000;
export function fiveHourSchedule(value={enabled:false,times:['04:00','09:00','14:00','19:00'],timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}){
  if(!value||typeof value.enabled!=='boolean'||!Array.isArray(value.times)||!value.times.length||value.times.length>24||value.times.some(time=>typeof time!=='string'||!clockPattern.test(time)))throw Error('请设置有效的每日暖机时间');
  if(typeof value.timeZone!=='string')throw Error('暖机时区无效');
  try{new Intl.DateTimeFormat('en',{timeZone:value.timeZone}).format();}catch{throw Error('暖机时区无效');}
  return {enabled:value.enabled,times:[...new Set(value.times)].sort(),timeZone:value.timeZone};
}

// Compatibility for the single release that exposed a start/end period.
export function legacyWarmupHours(value){
  if(!value||typeof value.enabled!=='boolean'||![value.start,value.end].every(time=>typeof time==='string'&&clockPattern.test(time))||value.start===value.end)throw Error('请设置有效的预热时段');
  const minutes=time=>Number(time.slice(0,2))*60+Number(time.slice(3));
  const start=minutes(value.start),length=(minutes(value.end)-start+1440)%1440,times=[];
  for(let elapsed=0;elapsed<length;elapsed+=300){const minute=(start+elapsed)%1440;times.push(String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0'));}
  return fiveHourSchedule({enabled:value.enabled,times,timeZone:value.timeZone});
}

function parts(formatter,time){return Object.fromEntries(formatter.formatToParts(time).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));}
function localTime(formatter,year,month,day,hour,minute){
  const target=Date.UTC(year,month-1,day,hour,minute);let guess=target;
  for(let i=0;i<4;i++){
    const p=parts(formatter,guess),difference=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);
    if(!difference){
      // A repeated local clock time is one slot: choose its first occurrence.
      for(const delta of [3600000,1800000])if(guess-delta>=target-86400000){
        const earlier=parts(formatter,guess-delta);
        if(Date.UTC(earlier.year,earlier.month-1,earlier.day,earlier.hour,earlier.minute)===target)return guess-delta;
      }
      return guess;
    }
    guess+=difference;
  }
  return null; // A skipped daylight-saving clock time has no slot that day.
}

export function fiveHourSlots(settings,now){
  if(!settings.enabled)return {due:null,next:null};
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const today=parts(formatter,now),slots=[];
  for(const offset of [-1,0,1]){
    const date=new Date(Date.UTC(today.year,today.month-1,today.day+offset));
    const year=date.getUTCFullYear(),month=date.getUTCMonth()+1,day=date.getUTCDate();
    const dayKey=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    for(const time of settings.times){
      const [hour,minute]=time.split(':').map(Number),at=localTime(formatter,year,month,day,hour,minute);
      if(at!==null)slots.push({key:`${settings.timeZone}/${dayKey}/${time}`,at,expiresAt:at+duration});
    }
  }
  slots.sort((a,b)=>a.at-b.at);
  const latest=slots.findLast(slot=>slot.at<=now);
  return {due:latest&&now<latest.expiresAt?latest:null,next:slots.find(slot=>slot.at>now)||null};
}

export function recordFiveHourSlot(entry,pending,reason,now){
  if(!pending?.slot)return;
  entry.fiveHourSlots??={};entry.fiveHourSlots[pending.cycle]={at:pending.slot.at,handledAt:now,reason};
  for(const [key,value] of Object.entries(entry.fiveHourSlots))if(value.at<now-3*86400000)delete entry.fiveHourSlots[key];
}
