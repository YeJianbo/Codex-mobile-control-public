package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FileFiltersTest {
    private val directory = FileEntry(
        name = "app",
        path = "android/app",
        kind = "directory",
    )

    private val kotlinFile = FileEntry(
        name = "MainActivity.kt",
        path = "android/app/src/main/java/com/localcodex/control/MainActivity.kt",
        kind = "file",
    )

    @Test
    fun queryMatchesFileNamePathAndKind() {
        assertTrue(fileEntryMatchesQuery(kotlinFile, "MainActivity"))
        assertTrue(fileEntryMatchesQuery(kotlinFile, "localcodex"))
        assertTrue(fileEntryMatchesQuery(kotlinFile, "file"))
        assertFalse(fileEntryMatchesQuery(kotlinFile, "server"))
    }

    @Test
    fun kindFilterMatchesAllDirectoryAndFile() {
        assertTrue(fileEntryMatchesKind(directory, "all"))
        assertTrue(fileEntryMatchesKind(directory, "directory"))
        assertFalse(fileEntryMatchesKind(directory, "file"))
    }

    @Test
    fun filterCombinesQueryAndKind() {
        val entries = listOf(directory, kotlinFile)
        assertEquals(listOf(directory), filterFileEntries(entries, "android", "directory"))
        assertEquals(listOf(kotlinFile), filterFileEntries(entries, "activity", "file"))
        assertEquals(emptyList<FileEntry>(), filterFileEntries(entries, "activity", "directory"))
    }
}
