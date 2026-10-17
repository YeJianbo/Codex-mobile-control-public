package com.localcodex.control

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test

class NativeMathExecutorTest {
    @Test fun formulaTasksUseAtMostTwoWorkersAndQueuedTasksComplete() {
        val executor=createNativeMathExecutor()
        val started=CountDownLatch(2)
        val release=CountDownLatch(1)
        val completed=CountDownLatch(8)
        val active=AtomicInteger()
        val maximum=AtomicInteger()
        try {
            repeat(8){executor.execute {
                val count=active.incrementAndGet()
                maximum.updateAndGet{maxOf(it,count)}
                started.countDown()
                try { release.await() } finally { active.decrementAndGet();completed.countDown() }
            }}
            assertTrue(started.await(2,TimeUnit.SECONDS))
            assertEquals(2,active.get())
            assertEquals(6,executor.queue.size)
            release.countDown()
            assertTrue(completed.await(2,TimeUnit.SECONDS))
            assertEquals(2,maximum.get())
        } finally { release.countDown();executor.shutdownNow();executor.awaitTermination(2,TimeUnit.SECONDS) }
    }
}
