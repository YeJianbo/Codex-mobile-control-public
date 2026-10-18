export function localDate(time){const d=new Date(time);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}

export function localHour(time){return localDate(time)+'T'+String(new Date(time).getHours()).padStart(2,'0');}
