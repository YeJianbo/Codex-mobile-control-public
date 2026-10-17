package com.localcodex.control

private val patchHunkHeader=Regex("^@@ -(\\d+)(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@")
private val patchSectionBoundary=Regex("(?m)(?=^diff --git |^\\*\\*\\* (?:Update|Add|Delete) File:)")
private val patchEntryHeader=Regex("^\\*\\*\\* (?:Update|Add|Delete) File: (.+)$")

internal data class PatchLine(val text:String,val oldLine:Int?=null,val newLine:Int?=null,val kind:String="meta")
internal data class PatchSection(val start:Int,val end:Int,val foldable:Boolean=false)

internal fun patchSections(rows:List<PatchLine>):List<PatchSection>{
    val sections=ArrayList<PatchSection>()
    var start=0;var index=0
    while(index<rows.size){
        if(rows[index].kind!="context"){index++;continue}
        val contextStart=index
        while(index<rows.size&&rows[index].kind=="context")index++
        if(index-contextStart>8){
            if(start<contextStart)sections.add(PatchSection(start,contextStart))
            sections.add(PatchSection(contextStart,index,true))
            start=index
        }
    }
    if(start<rows.size)sections.add(PatchSection(start,rows.size))
    return sections
}

internal fun patchLines(detail:String):List<PatchLine>{
    var old:Int?=null;var new:Int?=null;var body=false
    val rows=ArrayList<PatchLine>()
    fun append(line:String){
        val hunk=if(line.startsWith("@@ -"))patchHunkHeader.find(line) else null
        rows.add(when{
            hunk!=null->{old=hunk.groupValues[1].toInt();new=hunk.groupValues[2].toInt();body=true;PatchLine(line)}
            line.startsWith("*** Add File:")->{old=null;new=1;body=true;PatchLine(line)}
            line.startsWith("@@")-> {old=null;new=null;body=true;PatchLine(line)}
            line.startsWith("*** ")||line.startsWith("diff --git")||line.startsWith("--- ")||line.startsWith("+++ ")->{body=false;old=null;new=null;PatchLine(line)}
            body&&line.startsWith("+")->{val n=new;new=new?.plus(1);PatchLine(line,null,n,"add")}
            body&&line.startsWith("-")->{val n=old;old=old?.plus(1);PatchLine(line,n,null,"del")}
            body&&line.startsWith(" ")->{val o=old;val n=new;old=old?.plus(1);new=new?.plus(1);PatchLine(line,o,n,"context")}
            else->PatchLine(line)
        })
    }
    var start=0;var index=0
    while(index<detail.length){
        val value=detail[index]
        if(value=='\n'||value=='\r'){
            append(detail.substring(start,index))
            if(value=='\r'&&index+1<detail.length&&detail[index+1]=='\n')index++
            start=index+1
        }
        index++
    }
    append(detail.substring(start))
    return rows
}
internal fun nativePatchTooLarge(detail:String):Boolean{
    if(detail.length>262144)return true
    var newlines=0;var start=0
    for(index in detail.indices){
        val value=detail[index]
        if(value=='\n'&&++newlines>5000)return true
        if(value=='\n'||value=='\r'){
            if(index-start>10000)return true
            start=index+1
        }
    }
    return detail.length-start>10000
}
internal fun filePatch(detail:String,file:String):String{
    val sections=detail.split(patchSectionBoundary)
    var identified=false
    val selected=sections.filter{section->
        val matches=patchSectionMatches(section,file)
        if(matches!=null)identified=true
        matches==true
    }
    // Headerless fragments belong to the event's file; known sections must not
    // fall back to another file when the requested path is absent.
    return if(identified)selected.joinToString("\n") else detail
}
private fun patchPath(value:String)=value.removeSurrounding("\"").replace('\\','/').removePrefix("./")
private fun patchSectionMatches(section:String,file:String):Boolean?{
    val header=section.lineSequence().firstOrNull().orEmpty()
    val target=patchPath(file)
    patchEntryHeader.matchEntire(header)?.let{return patchPath(it.groupValues[1])==target}
    val git=header.startsWith("diff --git ")
    if(!git&&!header.startsWith("--- "))return null
    var recorded=false
    for(line in section.lineSequence().takeWhile{!it.startsWith("@@")}){
        val path=when{
            line.startsWith("--- ")->patchPath(line.substring(4).substringBefore('\t')).removePrefix("a/")
            line.startsWith("+++ ")->patchPath(line.substring(4).substringBefore('\t')).removePrefix("b/")
            line.startsWith("rename from ")->patchPath(line.substring(12))
            line.startsWith("rename to ")->patchPath(line.substring(10))
            else->null
        }
        if(path!=null){recorded=true;if(path!="/dev/null"&&path==target)return true}
    }
    if(recorded||!git)return false
    return header=="diff --git a/$target b/$target"||header=="diff --git \"a/$target\" \"b/$target\""
}
