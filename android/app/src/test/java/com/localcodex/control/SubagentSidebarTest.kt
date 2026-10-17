package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class SubagentSidebarTest {
    private val parent=ThreadRecord("main",title="研究任务")
    private val child=ThreadRecord("child",title="review",subagent=NativeSubagent("main","Sol","sol","review"))
    private val nested=ThreadRecord("nested",subagent=NativeSubagent("child","Terra"))
    @Test fun inactiveAgentsHaveTheirOwnSearchableSidebarSection(){
        assertEquals(listOf(parent),sidebarThreadRoots(listOf(nested,child,parent)))
        assertTrue(sidebarThreadRoots(listOf(nested,child,parent),"Terra").isEmpty())
        assertTrue(sidebarThreadRoots(listOf(child,parent),"review").isEmpty())
        assertEquals("子代理 · Sol",subagentLabel(child))
        assertEquals(listOf(nested,child),sidebarInactiveAgents(listOf(nested,child,parent)))
        assertEquals(listOf(nested),sidebarInactiveAgents(listOf(nested,child,parent),"Terra"))
        assertEquals(listOf(nested,child),sidebarInactiveAgents(listOf(nested,child,parent),"review"))
        assertTrue(sidebarInactiveAgents(listOf(child.copy(status="running"),nested.copy(status="starting"))).isEmpty())
        assertTrue(sidebarInactiveAgents(listOf(child.copy(goal=NativeGoal(objective="task",status="active")))).isEmpty())
    }
    @Test fun missingParentKeepsAnAgentAccessibleAndReturnAvailable(){
        assertEquals(listOf(child),sidebarInactiveAgents(listOf(child)))
        assertEquals("main",conversationParent(listOf(child),"child")?.id)
    }
    @Test fun returnsToTheImmediateParentAndRetainsItsLineage(){
        val rows=listOf(nested,child,parent)
        assertEquals(child,conversationParent(rows,"nested"))
        assertEquals(parent,conversationParent(rows,"child"))
        assertNull(conversationParent(rows,"main"))
        assertEquals(rows,conversationLineage(rows,"nested"))
        assertTrue(sidebarInactiveAgents(rows,filter=NativeThreadFilter.RUNNING).isEmpty())
        assertTrue(sidebarInactiveAgents(rows,filter=NativeThreadFilter.UNREAD).isEmpty())
    }
    @Test fun runningDescendantsKeepTheirParentInProgress(){
        assertTrue(threadFamilyRunning(parent,mapOf("main" to listOf(child),"child" to listOf(nested.copy(status="running")))))
        assertFalse(threadFamilyRunning(parent,mapOf("main" to listOf(child),"child" to listOf(nested))))
    }
    @Test fun runningNestedAgentsRemainReachableAfterTheirParentStops(){
        val running=nested.copy(status="running")
        val unrelated=ThreadRecord("other",status="running",subagent=NativeSubagent("another"))
        assertEquals(listOf(running),conversationRunningAgents(listOf(running,child,parent,unrelated),"main"))
        assertEquals(listOf(running),conversationRunningAgents(listOf(running,child,parent),"child"))
        assertTrue(conversationRunningAgents(listOf(running,child,parent),"nested").isEmpty())
        assertTrue(conversationRunningAgents(listOf(nested,child,parent),"main").isEmpty())
    }
    @Test fun cyclicAgentMetadataRemainsHidden(){
        val a=ThreadRecord("a",subagent=NativeSubagent("b"));val b=ThreadRecord("b",subagent=NativeSubagent("a"))
        assertTrue(sidebarThreadRoots(listOf(b,a)).isEmpty())
        assertEquals(listOf(a,b),conversationLineage(listOf(b,a),"a"))
        assertEquals(listOf(b.copy(status="starting")),conversationRunningAgents(listOf(a,b.copy(status="starting")),"a"))
    }
}
