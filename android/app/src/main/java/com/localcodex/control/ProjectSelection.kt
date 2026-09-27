package com.localcodex.control

fun activeProjectIdAfterRefresh(currentProjectId: String, projects: List<Project>): String {
    return if (projects.any { it.id == currentProjectId && isUsableHomeProject(it) }) currentProjectId else ""
}

fun projectForWorkspacePath(projects: List<Project>, workspacePath: String): Project? {
    val normalizedWorkspacePath = normalizeComparableProjectPath(workspacePath)
    if (normalizedWorkspacePath.isBlank()) {
        return null
    }
    return projects
        .filter(::isUsableHomeProject)
        .filter { project ->
            val normalizedProjectPath = normalizeComparableProjectPath(project.path)
            normalizedWorkspacePath == normalizedProjectPath ||
                normalizedWorkspacePath.startsWith("$normalizedProjectPath/")
        }
        .maxByOrNull { normalizeComparableProjectPath(it.path).length }
}

fun terminalCommandsForActiveProject(
    commands: List<TerminalCommandRecord>,
    projects: List<Project>,
    activeProjectId: String,
): List<TerminalCommandRecord> {
    if (activeProjectId.isBlank()) {
        return commands
    }
    return commands.filter { record ->
        projectForWorkspacePath(projects, record.cwd)?.id == activeProjectId
    }
}

private fun normalizeComparableProjectPath(path: String): String {
    return path.trim()
        .replace('\\', '/')
        .trimEnd('/')
        .lowercase()
}
