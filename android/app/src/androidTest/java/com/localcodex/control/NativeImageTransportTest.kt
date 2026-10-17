package com.localcodex.control
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.TimeUnit
class NativeImageTransportTest {
 @Test fun canceledViewerDoesNotWaitForTheImageReadTimeout()=runBlocking {
  val server=MockWebServer();server.enqueue(MockResponse().setBody("synthetic bytes").setHeadersDelay(2,TimeUnit.SECONDS));server.start()
  val client=GatewayClient(server.url("/").toString().trimEnd('/'),"synthetic")
  try{
   val load=async(Dispatchers.IO){client.nativeImageBytes("/image")}
   assertNotNull(withContext(Dispatchers.IO){server.takeRequest(3,TimeUnit.SECONDS)})
   val start=System.nanoTime();load.cancelAndJoin()
   assertTrue("Cancel must return before the network read timeout",(System.nanoTime()-start)/1000000<500)
  }finally{server.shutdown()}
 }
 @Test fun unknownLengthImageCannotExceedThePreviewByteBudget()=runBlocking {
  val server=MockWebServer();server.enqueue(MockResponse().setChunkedBody("0123456789",3));server.start()
  val client=GatewayClient(server.url("/").toString().trimEnd('/'),"synthetic")
  try{assertTrue(runCatching{client.nativeImageBytes("/large",8)}.exceptionOrNull() is IllegalArgumentException)}finally{server.shutdown()}
 }
}
