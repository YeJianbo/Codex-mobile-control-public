package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ThreadFiltersTest {
    private val project = Project(
        id = "project-1",
        name = "Codex-mobile-control",
        path = "F:\\Code\\Codex-mobile-control",
        trusted = true,
    )

    private val thread = ThreadRecord(
        id = "thread-1",
        projectPath = project.path,
        title = "修复终端体验",
        status = "completed",
        updatedAt = "2026-06-14T10:10:00.000Z",
    )

    @Test
    fun threadProjectLabelUsesKnownProjectName() {
        assertEquals("Codex-mobile-control · F:\\Code\\Codex-mobile-control", threadProjectLabel(thread, listOf(project)))
    }

    @Test
    fun threadProjectLabelFallsBackToUnbound() {
        assertEquals("未绑定项目", threadProjectLabel(ThreadRecord(id = "orphan"), emptyList()))
    }

    @Test
    fun threadQueryMatchesTitleAndProjectName() {
        assertTrue(threadMatchesQuery(thread, listOf(project), "终端"))
        assertTrue(threadMatchesQuery(thread, listOf(project), "mobile"))
        assertFalse(threadMatchesQuery(thread, listOf(project), "不存在"))
    }

    @Test
    fun threadsForProjectOnlyReturnsCurrentProjectThreads() {
        val otherProject = Project(
            id = "project-2",
            name = "Other",
            path = "F:\\Code\\Other",
            trusted = true,
        )
        val otherThread = ThreadRecord(
            id = "thread-2",
            projectPath = otherProject.path,
            title = "其他项目会话",
        )

        assertEquals(listOf(thread), threadsForProject(listOf(thread, otherThread), project))
        assertTrue(threadsForProject(listOf(thread, otherThread), null).isEmpty())
    }
}
