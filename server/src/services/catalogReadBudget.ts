// A picker can render completed sources while slow providers continue the shared read.
// This only bounds the HTTP wait; validation still awaits the original provider read.
export async function catalogReadBudget(read:Promise<unknown>,milliseconds=200):Promise<void>{
  let timer:NodeJS.Timeout|undefined;
  try{
    await Promise.race([read.catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,milliseconds);})]);
  }finally{if(timer)clearTimeout(timer);}
}
