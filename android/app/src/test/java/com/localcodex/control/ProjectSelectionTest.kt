package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectSelectionTest {
    @Test
    fun keepsActiveProjectWhenItStillExists() {
        val projects = listOf(Project(id = "project-1", name = "App", path = "F:/Code/App", trusted = true))
        assertEquals("project-1", activeProjectIdAfterRefresh("project-1", projects))
    }

    @Test
    fun clearsActiveProjectWhenItWasRemoved() {
        val projects = listOf(Project(id = "project-2", name = "Other", path = "F:/Code/Other", trusted = true))
        assertEquals("", activeProjectIdAfterRefresh("project-1", projects))
    }

    @Test
    fun clearsActiveProjectWhenItIsNotTrusted() {
        val projects = listOf(Project(id = "project-1", name = "Ghost", path = "F:/Missing", trusted = false))
        assertEquals("", activeProjectIdAfterRefresh("project-1", projects))
    }

    @Test
    fun clearsActiveProjectWhenProjectIsNotUsable() {
        val projects = listOf(Project(id = "project-1", name = "Ghost", path = "", trusted = true))
        assertEquals("", activeProjectIdAfterRefresh("project-1", projects))
    }

    @Test
    fun workspacePathResolvesToDeepestMatchingProject() {
        val projects = listOf(
            Project(id = "root", name = "Root", path = "F:/Code", trusted = true),
            Project(id = "app", name = "App", path = "F:/Code/Codex-mobile-control", trusted = true),
        )

        assertEquals("app", projectForWorkspacePath(projects, "F:/Code/Codex-mobile-control/android/app")?.id)
    }

    @Test
    fun terminalCommandsCanBeScopedToActiveProject() {
        val projects = listOf(
            Project(id = "app", name = "App", path = "F:/Code/Codex-mobile-control", trusted = true),
            Project(id = "other", name = "Other", path = "F:/Code/Other", trusted = true),
        )
        val commands = listOf(
            TerminalCommandRecord(commandId = "1", threadId = "terminal:1", cwd = "F:/Code/Codex-mobile-control", command = "npm test"),
            TerminalCommandRecord(commandId = "2", threadId = "terminal:2", cwd = "F:/Code/Other", command = "pnpm lint"),
            TerminalCommandRecord(commandId = "3", threadId = "terminal:3", cwd = "", command = "unknown"),
        )

        val filtered = terminalCommandsForActiveProject(commands, projects, "app")

        assertEquals(listOf("1"), filtered.map { it.commandId })
    }

    @Test
    fun blankActiveProjectKeepsAllTerminalCommands() {
        val commands = listOf(
            TerminalCommandRecord(commandId = "1", threadId = "terminal:1"),
            TerminalCommandRecord(commandId = "2", threadId = "terminal:2"),
        )

        val filtered = terminalCommandsForActiveProject(commands, emptyList(), "")

        assertTrue(filtered == commands)
    }
}
