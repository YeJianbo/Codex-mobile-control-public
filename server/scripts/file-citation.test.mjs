import test from 'node:test';
import assert from 'node:assert/strict';
import {Marked} from 'marked';
import {fileCitationExtension,parseFileCitation} from '../src/services/fileCitation.ts';

const parser=new Marked({extensions:[fileCitationExtension]});
const directive=':codex-file-citation{path="D:/codex/project/skill/output/墨尔本 航班_%20#最终.xlsx" artifact_kind="workbook" purpose="output"}';
test('Codex workbook directives render as local file links with the exact filename',()=>{
  const file=parseFileCitation(directive);
  assert.equal(file.label,'墨尔本 航班_%20#最终.xlsx');
  assert.equal(decodeURIComponent(file.href),'D:/codex/project/skill/output/墨尔本 航班_%20#最终.xlsx');
  const links=[];parser.walkTokens(parser.lexer('已改好。\n\n'+directive),token=>{if(token.type==='link')links.push(token);});
  assert.equal(links.length,1);assert.equal(links[0].text,file.label);
  const html=parser.parse(directive);assert.match(html,/<a href=/);assert(!html.includes('artifact_kind'));assert(!html.includes('codex-file-citation'));
});
test('literal examples, remote schemes and unfinished directives do not create file links',()=>{
  for(const source of ['`'+directive+'`','```text\n'+directive+'\n```','\\'+directive,
    ':codex-file-citation{path="javascript:alert(1)"}',':codex-file-citation{path="//server/share/file.xlsx"}',directive.slice(0,-1)]){
    const links=[];parser.walkTokens(parser.lexer(source),token=>{if(token.type==='link')links.push(token);});assert.equal(links.length,0,source);
  }
});
