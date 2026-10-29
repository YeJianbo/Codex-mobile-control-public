package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativePerformanceSessionTest {
    @Test fun composerRecordsOnlyTransitionsAndSeparatesForegroundCycles(){
        var now=0L;val session=NativePerformanceSession{now};session.start();session.resume()
        session.composer(NativeComposerGate.CONNECTION)
        repeat(1000){session.composer(NativeComposerGate.CONNECTION)}
        now=120;session.composer(NativeComposerGate.MODEL)
        now=150;session.composer(NativeComposerGate.READY)
        now=200;session.resume();session.composer(NativeComposerGate.READY)
        val report=session.finish()!!
        assertEquals(4,report.composer.size)
        assertEquals(listOf(0L,120L,150L,200L),report.composer.map{it.atMs})
        assertEquals(listOf(1,1,1,2),report.composer.map{it.cycle})
        assertEquals(2,report.marks.count{it.stage==NativePerformanceStage.SEND_READY})
    }
    @Test fun frameSamplesAreBoundedAndSelectionStagesAreOncePerResume(){
        var now=0L;val session=NativePerformanceSession{now};val owner=session.start()
        session.resume();session.mark(NativePerformanceStage.SEND_READY);session.mark(NativePerformanceStage.SEND_READY)
        repeat(8193){session.frame(owner,20_000_000,16_666_666,0)}
        session.frame(owner,10_000_000,16_666_666,0,dialog=true)
        now=100;session.resume();session.mark(NativePerformanceStage.SEND_READY)
        val report=session.finish()!!
        assertEquals(8194L,report.frames);assertEquals(8192,report.retainedFrameSamples)
        assertEquals(1L,report.dialogFrames)
        assertEquals(8193L,report.overBudgetFrames);assertEquals(20.0,report.p95Ms,.001)
        assertEquals(2,report.marks.count{it.stage==NativePerformanceStage.SEND_READY})
        assertFalse(session.active)
    }
    @Test fun oldNetworkCallbacksCannotEnterANewCapture(){
        var now=100L;val session=NativePerformanceSession{now};val old=session.start()
        val ticket=session.beginNetwork(NativeNetworkOperation.HEALTH,NativePerformanceRoute.PUBLIC)!!
        session.finish();session.start()
        session.frame(old,100_000_000,10_000_000,0)
        session.endNetwork(ticket,2,3,4,5,200,null)
        val current=session.beginNetwork(NativeNetworkOperation.MODELS,NativePerformanceRoute.LOCAL)!!
        now=125;session.endNetwork(current,0,0,0,10,200,null)
        val report=session.finish()!!
        assertEquals(0L,report.frames);assertEquals(1,report.network.size)
        assertEquals(25L,report.network.single().durationMs)
    }
    @Test fun sleepingOrDelayedStopCannotCollectPastSixtySeconds(){
        var now=0L;val session=NativePerformanceSession{now};val owner=session.start()
        now=60001;session.frame(owner,20_000_000,16_666_666,0)
        session.mark(NativePerformanceStage.SEND_READY)
        assertNull(session.beginNetwork(NativeNetworkOperation.HEALTH,NativePerformanceRoute.LOCAL))
        val report=session.finish()!!
        assertEquals(60000L,report.elapsedMs);assertEquals(0L,report.frames);assertTrue(report.marks.isEmpty())
    }
}
