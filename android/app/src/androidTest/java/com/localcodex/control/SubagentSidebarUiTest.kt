package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.*

class SubagentSidebarUiTest {
    @Test fun toolbarOnlyShowsRunningChildren(){
        var selected=mutableStateOf("main")
        ui.setContent{MaterialTheme{NativeConversationAgents(listOf(main,child,nested),selected.value,{selected.value=it.id})}}
        ui.onNodeWithTag("conversationAgents").assertIsDisplayed()
        ui.onNodeWithTag("conversationAgent:child").assertDoesNotExist()
        ui.onNodeWithTag("conversationAgentsToggle").performClick()
        ui.onNodeWithTag("conversationAgent:child").performClick()
        ui.onNodeWithTag("conversationAgents").assertDoesNotExist()
        Assert.assertEquals(main,conversationParent(listOf(main,child,nested),selected.value))
    }
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private val main=ThreadRecord("main",title="研究任务")
    private val child=ThreadRecord("child",status="running",subagent=NativeSubagent("main","Sol","sol"))
    private val nested=ThreadRecord("nested",subagent=NativeSubagent("child","Terra"))
    @Test fun sidebarHasInactiveAgentsWithOpenAndCloseActions(){
        val rows=listOf(main,child,nested,ThreadRecord("orphan",subagent=NativeSubagent("missing")))
        var opened="";var closed=""
        ui.setContent{MaterialTheme{androidx.compose.foundation.layout.Column{
            sidebarThreadRoots(rows).forEach{NativeSidebarThread(it,"",{}, {}, {})}
            sidebarInactiveAgents(rows).forEach{thread->NativeSidebarAgent(thread,rows.find{it.id==thread.subagent?.parentThreadId},{opened=thread.id},{closed=thread.id})}
        }}}
        ui.onNodeWithTag("threadRow:main").assertIsDisplayed()
        ui.onNodeWithTag("threadRow:child").assertDoesNotExist()
        ui.onNodeWithTag("sidebarAgent:nested").assertIsDisplayed().performClick()
        Assert.assertEquals("nested",opened)
        ui.onNodeWithTag("closeSidebarAgent:orphan").assertIsDisplayed().performClick()
        Assert.assertEquals("orphan",closed)
        Assert.assertEquals(listOf(nested),sidebarInactiveAgents(rows,"Terra"))
    }
}
