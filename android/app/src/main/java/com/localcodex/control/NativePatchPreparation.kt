package com.localcodex.control

import android.graphics.Paint
import android.graphics.Typeface
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

internal data class NativeSelectedFilePatch(val events:List<ChatEvent>,val detail:String)

internal suspend fun prepareNativeFilePatch(events:List<ChatEvent>,file:String):NativeSelectedFilePatch {
    val context=currentCoroutineContext()
    val selected=ArrayList<ChatEvent>()
    val bodies=linkedSetOf<String>()
    for(event in events){
        context.ensureActive()
        if(event.fileChanges.any{it.path==file}||file in event.files||
            event.diff.contains(file)&&filePatch(event.diff,file).isNotBlank()||
            event.detail.contains(file)&&filePatch(event.detail,file).isNotBlank()){
            selected.add(event)
            val body=event.diff.ifBlank{event.detail.takeIf{it.contains("*** Begin Patch")}.orEmpty()}
            if(body.isNotBlank())bodies.add(body)
        }
    }
    context.ensureActive()
    val detail=filePatch(bodies.joinToString("\n"),file)
    context.ensureActive()
    return NativeSelectedFilePatch(selected,detail)
}

internal data class NativePreparedPatch(
    val tooLarge:Boolean,
    val rows:List<PatchLine>,
    val sections:List<PatchSection>,
    val codeWidth:Float,
    val additions:Int,
    val deletions:Int
)

internal suspend fun prepareNativePatch(detail:String,textSize:Float):NativePreparedPatch {
    val context=currentCoroutineContext()
    val tooLarge=nativePatchTooLarge(detail)
    context.ensureActive()
    val rows=if(tooLarge)emptyList() else patchLines(detail)
    context.ensureActive()
    val paint=Paint().apply{typeface=Typeface.MONOSPACE;this.textSize=textSize}
    var width=0f;var additions=0;var deletions=0
    rows.forEachIndexed{index,line->
        if(index%64==0)context.ensureActive()
        width=maxOf(width,paint.measureText(line.text))
        if(line.text.startsWith("+")&&!line.text.startsWith("+++"))additions++
        if(line.text.startsWith("-")&&!line.text.startsWith("---"))deletions++
    }
    val sections=patchSections(rows)
    context.ensureActive()
    return NativePreparedPatch(tooLarge,rows,sections,width,additions,deletions)
}
