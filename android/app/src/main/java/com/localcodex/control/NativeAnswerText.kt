package com.localcodex.control

private val answerMetadataTag=Regex("</?(?:oai-mem-citation|citation_entries|rollout_ids)\\b",RegexOption.IGNORE_CASE)
private val answerMetadataBlock=Regex("(?ims)^[ \\t]*<(oai-mem-citation|citation_entries|rollout_ids)\\b[^>]*>.*?(?:</\\1\\s*>|\\z)")
private val answerMetadataClose=Regex("(?im)^[ \\t]*</(?:oai-mem-citation|citation_entries|rollout_ids)\\s*>[ \\t]*$")
private val answerFence=Regex("^ {0,3}(`{3,}|~{3,})(.*)$")
private val answerCitationEntries=Regex("(?is)<citation_entries\\b[^>]*>(.*?)(?:</citation_entries\\s*>|\\z)")
private val answerCitationEntry=Regex("([^\\n<>|]+?):(\\d+)(?:-(\\d+))?\\|note=\\[([^\\]\\n]*)\\]")

internal data class NativeMemoryReference(val source:String,val lines:String,val note:String)
internal data class NativeAnswerContent(val text:String,val hasMemoryReferences:Boolean=false,val memoryReferences:List<NativeMemoryReference> = emptyList())

internal fun nativeAnswerText(source:String):String=nativeAnswerContent(source).text

/** Keep reference provenance separate from prose and preserve literal fenced examples. */
internal fun nativeAnswerContent(source:String):NativeAnswerContent {
    if(!answerMetadataTag.containsMatchIn(source))return NativeAnswerContent(source)
    val output=StringBuilder()
    val prose=StringBuilder()
    var marker:Char?=null
    var markerLength=0
    var hasMemoryReferences=false
    val memoryReferences=mutableListOf<NativeMemoryReference>()
    fun flush(){
        var cleaned=prose.toString()
        do{
            val previous=cleaned
            cleaned=answerMetadataBlock.replace(cleaned){block->
                hasMemoryReferences=true
                answerCitationEntries.findAll(block.value).forEach{entries->
                    answerCitationEntry.findAll(entries.groupValues[1]).forEach{entry->
                        val start=entry.groupValues[2]
                        val end=entry.groupValues[3].ifBlank{start}
                        memoryReferences.add(NativeMemoryReference(entry.groupValues[1].trim(),if(start==end)start else "$start–$end",entry.groupValues[4].trim()))
                    }
                }
                ""
            }
        }while(cleaned!=previous)
        output.append(answerMetadataClose.replace(cleaned,""));prose.setLength(0)
    }
    source.splitToSequence('\n').forEach { line ->
        val fence=answerFence.matchEntire(line)
        if(marker==null&&fence!=null){
            flush();marker=fence.groupValues[1].first();markerLength=fence.groupValues[1].length
            output.append(line).append('\n')
        }else if(marker!=null){
            output.append(line).append('\n')
            if(fence!=null&&fence.groupValues[1].first()==marker&&fence.groupValues[1].length>=markerLength&&fence.groupValues[2].isBlank())marker=null
        }else prose.append(line).append('\n')
    }
    flush()
    return NativeAnswerContent(output.toString().trimEnd(),hasMemoryReferences,memoryReferences.distinct())
}
