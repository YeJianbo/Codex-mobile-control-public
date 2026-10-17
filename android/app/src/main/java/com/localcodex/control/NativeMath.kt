package com.localcodex.control

private val displayMathPattern=Regex("\\\\\\[([\\s\\S]*?)\\\\\\]")
private val parenthesizedMathPattern=Regex("\\\\\\(([^\\n]*?)\\\\\\)")
private val inlineMathPattern=Regex("(?<![\\\\$])\\$(?!\\$)([^$\\n]+?)(?<!\\\\)\\$(?!\\$)")
private val mathCodePattern=Regex("```[\\s\\S]*?(?:```|$)|~~~[\\s\\S]*?(?:~~~|$)|`[^`\\n]*`")

/** Markwon uses double-dollar inline delimiters; keep code examples untouched. */
fun nativeMathMarkdown(text:String):String {
    if('$' !in text && '\\' !in text)return text
    fun convert(part:String):String {
        if('$' !in part && '\\' !in part)return part
        val delimiters="$"+"$"
        return part.replace(displayMathPattern){"\n$delimiters\n"+it.groupValues[1]+"\n$delimiters\n"}
            .replace(parenthesizedMathPattern){delimiters+it.groupValues[1]+delimiters}
            .replace(inlineMathPattern){delimiters+it.groupValues[1]+delimiters}
    }
    var result:StringBuilder?=null
    var start=0
    fun appendProse(end:Int){
        val source=text.substring(start,end)
        val converted=convert(source)
        if(converted!=source&&result==null)result=StringBuilder(text.length).append(text,0,start)
        result?.append(converted)
    }
    mathCodePattern.findAll(text).forEach{match->
        appendProse(match.range.first)
        result?.append(text,match.range.first,match.range.last+1)
        start=match.range.last+1
    }
    appendProse(text.length)
    return result?.toString()?:text
}
