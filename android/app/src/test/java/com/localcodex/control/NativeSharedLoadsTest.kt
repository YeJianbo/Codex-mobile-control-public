package com.localcodex.control
import kotlinx.coroutines.*
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.atomic.AtomicInteger

class NativeSharedLoadsTest {
 @Test fun repeatedViewersShareWorkAndCancelingOneKeepsOtherViewer()=runBlocking {
  val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO);val loads=NativeSharedLoads<String,String>(scope)
  val started=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();val calls=AtomicInteger()
  suspend fun fetch():String{calls.incrementAndGet();started.complete(Unit);release.await();return "synthetic-image"}
  try{
   val a=async(start=CoroutineStart.UNDISPATCHED){loads.get("same",::fetch)}
   val b=async(start=CoroutineStart.UNDISPATCHED){loads.get("same",::fetch)}
   started.await();a.cancelAndJoin();assertEquals(1,calls.get());release.complete(Unit)
   assertEquals("synthetic-image",b.await())
  }finally{scope.cancel()}
 }
 @Test fun lastViewerLeavingCancelsFetchAndNextViewerCanRetry()=runBlocking {
  val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO);val loads=NativeSharedLoads<String,String>(scope)
  val started=CompletableDeferred<Unit>();val canceled=CompletableDeferred<Unit>()
  try{
   val a=async(start=CoroutineStart.UNDISPATCHED){loads.get("slow"){started.complete(Unit);try{awaitCancellation()}finally{canceled.complete(Unit)}}}
   started.await();a.cancelAndJoin();withTimeout(3000){canceled.await()}
   assertEquals("retry",loads.get("slow"){"retry"})
  }finally{scope.cancel()}
 }
 @Test fun changingGatewayInvalidatesPendingWork()=runBlocking {
  val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO);val loads=NativeSharedLoads<String,String>(scope)
  val started=CompletableDeferred<Unit>()
  try{
   val a=async(start=CoroutineStart.UNDISPATCHED){runCatching{loads.get("same"){started.complete(Unit);awaitCancellation()}}}
   started.await();loads.clear();assertTrue(a.await().exceptionOrNull() is CancellationException)
   assertEquals("new-gateway",loads.get("same"){"new-gateway"})
  }finally{scope.cancel()}
 }
}
