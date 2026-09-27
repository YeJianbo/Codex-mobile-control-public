package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Test

class ChatDraftsTest {
    @Test
    fun threadDraftKeyWinsOverProject() {
        assertEquals("thread:thread-1", chatDraftKey("thread-1", "project-1"))
    }

    @Test
    fun debugThreadUsesProjectDraft() {
        assertEquals("project:project-1", chatDraftKey("debug", "project-1"))
    }

    @Test
    fun blankThreadUsesProjectDraft() {
        assertEquals("project:project-1", chatDraftKey("", "project-1"))
    }

    @Test
    fun blankContextUsesGlobalDraft() {
        assertEquals("global", chatDraftKey("", ""))
    }
}
