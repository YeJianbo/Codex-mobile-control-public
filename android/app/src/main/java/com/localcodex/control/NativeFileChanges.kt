package com.localcodex.control

data class NativeFileChange(val path:String,val added:Int?=null,val removed:Int?=null)
private val unifiedFileHeader=Regex("^\\+\\+\\+ (?:b/)?(.+)$")
private val patchFileHeader=Regex("^\\*\\*\\* (?:Update|Add|Delete) File: (.+)$")
private fun nativePatchFilePaths(diff:String):List<String> = buildList{
    // Literal searches skip patch bodies without creating a matcher for each line.
    var unified=diff.indexOf("+++ ");var patch=diff.indexOf("*** ")
    while(unified>=0||patch>=0){
        val start=if(unified<0)patch else if(patch<0)unified else minOf(unified,patch)
        if(start==unified)unified=diff.indexOf("+++ ",start+4) else patch=diff.indexOf("*** ",start+4)
        if(start>0&&diff[start-1]!='\r'&&diff[start-1]!='\n')continue
        var end=start+4
        while(end<diff.length&&diff[end]!='\r'&&diff[end]!='\n')end++
        val line=diff.substring(start,end)
        val header=unifiedFileHeader.find(line)?:patchFileHeader.find(line)
        if(header!=null&&header.groupValues[1]!="/dev/null")add(header.groupValues[1])
    }
}
// Prepare full activity details on the loading dispatcher, before they replace
// the lightweight event. Timeline refreshes can then reuse the same summary.
internal fun ChatEvent.withNativeFileChanges():ChatEvent{
    if(fileChanges.isNotEmpty()||diff.isEmpty()||(type!="file.changed"&&type!="diff.updated"))return this
    val changes=nativeFileChanges(listOf(this))
    return if(changes.isEmpty())this else copy(fileChanges=changes)
}
internal fun nativeFileChanges(events:List<ChatEvent>,includeLineCounts:Boolean=true):List<NativeFileChange>{
    val files=linkedMapOf<String,NativeFileChange>()
    fun remember(file:NativeFileChange){
        val previous=files[file.path]
        files[file.path]=file.copy(added=file.added?:previous?.added,removed=file.removed?:previous?.removed)
    }
    events.forEach{event->
        event.fileChanges.forEach{remember(it)}
        if(event.type=="file.changed"||event.type=="diff.updated"){
            event.files.forEach{files.putIfAbsent(it,NativeFileChange(it))}
            if(event.fileChanges.isNotEmpty())return@forEach
            if(!includeLineCounts){
                nativePatchFilePaths(event.diff).forEach{path->files[path]=NativeFileChange(path)}
                return@forEach
            }
            var current:String?=null;var hunk=false
            val parsed=linkedMapOf<String,NativeFileChange>()
            event.diff.lineSequence().forEach{line->
                val header=unifiedFileHeader.find(line)?:patchFileHeader.find(line)
                if(header!=null){current=header.groupValues[1];hunk=line.startsWith("*** Add File:");if(current!="/dev/null")parsed[current!!]=if(line.startsWith("*** Delete File:"))NativeFileChange(current!!) else NativeFileChange(current!!,0,0)}
                else if(line.startsWith("@@"))hunk=true
                else if(hunk){val file=parsed[current];if(file!=null)parsed[file.path]=file.copy(added=(file.added?:0)+if(line.startsWith("+"))1 else 0,removed=(file.removed?:0)+if(line.startsWith("-"))1 else 0)}
            }
            parsed.values.forEach{remember(it)}
        }
    }
    return files.values.toList()
}
