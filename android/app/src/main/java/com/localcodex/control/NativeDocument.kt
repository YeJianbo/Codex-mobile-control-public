package com.localcodex.control

data class NativeDocumentPart(val kind:String,val text:String,val language:String="")
private val documentFence=Regex("^(`{3,}|~{3,})(.*)$")
private val documentTableSeparator=Regex("^[| :\\-]+$")

/** Keep fenced code literal; wide blocks scroll independently from the conversation. */
fun nativeDocumentParts(text:String):List<NativeDocumentPart>{
    val lines=text.lines()
    val result=mutableListOf<NativeDocumentPart>()
    val prose=mutableListOf<String>()
    fun flush(){if(prose.any{it.isNotBlank()})result.add(NativeDocumentPart("text",prose.joinToString("\n")));prose.clear()}
    var i=0
    while(i<lines.size){
        val line=lines[i].trim()
        val fence=documentFence.matchEntire(line)
        if(fence!=null){
            flush();val marker=fence.groupValues[1];val content=mutableListOf<String>();i++
            val closingFence=Regex("^${Regex.escape(marker.first().toString())}{${marker.length},}\\s*$")
            while(i<lines.size&&!closingFence.matches(lines[i].trim())){content.add(lines[i]);i++}
            if(i<lines.size)i++
            result.add(NativeDocumentPart("code",content.joinToString("\n"),fence.groupValues[2].trim()));continue
        }
        val mathOpen=line.startsWith("$$")||line.startsWith("\\[")
        if(mathOpen){
            val closing=if(line.startsWith("$$"))"$$" else "\\]"
            val content=mutableListOf(lines[i]);val complete=line.length>4&&line.endsWith(closing);i++
            if(!complete){while(i<lines.size){val current=lines[i++];content.add(current);if(current.trim().endsWith(closing))break}}
            flush();result.add(NativeDocumentPart("math",content.joinToString("\n")));continue
        }
        if(i+1<lines.size&&line.contains('|')&&documentTableSeparator.matches(lines[i+1].trim())&&lines[i+1].contains("---")){
            flush();val rows=mutableListOf(lines[i++],lines[i++]);while(i<lines.size&&lines[i].contains('|')&&lines[i].isNotBlank())rows.add(lines[i++]);result.add(NativeDocumentPart("table",rows.joinToString("\n")));continue
        }
        prose.add(lines[i++])
    }
    flush();return result
}
