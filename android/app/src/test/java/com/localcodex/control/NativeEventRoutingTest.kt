package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeEventRoutingTest {
    @Test fun commandFloodDoesNotEnterTheNotificationQueueOrDuplicateTheChatActivity(){
        repeat(3000){
            assertFalse(nativeSocketEventRelevant("terminal.output","",true))
            assertFalse(nativeSocketEventRelevant("tool.output","",true))
            assertFalse(nativeSocketEventRelevant("terminal.output","",false))
            assertTrue(nativeSocketEventRelevant("tool.output","",false))
        }
        assertTrue(nativeSocketEventRelevant("terminal.output","workspace",false))
        assertFalse(nativeSocketEventRelevant("terminal.output","workspace",true))
    }
    @Test fun notificationLifecycleAndCrossConversationQuestionsRemainAvailable(){
        for(type in listOf("connected","thread.started","turn.started","user.message","error","approval.requested","approval.resolved","goal.completed","turn.completed")){
            assertTrue(type,nativeSocketEventRelevant(type,"",true))
            assertTrue(type,nativeSocketEventRelevant(type,"",false))
        }
        for(type in listOf("message.delta","reasoning.summary","context.compaction","tool.started","tool.completed","file.changed","diff.updated","usage.updated","thread.settings.updated")){
            assertFalse(type,nativeSocketEventRelevant(type,"",true))
            assertTrue(type,nativeSocketEventRelevant(type,"",false))
        }
    }
}
