package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeContentTest {
    private val realProject = Project(
        id = "real",
        name = "Codex-mobile-control",
        path = "F:/Code/Codex-mobile-control",
        trusted = true,
    )
    private val ghostProject = Project(
        id = "ghost",
        name = "Ghost",
        path = "F:/Missing/Ghost",
        trusted = false,
    )

    @Test
    fun homeShowsOnlyTrustedProjects() {
        val content = buildHomeContent(
            projects = listOf(realProject, ghostProject),
            threads = emptyList(),
            query = "",
            expandedProjectIds = emptySet(),
        )
        assertEquals(listOf(realProject), content.trustedProjects)
        assertEquals(listOf(realProject), content.projectGroups.map { it.project })
    }

    @Test
    fun homeHidesTrustedProjectsWithoutUsablePathOrName() {
        val blankPath = Project(id = "blank-path", name = "Blank", path = "", trusted = true)
        val blankName = Project(id = "blank-name", name = "", path = "F:/Code/Blank", trusted = true)
        val content = buildHomeContent(
            projects = listOf(realProject, blankPath, blankName),
            threads = emptyList(),
            query = "",
            expandedProjectIds = emptySet(),
        )
        assertEquals(listOf(realProject), content.trustedProjects)
        assertEquals(listOf(realProject), content.projectGroups.map { it.project })
    }

    @Test
    fun projectCanContainMultipleSessionsAndCollapsesByDefault() {
        val threads = (1..5).map { index ->
            ThreadRecord(
                id = "thread-$index",
                projectPath = realProject.path,
                title = "会话 $index",
            )
        }
        val content = buildHomeContent(
            projects = listOf(realProject),
            threads = threads,
            query = "",
            expandedProjectIds = emptySet(),
        )
        val group = content.projectGroups.single()
        assertEquals(5, group.threads.size)
        assertEquals(3, group.shownThreads.size)
        assertFalse(group.expanded)
    }

    @Test
    fun expandedProjectShowsAllSessions() {
        val threads = (1..5).map { index ->
            ThreadRecord(id = "thread-$index", projectPath = realProject.path, title = "会话 $index")
        }
        val content = buildHomeContent(
            projects = listOf(realProject),
            threads = threads,
            query = "",
            expandedProjectIds = setOf(realProject.id),
        )
        val group = content.projectGroups.single()
        assertEquals(5, group.shownThreads.size)
        assertTrue(group.expanded)
    }

    @Test
    fun orphanThreadsAreVisibleAndSearchable() {
        val orphan = ThreadRecord(id = "orphan", projectPath = "F:/Other", title = "历史会话")
        val defaultContent = buildHomeContent(
            projects = listOf(realProject),
            threads = listOf(orphan),
            query = "",
            expandedProjectIds = emptySet(),
        )
        assertEquals(listOf(orphan), defaultContent.orphanThreads)

        val searchContent = buildHomeContent(
            projects = listOf(realProject),
            threads = listOf(orphan),
            query = "历史",
            expandedProjectIds = emptySet(),
        )
        assertEquals(listOf(orphan), searchContent.orphanThreads)
    }

    @Test
    fun searchExpandsMatchedProjectSessions() {
        val threads = listOf(
            ThreadRecord(id = "thread-1", projectPath = realProject.path, title = "终端体验"),
            ThreadRecord(id = "thread-2", projectPath = realProject.path, title = "文件预览"),
        )
        val content = buildHomeContent(
            projects = listOf(realProject),
            threads = threads,
            query = "终端",
            expandedProjectIds = emptySet(),
        )
        val group = content.projectGroups.single()
        assertTrue(group.expanded)
        assertEquals(listOf("thread-1"), group.shownThreads.map { it.id })
    }
}
