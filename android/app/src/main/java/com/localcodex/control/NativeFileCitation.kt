package com.localcodex.control

import java.net.URLEncoder

private const val fileCitationPrefix=":codex-file-citation{"
private val fileCitation=Regex(":codex-file-citation\\{((?:[^\"{}]|\"(?:\\\\.|[^\"\\\\])*\")*)\\}")
private val fileCitationAttribute=Regex("([a-zA-Z_][\\w-]*)\\s*=\\s*\"((?:\\\\.|[^\"\\\\])*)\"")
private val fileCitationEscape=Regex("\\\\([\"\\\\])")
private val fileCitationScheme=Regex("^[a-z][a-z\\d+.-]*:",RegexOption.IGNORE_CASE)
private val localCitationScheme=Regex("^([a-z]:/|file:///)",RegexOption.IGNORE_CASE)
private val citationFence=Regex("^ {0,3}(`{3,}|~{3,})(.*)$")

private fun fileCitationLink(match:MatchResult):String?{
    val attrs=fileCitationAttribute.findAll(match.groupValues[1]).associate{
        it.groupValues[1] to fileCitationEscape.replace(it.groupValues[2],"$1")
    }
    val path=attrs["path"]?.replace('\\','/')?:return null
    if(path.isBlank()||path.any{it<' '}||path.startsWith("//")||
        (fileCitationScheme.containsMatchIn(path)&&!localCitationScheme.containsMatchIn(path)))return null
    val name=path.substringAfterLast('/').takeIf{it.isNotBlank()}?:return null
    val label=buildString{for(char in name){if(char in "\\`*_[<]>")append('\\');append(char)}}
    val href=URLEncoder.encode(path,"UTF-8").replace("+","%20").replace("%2F","/").replace("%3A",":")
    return "[$label](<$href>)"
}

/** Turn attachment directives into ordinary links, keeping Markdown code literal. */
internal fun nativeFileCitationMarkdown(source:String):String{
    if(!source.contains(fileCitationPrefix))return source
    val output=StringBuilder(source.length)
    var index=0
    var fence:Char?=null
    var fenceLength=0
    while(index<source.length){
        if(index==0||source[index-1]=='\n'){
            val end=source.indexOf('\n',index).let{if(it<0)source.length else it}
            val line=source.substring(index,end)
            val marker=citationFence.matchEntire(line)
            if(fence!=null||marker!=null||line.startsWith("    ")||line.startsWith('\t')){
                if(fence==null&&marker!=null){fence=marker.groupValues[1][0];fenceLength=marker.groupValues[1].length}
                else if(marker!=null&&marker.groupValues[1][0]==fence&&marker.groupValues[1].length>=fenceLength&&marker.groupValues[2].isBlank())fence=null
                val next=if(end<source.length)end+1 else end
                output.append(source,index,next);index=next;continue
            }
        }
        if(source[index]=='\\'&&index+1<source.length){
            output.append(source,index,index+2);index+=2;continue
        }
        if(source[index]=='`'){
            var end=index+1
            while(end<source.length&&source[end]=='`')end++
            val delimiter=source.substring(index,end)
            var close=source.indexOf(delimiter,end)
            while(close>=0&&((close>0&&source[close-1]=='`')||source.getOrNull(close+delimiter.length)=='`'))close=source.indexOf(delimiter,close+delimiter.length)
            val next=if(close<0)end else close+delimiter.length
            output.append(source,index,next);index=next;continue
        }
        if(source.startsWith(fileCitationPrefix,index)){
            val match=fileCitation.matchAt(source,index)
            if(match!=null){
                val link=fileCitationLink(match)
                if(link!=null){output.append(link);index=match.range.last+1;continue}
            }
        }
        output.append(source[index++])
    }
    return output.toString()
}
