export function filterRelayTools(body,flags={}){
  const blocked=type=>flags.filterImages&&type==='image_generation'||flags.filterWebSearch&&(type==='web_search'||type==='web_search_preview'||/^web_search_\d+$/.test(type||''));
  const payload={...body};
  if(Array.isArray(body.tools))payload.tools=body.tools.filter(t=>!blocked(t.type));
  if(body.tool_choice&&blocked(body.tool_choice.type))delete payload.tool_choice;
  if(body.tool_choice?.type==='allowed_tools'&&Array.isArray(body.tool_choice.tools)){const tools=body.tool_choice.tools.filter(t=>!blocked(t.type));if(tools.length)payload.tool_choice={...body.tool_choice,tools};else delete payload.tool_choice;}
  return payload;
}
