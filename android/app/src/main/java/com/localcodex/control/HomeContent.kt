package com.localcodex.control

data class HomeProjectGroup(
    val project: Project,
    val threads: List<ThreadRecord>,
    val shownThreads: List<ThreadRecord>,
    val expanded: Boolean,
)

data class HomeContent(
    val trustedProjects: List<Project>,
    val projectGroups: List<HomeProjectGroup>,
    val orphanThreads: List<ThreadRecord>,
    val query: String,
)

fun buildHomeContent(
    projects: List<Project>,
    threads: List<ThreadRecord>,
    query: String,
    expandedProjectIds: Set<String>,
    collapsedThreadLimit: Int = 3,
): HomeContent {
    val trustedProjects = projects.filter(::isUsableHomeProject)
    val projectPaths = trustedProjects.map { it.path }.toSet()
    val normalizedQuery = query.trim().lowercase()
    val visibleProjects = trustedProjects.filter { project ->
        normalizedQuery.isBlank() ||
            project.name.lowercase().contains(normalizedQuery) ||
            project.path.lowercase().contains(normalizedQuery) ||
            threads.any { thread -> thread.projectPath == project.path && threadMatchesQuery(thread, trustedProjects, normalizedQuery) }
    }
    val groups = visibleProjects.map { project ->
        val projectThreads = threads
            .filter { it.projectPath == project.path }
            .filter {
                normalizedQuery.isBlank() ||
                    threadMatchesQuery(it, trustedProjects, normalizedQuery) ||
                    project.name.lowercase().contains(normalizedQuery) ||
                    project.path.lowercase().contains(normalizedQuery)
            }
        val expanded = expandedProjectIds.contains(project.id) || normalizedQuery.isNotBlank()
        HomeProjectGroup(
            project = project,
            threads = projectThreads,
            shownThreads = if (expanded) projectThreads else projectThreads.take(collapsedThreadLimit),
            expanded = expanded,
        )
    }
    val orphanThreads = threads
        .filter { it.projectPath.isBlank() || it.projectPath !in projectPaths }
        .filter { normalizedQuery.isBlank() || threadMatchesQuery(it, trustedProjects, normalizedQuery) }
    return HomeContent(
        trustedProjects = trustedProjects,
        projectGroups = groups,
        orphanThreads = orphanThreads,
        query = normalizedQuery,
    )
}

fun isUsableHomeProject(project: Project): Boolean {
    return project.trusted && project.path.trim().isNotBlank() && project.name.trim().isNotBlank()
}
