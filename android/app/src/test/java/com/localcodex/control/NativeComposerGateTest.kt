package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeComposerGateTest {
    @Test fun diagnosticsRetainTheExistingButtonDecisionAcrossAllInputStates(){
        for(mask in 0 until 128){
            fun flag(index:Int)=mask and (1 shl index)!=0
            val connected=flag(0);val sending=flag(1);val uploading=flag(2);val stopping=flag(3)
            val input=flag(4);val stop=flag(5);val model=flag(6)
            val previous=connected&&!stopping&&(stop||!sending&&!uploading&&input&&model)
            assertEquals(previous,nativeComposerGate(connected,sending,uploading,stopping,input,stop){model}.enabled)
        }
        assertEquals(NativeComposerGate.CONNECTION,nativeComposerGate(false,false,false,false,true,false){error("Model must not be read while disconnected")})
        assertEquals(NativeComposerGate.EMPTY,nativeComposerGate(true,false,false,false,false,false){error("Model must not be read for an empty draft")})
        assertEquals(NativeComposerGate.MODEL,nativeComposerGate(true,false,false,false,true,false){false})
    }

    @Test fun runningTurnStopOutranksPendingSendAndUpload(){
        assertEquals(NativeComposerGate.STOP,nativeComposerGate(true,true,false,false,false,true){true})
        assertEquals(NativeComposerGate.STOP,nativeComposerGate(true,false,true,false,false,true){true})
        assertEquals(NativeComposerGate.STOPPING,nativeComposerGate(true,true,true,true,false,true){true})
    }
}
