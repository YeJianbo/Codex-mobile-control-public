package com.localcodex.control

fun isConversationEventForThread(event: ChatEvent, activeThreadId: String): Boolean {
    if (activeThreadId.isBlank() || activeThreadId == "debug") {
        return event.threadId == activeThreadId && (event.type == "message.delta" || event.type == "user.message")
    }
    if (event.threadId != activeThreadId) {
        return false
    }
    return when (event.type) {
        "user.message",
        "message.delta",
        "approval.requested",
        "file.changed",
        "diff.updated",
        "warning" -> true
        else -> false
    }
}

fun isThreadTimelineEvent(event: ChatEvent): Boolean {
    return when (event.type) {
        "thread.started",
        "user.message",
        "message.delta",
        "approval.requested",
        "file.changed",
        "diff.updated",
        "warning",
        "turn.completed" -> true
        else -> false
    }
}

fun isStateEventWorthKeeping(event: ChatEvent): Boolean {
    if (event.type == "terminal.output") {
        return event.threadId.startsWith("terminal:")
    }
    return isThreadTimelineEvent(event)
}

fun sanitizedThreadEvents(events: List<ChatEvent>, threadId: String): List<ChatEvent> {
    return events.filter { event ->
        event.threadId == threadId && isThreadTimelineEvent(event)
    }
}

fun shouldActivateConversationThread(event: ChatEvent): Boolean {
    if (event.threadId.isBlank() || event.threadId == "unknown" || event.threadId.startsWith("terminal:")) {
        return false
    }
    return event.type != "warning" && isThreadTimelineEvent(event)
}

fun shouldRefreshThreadsForEvent(event: ChatEvent): Boolean {
    return event.type == "thread.started" ||
        event.type == "user.message" ||
        event.type == "turn.completed" ||
        event.type == "file.changed" ||
        event.type == "diff.updated"
}

fun nextActiveConversationThreadId(
    currentThreadId: String,
    pendingConversationStart: Boolean,
    event: ChatEvent,
): String {
    if (!shouldActivateConversationThread(event)) {
        return currentThreadId
    }
    val current = currentThreadId.trim()
    if (current.isBlank() || current == "debug") {
        return event.threadId
    }
    if (event.threadId == current) {
        return current
    }
    return if (event.type == "thread.started" && pendingConversationStart) {
        event.threadId
    } else {
        current
    }
}

fun shouldStartNewThreadForPrompt(activeThreadId: String, activeThreadExists: Boolean): Boolean {
    return activeThreadId.isBlank() || activeThreadId == "debug" || !activeThreadExists
}

fun canSubmitChatDraft(connected: Boolean, draft: String, pendingConversationStart: Boolean, turnRunning: Boolean): Boolean {
    return connected && draft.isNotBlank() && !pendingConversationStart && !turnRunning
}

fun canRunQuickChatAction(connected: Boolean, pendingConversationStart: Boolean, turnRunning: Boolean, text: String): Boolean {
    return connected && !pendingConversationStart && !turnRunning && text.isNotBlank()
}

fun canStartEmptyThread(connected: Boolean, pendingConversationStart: Boolean, turnRunning: Boolean, project: Project?): Boolean {
    return connected && !pendingConversationStart && !turnRunning && project != null && project.trusted
}

fun shouldDeduplicateEvent(event: ChatEvent): Boolean {
    return event.type !in setOf("message.delta", "terminal.output", "tool.output")
}

fun pendingOutgoingUserMessage(threadId: String, text: String): ChatEvent {
    return ChatEvent(
        type = "user.message",
        threadId = threadId,
        text = text,
        status = "pending",
        itemId = "local-pending-${text.hashCode()}",
    )
}

fun isPendingOutgoingUserMessage(event: ChatEvent): Boolean {
    return event.type == "user.message" && event.status == "pending" && event.itemId.startsWith("local-pending-")
}

fun removeConfirmedPendingOutgoingUserMessages(events: List<ChatEvent>, confirmed: ChatEvent): List<ChatEvent> {
    if (confirmed.type != "user.message" || confirmed.text.isBlank()) {
        return events
    }
    return events.filterNot { event ->
        isPendingOutgoingUserMessage(event) &&
            event.text == confirmed.text &&
            (event.threadId == confirmed.threadId || event.threadId.isBlank())
    }
}

fun removePendingOutgoingUserMessages(events: List<ChatEvent>, threadId: String): List<ChatEvent> {
    return events.filterNot { event ->
        isPendingOutgoingUserMessage(event) && (event.threadId == threadId || event.threadId.isBlank())
    }
}

fun movePendingOutgoingUserMessagesToThread(events: List<ChatEvent>, threadId: String): List<ChatEvent> {
    if (threadId.isBlank()) {
        return events
    }
    return events.map { event ->
        if (isPendingOutgoingUserMessage(event) && event.threadId.isBlank()) {
            event.copy(threadId = threadId)
        } else {
            event
        }
    }
}

fun pendingOutgoingUserMessagesForRefresh(existingEvents: List<ChatEvent>, threadId: String, refreshedEvents: List<ChatEvent>): List<ChatEvent> {
    if (threadId.isBlank()) {
        return emptyList()
    }
    val confirmedTexts = refreshedEvents
        .filter { it.type == "user.message" && it.threadId == threadId && it.text.isNotBlank() }
        .map { it.text }
        .toSet()
    return existingEvents.filter { event ->
        isPendingOutgoingUserMessage(event) &&
            event.threadId == threadId &&
            event.text !in confirmedTexts
    }
}

fun threadRecordFromStartedEvent(event: ChatEvent, existing: ThreadRecord?): ThreadRecord {
    return ThreadRecord(
        id = event.threadId,
        projectPath = event.projectPath.ifBlank { existing?.projectPath.orEmpty() },
        title = event.title.ifBlank { existing?.title ?: "新对话" },
        status = event.status.ifBlank { existing?.status ?: "idle" },
        updatedAt = event.updatedAt.ifBlank { existing?.updatedAt.orEmpty() },
    )
}

fun modelChoices(current: String, rawConfigContent: String = ""): List<String> {
    return (listOf(current.trim()) + modelsFromRawConfig(rawConfigContent))
        .filter { it.isNotBlank() }
        .distinct()
}

fun providerChoices(current: String, rawConfigContent: String = ""): List<String> {
    return (listOf(current.trim()) + providersFromRawConfig(rawConfigContent))
        .filter { it.isNotBlank() }
        .distinct()
}

fun modelsFromRawConfig(rawConfigContent: String): List<String> {
    val pattern = Regex("""(?m)^\s*model\s*=\s*["']([^"']+)["']""")
    return pattern.findAll(rawConfigContent)
        .map { it.groupValues[1].trim() }
        .filter { it.isNotBlank() }
        .distinct()
        .toList()
}

fun providersFromRawConfig(rawConfigContent: String): List<String> {
    val pattern = Regex("""(?m)^\s*\[model_providers\.([^\]\s]+)]\s*$""")
    return pattern.findAll(rawConfigContent)
        .map { it.groupValues[1].trim() }
        .filter { it.isNotBlank() }
        .distinct()
        .toList()
}
