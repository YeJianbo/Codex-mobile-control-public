package com.localcodex.control

fun diffFileMatchesQuery(entry: DiffFileEntry, query: String): Boolean {
    val normalized = query.trim().lowercase()
    if (normalized.isBlank()) {
        return true
    }
    return entry.path.lowercase().contains(normalized) ||
        entry.oldPath.lowercase().contains(normalized) ||
        entry.status.lowercase().contains(normalized) ||
        entry.additions.toString().contains(normalized) ||
        entry.deletions.toString().contains(normalized)
}

fun diffFileMatchesStatus(entry: DiffFileEntry, status: String): Boolean {
    return status.isBlank() || status == "all" || entry.status == status
}

fun filterDiffFiles(entries: List<DiffFileEntry>, query: String, status: String): List<DiffFileEntry> {
    return entries.filter { entry ->
        diffFileMatchesStatus(entry, status) && diffFileMatchesQuery(entry, query)
    }
}
