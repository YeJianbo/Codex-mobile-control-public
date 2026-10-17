package com.localcodex.control

import android.app.Application
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

class NativePatchOpenProfileTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun profilePatchOpening(){
        val args=InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("profile")=="patch")
        val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
        fun patch(groups:Int)=buildString{
            append("*** Update File: profile.kt\n@@ -1,${groups*2} +1,${groups*2} @@\n")
            repeat(groups){index->
                append(" context $index "+"shared_text ".repeat(4)+"\n")
                append("-old $index "+"旧内容 ".repeat(8)+"\n")
                append("+new $index "+"新内容 ".repeat(8)+"\n")
            }
        }
        val small=patch(10);val large=patch(1000)
        val source=mutableStateOf(small)
        ui.setContent{MaterialTheme{NativeFileChangeCard(vm,NativeBlock("profile",ChatEvent(type="files.summary",threadId="profile"),activities=listOf(
            ChatEvent(type="file.changed",threadId="profile",eventId="patch",files=listOf("profile.kt"),fileChanges=listOf(NativeFileChange("profile.kt",1000,1000)),diff=source.value)
        )))}}
        ui.onNodeWithContentDescription("展开更改记录").performClick()
        val results=JSONArray()
        for((index,detail)in listOf(small,large,small,large,small,large).withIndex()){
            ui.runOnIdle{source.value=detail}
            ui.waitForIdle()
            val frames=CopyOnWriteArrayList<Long>();val stacks=CopyOnWriteArrayList<List<String>>()
            var lastFrame=0L
            lateinit var choreographer:Choreographer
            val callback=object:Choreographer.FrameCallback{
                override fun doFrame(frameTimeNanos:Long){
                    val now=SystemClock.elapsedRealtimeNanos()
                    if(lastFrame!=0L)frames.add(now-lastFrame)
                    lastFrame=now;choreographer.postFrameCallback(this)
                }
            }
            val sampling=AtomicBoolean(true);val main=Looper.getMainLooper().thread
            val sampler=Thread({while(sampling.get()){
                stacks.add(main.stackTrace.map{it.className+"."+it.methodName})
                Thread.sleep(2)
            }},"patch-open-sample")
            ui.runOnUiThread{choreographer=Choreographer.getInstance();choreographer.postFrameCallback(callback)}
            val started=SystemClock.elapsedRealtimeNanos();sampler.start()
            try{
                ui.onNodeWithText("profile.kt").performClick()
                ui.waitUntil(10000){ui.onAllNodesWithTag("changeLines").fetchSemanticsNodes().isNotEmpty()}
                ui.waitForIdle()
            }finally{
                sampling.set(false);sampler.join()
                ui.runOnUiThread{choreographer.removeFrameCallback(callback)}
            }
            val row=JSONObject().put("index",index).put("characters",detail.length).put("large",detail===large)
                .put("openMs",(SystemClock.elapsedRealtimeNanos()-started)/1e6)
                .put("frameGapsMs",JSONArray(frames.map{it/1e6})).put("samples",stacks.size)
            for((key,needle)in listOf("detailSamples" to "NativeChangeDetail","parseSamples" to "NativePatchKt.patchLines","measureSamples" to "android.graphics.Paint.measureText","layoutSamples" to "androidx.compose.ui.node")){
                row.put(key,stacks.count{stack->stack.any{it.contains(needle)}})
            }
            row.put("detailStacks",JSONArray(stacks.filter{stack->stack.any{it.contains("NativeChangeDetail")}}.distinct().take(6).map{JSONArray(it)}))
            results.put(row)
            ui.onNodeWithContentDescription("关闭改动").performClick()
        }
        val file=java.io.File(ui.activity.getExternalFilesDir(null),"patch-open-${args.getString("phase")?:"sample"}.json")
        file.writeText(JSONObject().put("results",results).toString())
    }
}
