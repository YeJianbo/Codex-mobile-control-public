const weekdays=[['MO','一'],['TU','二'],['WE','三'],['TH','四'],['FR','五'],['SA','六'],['SU','日']];
const part=(rule,key)=>rule.replace(/^RRULE:/,'').split(';').find(value=>value.startsWith(key+'='))?.slice(key.length+1)||'';
export function automationRuleLabel(rule){
  const frequency=part(rule,'FREQ'),interval=Number(part(rule,'INTERVAL'))||1;
  if(['MINUTELY','HOURLY'].includes(frequency)&&!rule.includes('BY'))return `每 ${interval} ${frequency==='MINUTELY'?'分钟':'小时'}`;
  const hour=part(rule,'BYHOUR'),minute=part(rule,'BYMINUTE'),days=part(rule,'BYDAY').split(',');
  if(!/^\d{1,2}$/.test(hour)||!/^\d{1,2}$/.test(minute))return !rule.includes('BY')&&['DAILY','WEEKLY'].includes(frequency)?`每 ${interval} ${frequency==='DAILY'?'天':'周'}`:'自定义时间';
  const time=hour.padStart(2,'0')+':'+minute.padStart(2,'0');
  if(frequency==='DAILY')return (interval===1?'每天':`每 ${interval} 天`)+' '+time;
  if(frequency==='WEEKLY')return (interval===1&&days.length===5&&weekdays.slice(0,5).every(([day])=>days.includes(day))?'工作日':(interval===1?'每周':`每 ${interval} 周`)+weekdays.filter(([day])=>days.includes(day)).map(([,name])=>name).join('、'))+' '+time;
  return '自定义时间';
}

/** Calendar rules use the desktop scheduler's local timezone; intervals remain elapsed time. */
export function automationScheduleEditor(el,button,rule='',timeZone='电脑时区'){
  const root=el('div','automation-schedule'),presets=el('div','segmented'),units=el('div','segmented'),dayButtons=el('div','segmented automation-weekdays');
  const interval=el('input'),time=el('input'),details=el('div','automation-interval');
  let frequency=part(rule,'FREQ')||'MINUTELY',selectedDays=new Set((part(rule,'BYDAY')||'MO').split(','));
  interval.type='number';interval.min='1';interval.max='10080';interval.value=part(rule,'INTERVAL')||'5';interval.setAttribute('aria-label','每隔');
  time.type='time';time.value=(part(rule,'BYHOUR')||'09').padStart(2,'0')+':'+(part(rule,'BYMINUTE')||'00').padStart(2,'0');time.setAttribute('aria-label','运行时间');
  let mode=['DAILY','WEEKLY'].includes(frequency)?Number(interval.value)>1?'custom':frequency==='DAILY'?'daily':selectedDays.size===5&&weekdays.slice(0,5).every(([day])=>selectedDays.has(day))?'weekdays':'weekly':'interval';
  const group=(node,options,selected,select)=>{
    node.replaceChildren();
    for(const [value,label] of options){
      const option=button(label,()=>select(value),'');option.setAttribute('aria-pressed',String(selected(value)));option.classList.toggle('selected',selected(value));node.append(option);
    }
  };
  const render=()=>{
    group(presets,[['interval','间隔'],['daily','每天'],['weekdays','工作日'],['weekly','每周'],['custom','自定义']],value=>mode===value,value=>{
      mode=value;if(mode==='interval'&&!['MINUTELY','HOURLY'].includes(frequency))frequency='HOURLY';
      if(mode==='custom'&&!['DAILY','WEEKLY'].includes(frequency))frequency='WEEKLY';render();
    });
    const variable=mode==='interval'||mode==='custom';interval.hidden=units.hidden=!variable;time.hidden=mode==='interval';
    group(units,mode==='interval'?[['MINUTELY','分钟'],['HOURLY','小时']]:[['DAILY','天'],['WEEKLY','周']],value=>frequency===value,value=>{frequency=value;render();});
    dayButtons.hidden=!(mode==='weekly'||mode==='custom'&&frequency==='WEEKLY');
    group(dayButtons,weekdays.map(([day,name])=>[day,'周'+name]),day=>selectedDays.has(day),day=>{if(selectedDays.has(day))selectedDays.delete(day);else selectedDays.add(day);render();});
  };
  details.append(interval,units,time);root.append(presets,details,dayButtons,el('small','muted','按 '+timeZone+' 运行'));render();
  return {element:root,value(){
    const calendar=mode!=='interval',count=mode==='interval'||mode==='custom'?Number(interval.value):1;
    if(!Number.isInteger(count)||count<1||count>10080)throw Error('间隔需要为 1–10080');
    const value={frequency:mode==='daily'?'DAILY':['weekly','weekdays'].includes(mode)?'WEEKLY':frequency,interval:count};
    if(calendar){
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.value))throw Error('请选择运行时间');
      [value.hour,value.minute]=time.value.split(':').map(Number);
      if(value.frequency==='WEEKLY'){
        value.days=weekdays.filter(([day],index)=>mode==='weekdays'?index<5:selectedDays.has(day)).map(([day])=>day);
        if(!value.days.length)throw Error('请选择运行星期');
      }
    }
    return value;
  }};
}
