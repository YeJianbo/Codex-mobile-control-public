package com.localcodex.control

import android.text.Spanned
import io.noties.markwon.Markwon
import org.commonmark.node.AbstractVisitor
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.Text
import org.commonmark.node.Image
import org.commonmark.parser.Parser

private val imageLinkParser=Parser.builder().build()
internal fun nativeMarkdownImageDestination(source:String):String? {
    var destination:String?=null
    imageLinkParser.parse(source).accept(object:AbstractVisitor(){
        override fun visit(node:Image){destination=node.destination}
    })
    return destination
}

// CommonMark treats punctuation before ** followed by Chinese text as a non-closing delimiter.
// Recover plain Chinese emphasis in text nodes; code, escapes and nested markup keep normal parsing.
private val cjkStrong=Regex("(?<![\\\\*])\\*\\*([^*`_\\[\\]\\\\$\\n]+[\\p{P}])\\*\\*(?=[\\p{IsHan}])")

internal fun nativeRenderMarkdown(markwon:Markwon,source:String):Spanned {
    return markwon.render(nativeMarkdownTree(markwon,source))
}

private fun nativeMarkdownTree(markwon:Markwon,source:String):org.commonmark.node.Node {
    val markdown=nativeMathMarkdown(source)
    val eligible=cjkStrong.findAll(markdown).map{it.value}.toSet()
    val document=markwon.parse(markdown)
    if(eligible.isNotEmpty())document.accept(object:AbstractVisitor(){
        override fun visit(node:Text){
            val original=node.literal
            val matches=cjkStrong.findAll(original).filter{it.value in eligible}.toList()
            if(matches.isEmpty())return
            var start=0
            for(match in matches){
                if(match.range.first>start)node.insertBefore(Text(original.substring(start,match.range.first)))
                node.insertBefore(StrongEmphasis().apply{appendChild(Text(match.groupValues[1]))})
                start=match.range.last+1
            }
            if(start<original.length)node.insertBefore(Text(original.substring(start)))
            node.unlink()
        }
    })
    return document
}

internal data class NativeReaderPart(val rendered:Spanned?=null,val image:String="",val label:String="",val code:String?=null,val language:String="")

internal fun nativeReaderParts(markwon:Markwon,source:String):List<NativeReaderPart> {
    val document=nativeMarkdownTree(markwon,source)
    val slots=mutableListOf<Pair<String,NativeReaderPart>>()
    val prefix="\uE000${java.util.UUID.randomUUID()}:"
    fun replace(node:org.commonmark.node.Node,part:NativeReaderPart){
        val marker="$prefix${slots.size}\uE001"
        slots.add(marker to part)
        node.insertBefore(Text(marker));node.unlink()
    }
    // Only actual syntax-tree nodes become views; escaped examples and code remain literal.
    document.accept(object:AbstractVisitor(){
        override fun visit(node:Image){
            val label=StringBuilder()
            node.accept(object:AbstractVisitor(){override fun visit(node:Text){label.append(node.literal)}})
            replace(node,NativeReaderPart(image=node.destination,label=label.toString()))
        }
        override fun visit(node:org.commonmark.node.FencedCodeBlock){replace(node,NativeReaderPart(code=node.literal,language=node.info))}
        override fun visit(node:org.commonmark.node.IndentedCodeBlock){replace(node,NativeReaderPart(code=node.literal))}
    })
    val rendered=markwon.render(document)
    val parts=mutableListOf<NativeReaderPart>()
    var start=0
    fun textUntil(end:Int){
        if(end>start){
            val text=android.text.SpannableStringBuilder(rendered,start,end)
            if(text.isNotBlank())parts.add(NativeReaderPart(rendered=text))
        }
    }
    for((marker,part) in slots){
        val index=rendered.indexOf(marker,start)
        if(index<0)continue
        textUntil(index);parts.add(part);start=index+marker.length
    }
    textUntil(rendered.length)
    return parts
}
