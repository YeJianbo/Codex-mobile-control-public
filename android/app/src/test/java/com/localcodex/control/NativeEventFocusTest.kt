package com.localcodex.control

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class NativeEventFocusTest {
    @Test fun historyWaitsForTheMatchingAcknowledgementAndSharesOneSubscription()=runBlocking{
        val focus=NativeEventFocus();val socket=Any();val requests=mutableListOf<String>()
        repeat(3){focus.request(socket,"A"){requests.add(it);true}}
        assertEquals(1,requests.size)
        var fetched=false
        val history=async(start=CoroutineStart.UNDISPATCHED){assertTrue(focus.await(socket,"A",3000));fetched=true}
        assertFalse(fetched);assertFalse(focus.acknowledge(socket,"old","A"));assertFalse(focus.acknowledge(socket,requests[0],"B"))
        assertTrue(focus.acknowledge(socket,requests[0],"A"));history.await();assertTrue(fetched)
    }
    @Test fun returningToTheSameThreadCannotLetAnOldWaiterCancelTheNewSubscription()=runBlocking{
        val focus=NativeEventFocus();val socket=Any();val requests=mutableListOf<String>();var failures=0
        focus.request(socket,"A"){requests.add(it);true}
        val old=async(start=CoroutineStart.UNDISPATCHED){runCatching{focus.await(socket,"A",3000){failures++}}}
        focus.request(socket,"B"){requests.add(it);true};focus.request(socket,"A"){requests.add(it);true}
        assertTrue(old.await().exceptionOrNull() is CancellationException)
        assertFalse(focus.acknowledge(socket,requests[0],"A"));assertEquals(0,failures)
        assertTrue(focus.acknowledge(socket,requests[2],"A"));assertTrue(focus.await(socket,"A",3000){failures++})
        assertEquals(0,failures)
    }
    @Test fun oldSocketCleanupIsIsolatedAndOnlyCurrentFailuresTriggerReconnect()=runBlocking{
        val focus=NativeEventFocus();val old=Any();val next=Any();var id="";var failures=0
        focus.request(old,"A"){true}
        focus.request(next,"A"){id=it;true};focus.close(old)
        assertTrue(focus.acknowledge(next,id,"A"));assertTrue(focus.await(next,"A",3000){failures++})
        focus.request(next,"B"){false};assertFalse(focus.await(next,"B",3000){failures++});assertEquals(1,failures)
        focus.request(next,"C"){true};assertFalse(focus.await(next,"C",10){failures++});assertEquals(2,failures)
    }
}
