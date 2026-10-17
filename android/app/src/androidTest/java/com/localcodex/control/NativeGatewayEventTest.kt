package com.localcodex.control

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeGatewayEventTest {
    @Test fun loadedFileDetailsRetainTheirSummaryAndFullPatch()=runBlocking {
        val patch="--- a/a.kt\n+++ b/a.kt\n@@ -1 +1 @@\n-old\n+new"
        val rows=JSONArray()
            .put(JSONObject().put("type","file.changed").put("threadId","t").put("eventId","patch-a").put("files",JSONArray().put("a.kt")).put("diff",patch))
            .put(JSONObject().put("type","diff.updated").put("threadId","t").put("eventId","patch-b").put("diff","*** Begin Patch\n*** Add File: b.kt\n+new\n*** End Patch"))
            .put(JSONObject().put("type","file.changed").put("threadId","t").put("eventId","known").put("diff",patch).put("fileChanges",JSONArray().put(JSONObject().put("path","a.kt").put("added",7).put("removed",2))))
        val server=MockWebServer()
        server.enqueue(MockResponse().setBody(JSONObject().put("events",rows).toString()))
        server.start()
        try {
            val client=GatewayClient(server.url("/").toString().trimEnd('/'),"test-token")
            val events=withContext(Dispatchers.IO){client.nativeActivity("t",eventIds=listOf("patch-a","patch-b","known"))}
            assertEquals(listOf("patch-a","patch-b","known"),events.map{it.eventId})
            assertEquals(listOf(NativeFileChange("a.kt",1,1)),events[0].fileChanges)
            assertEquals(listOf(NativeFileChange("b.kt",1,0)),events[1].fileChanges)
            assertEquals(listOf(NativeFileChange("a.kt",7,2)),events[2].fileChanges)
            assertEquals(patch,events[0].diff)
            assertFalse(events[0].detailsDeferred)
            assertEquals(listOf(NativeFileChange("a.kt",7,2),NativeFileChange("b.kt",1,0)),nativeFileChanges(events))
        } finally {server.shutdown()}
    }

    @Test fun burstDoesNotLoseTheSendConfirmation()=runBlocking {
        val server=MockWebServer()
        server.enqueue(MockResponse().withWebSocketUpgrade(object:WebSocketListener(){
            override fun onOpen(webSocket:WebSocket,response:Response){
                repeat(128){webSocket.send("""{"type":"message.delta","threadId":"t","text":"$it","eventId":"burst-$it"}""")}
                webSocket.send("""{"type":"user.message","threadId":"t","text":"确认提交","requestId":"send-confirmation","eventId":"confirmed"}""")
            }
            override fun onClosing(webSocket:WebSocket,code:Int,reason:String){webSocket.close(code,reason)}
        }))
        server.start()
        try {
            val client=GatewayClient(server.url("/").toString().trimEnd('/'),"test-token")
            val events=withTimeout(6000){client.events().onEach{if(it.type=="connection.opened")delay(1000)}.take(130).toList()}
            assertEquals((0 until 128).map{it.toString()},events.filter{it.type=="message.delta"}.map{it.text})
            assertEquals("send-confirmation",events.last().requestId)
        } finally {server.shutdown()}
    }
}
