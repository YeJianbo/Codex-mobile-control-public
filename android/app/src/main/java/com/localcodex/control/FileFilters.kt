package com.localcodex.control

fun fileEntryMatchesQuery(entry: FileEntry, query: String): Boolean {
    val normalized = query.trim().lowercase()
    if (normalized.isBlank()) {
        return true
    }
    return entry.name.lowercase().contains(normalized) ||
        entry.path.lowercase().contains(normalized) ||
        entry.kind.lowercase().contains(normalized)
}

fun fileEntryMatchesKind(entry: FileEntry, kind: String): Boolean {
    return kind.isBlank() || kind == "all" || entry.kind == kind
}

fun filterFileEntries(entries: List<FileEntry>, query: String, kind: String): List<FileEntry> {
    return entries.filter { entry ->
        fileEntryMatchesKind(entry, kind) && fileEntryMatchesQuery(entry, query)
    }
}
