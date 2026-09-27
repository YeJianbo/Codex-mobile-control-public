package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiffFiltersTest {
    private val modified = DiffFileEntry(
        path = "android/app/src/main/java/MainActivity.kt",
        status = "modified",
        additions = 12,
        deletions = 3,
    )

    private val renamed = DiffFileEntry(
        path = "server/src/new-name.ts",
        oldPath = "server/src/old-name.ts",
        status = "renamed",
        additions = 1,
        deletions = 1,
    )

    @Test
    fun queryMatchesPathOldPathStatusAndStats() {
        assertTrue(diffFileMatchesQuery(modified, "MainActivity"))
        assertTrue(diffFileMatchesQuery(modified, "modified"))
        assertTrue(diffFileMatchesQuery(modified, "12"))
        assertTrue(diffFileMatchesQuery(renamed, "old-name"))
        assertFalse(diffFileMatchesQuery(modified, "README"))
    }

    @Test
    fun statusFilterMatchesSpecificOrAll() {
        assertTrue(diffFileMatchesStatus(modified, "all"))
        assertTrue(diffFileMatchesStatus(modified, "modified"))
        assertFalse(diffFileMatchesStatus(modified, "renamed"))
    }

    @Test
    fun filterCombinesQueryAndStatus() {
        val entries = listOf(modified, renamed)
        assertEquals(listOf(modified), filterDiffFiles(entries, "android", "modified"))
        assertEquals(listOf(renamed), filterDiffFiles(entries, "old-name", "renamed"))
        assertEquals(emptyList<DiffFileEntry>(), filterDiffFiles(entries, "old-name", "modified"))
    }
}
