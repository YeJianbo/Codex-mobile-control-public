package com.localcodex.control

/** Markwon uses double-dollar inline delimiters; keep code examples untouched. */
fun nativeMathMarkdown(text:String):String {
    fun convert(part:String):String {
        val delimiters="$"+"$"
        return part.replace(Regex("\\\\\\[([\\s\\S]*?)\\\\\\]")){"\n$delimiters\n"+it.groupValues[1]+"\n$delimiters\n"}
            .replace(Regex("\\\\\\(([^\\n]*?)\\\\\\)")){delimiters+it.groupValues[1]+delimiters}
            .replace(Regex("(?<![\\\\$])\\$(?!\\$)([^$\\n]+?)(?<!\\\\)\\$(?!\\$)")){delimiters+it.groupValues[1]+delimiters}
    }
    val protected=Regex("```[\\s\\S]*?(?:```|$)|~~~[\\s\\S]*?(?:~~~|$)|`[^`\\n]*`")
    val result=StringBuilder();var start=0
    protected.findAll(text).forEach { match ->result.append(convert(text.substring(start,match.range.first)));result.append(match.value);start=match.range.last+1}
    result.append(convert(text.substring(start)));return result.toString()
}
