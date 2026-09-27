package com.localcodex.control

fun chatDraftKey(activeThreadId: String, activeProjectId: String): String {
    val threadId = activeThreadId.trim()
    if (threadId.isNotBlank() && threadId != "debug") {
        return "thread:$threadId"
    }
    val projectId = activeProjectId.trim()
    if (projectId.isNotBlank()) {
        return "project:$projectId"
    }
    return "global"
}
