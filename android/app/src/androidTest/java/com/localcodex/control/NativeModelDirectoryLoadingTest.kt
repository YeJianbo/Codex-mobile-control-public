package com.localcodex.control

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(AndroidJUnit4::class)
class NativeModelDirectoryLoadingTest {
    @Test fun emptyCompletedDirectoryCannotReplaceTheLastUsableSelection() = runBlocking {
        val server=MockWebServer()
        server.enqueue(MockResponse().setHeader("Content-Type","application/json").setBody("""{"models":[],"pending":[]}"""))
        server.start()
        try{
            val client=GatewayClient(server.url("/").toString().trimEnd('/'),"fixture")
            val failure=runCatching{client.nativeModelUpdates{_,_->fail("Empty terminal response must not replace picker state")}}.exceptionOrNull()
            assertTrue(failure is IllegalStateException)
            assertTrue(failure?.message.orEmpty().contains("电脑没有返回可选模型"))
        }finally{server.shutdown()}
    }

    @Test fun completedSourcesRenderBeforePendingSourcesAndRefreshOnlyOnce() = runBlocking {
        val reads=CopyOnWriteArrayList<String>()
        val observed=mutableListOf<Pair<List<String>,Set<String>>>()
        val server=MockWebServer()
        server.dispatcher=object:Dispatcher(){
            override fun dispatch(request:RecordedRequest):MockResponse {
                reads.add(request.path.orEmpty())
                val first=reads.size==1
                val extra=if(first)"" else """,{"model":"antigravity::gemini-4-flash","displayName":"Gemini 4 Flash","supportedReasoningEfforts":[]}"""
                val pending=if(first)"\"antigravity\"" else ""
                return MockResponse().setHeader("Content-Type","application/json").setBody("""{"models":[{"model":"gpt-6.1-sol","displayName":"Sol","supportedReasoningEfforts":[]}$extra],"pending":[$pending]}""")
            }
        }
        server.start()
        try{
            val client=GatewayClient(server.url("/").toString().trimEnd('/'),"fixture")
            val final=client.nativeModelUpdates(refresh=true){models,pending->observed.add(models.map{it.id} to pending)}
            assertEquals(2,reads.size)
            assertTrue(reads.first().contains("partial=1")&&reads.first().contains("refresh=1"))
            assertFalse(reads.last().contains("refresh=1"))
            assertEquals(listOf("gpt-6.1-sol"),observed.first().first)
            assertEquals(setOf("antigravity"),observed.first().second)
            assertEquals(emptySet<String>(),observed.last().second)
            assertEquals(2,final.size)
            assertEquals(final,client.nativeModelsAsync())
            assertEquals(2,reads.size)
        }finally{server.shutdown()}
    }
}
