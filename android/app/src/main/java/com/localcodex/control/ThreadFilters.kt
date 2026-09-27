package com.localcodex.control

fun threadProjectLabel(thread: ThreadRecord, projects: List<Project>): String {
    val project = projects.firstOrNull { it.path == thread.projectPath }
    return when {
        project != null -> "${project.name} · ${project.path}"
        thread.projectPath.isNotBlank() -> thread.projectPath
        else -> "未绑定项目"
    }
}

fun threadMatchesQuery(thread: ThreadRecord, projects: List<Project>, query: String): Boolean {
    val normalized = query.trim().lowercase()
    if (normalized.isBlank()) {
        return true
    }
    return thread.title.lowercase().contains(normalized) ||
        thread.id.lowercase().contains(normalized) ||
        thread.status.lowercase().contains(normalized) ||
        thread.updatedAt.lowercase().contains(normalized) ||
        thread.projectPath.lowercase().contains(normalized) ||
        threadProjectLabel(thread, projects).lowercase().contains(normalized)
}

fun threadsForProject(threads: List<ThreadRecord>, project: Project?): List<ThreadRecord> {
    if (project == null) {
        return emptyList()
    }
    return threads.filter { it.projectPath == project.path }
}
