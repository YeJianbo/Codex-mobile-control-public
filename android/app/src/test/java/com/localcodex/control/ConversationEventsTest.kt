package com.localcodex.control

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationEventsTest {
    @Test
    fun currentThreadMessageIsVisibleInConversation() {
        val event = ChatEvent(type = "message.delta", threadId = "thread-1", text = "hello")
        assertTrue(isConversationEventForThread(event, "thread-1"))
    }

    @Test
    fun currentThreadUserMessageIsVisibleAndActivatesConversation() {
        val event = ChatEvent(type = "user.message", threadId = "thread-1", text = "do it")
        assertTrue(isConversationEventForThread(event, "thread-1"))
        assertTrue(shouldActivateConversationThread(event))
    }

    @Test
    fun terminalOutputIsNotVisibleInConversationAndDoesNotActivateThread() {
        val event = ChatEvent(type = "terminal.output", threadId = "terminal:abc", text = "npm test")
        assertFalse(isConversationEventForThread(event, "thread-1"))
        assertFalse(shouldActivateConversationThread(event))
    }

    @Test
    fun connectedAndCodexStatusDoNotActivateConversationThread() {
        assertFalse(shouldActivateConversationThread(ChatEvent(type = "connected", threadId = "")))
        assertFalse(shouldActivateConversationThread(ChatEvent(type = "codex.status", threadId = "unknown")))
    }

    @Test
    fun otherThreadOutputIsHiddenFromCurrentConversation() {
        val event = ChatEvent(type = "message.delta", threadId = "thread-2", text = "other")
        assertFalse(isConversationEventForThread(event, "thread-1"))
    }

    @Test
    fun codexThreadEventsCanActivateConversation() {
        assertTrue(shouldActivateConversationThread(ChatEvent(type = "thread.started", threadId = "thread-1")))
        assertTrue(shouldActivateConversationThread(ChatEvent(type = "turn.completed", threadId = "thread-1")))
    }

    @Test
    fun lifecycleEventsDoNotRenderAsConversationNoise() {
        assertFalse(isConversationEventForThread(ChatEvent(type = "turn.completed", threadId = "thread-1", status = "completed"), "thread-1"))
        assertFalse(isConversationEventForThread(ChatEvent(type = "approval.resolved", threadId = "thread-1", status = "accept"), "thread-1"))
    }

    @Test
    fun toolRawOutputDoesNotRenderAsConversationNoise() {
        assertFalse(isConversationEventForThread(ChatEvent(type = "tool.started", threadId = "thread-1", title = "exec"), "thread-1"))
        assertFalse(isConversationEventForThread(ChatEvent(type = "tool.output", threadId = "thread-1", text = "raw logs"), "thread-1"))
        assertFalse(isConversationEventForThread(ChatEvent(type = "tool.completed", threadId = "thread-1", status = "ok"), "thread-1"))
        assertFalse(shouldActivateConversationThread(ChatEvent(type = "tool.output", threadId = "thread-1", text = "raw logs")))
    }

    @Test
    fun rawToolAndCodexCommandOutputAreNotKeptInChatState() {
        assertFalse(isStateEventWorthKeeping(ChatEvent(type = "tool.output", threadId = "thread-1", text = "raw logs")))
        assertFalse(isStateEventWorthKeeping(ChatEvent(type = "terminal.output", threadId = "thread-1", text = "raw logs")))
        assertTrue(isStateEventWorthKeeping(ChatEvent(type = "terminal.output", threadId = "terminal:cmd-1", text = "npm test")))
        assertTrue(isStateEventWorthKeeping(ChatEvent(type = "message.delta", threadId = "thread-1", text = "hello")))
    }

    @Test
    fun historicalThreadEventsAreSanitizedBeforeDisplay() {
        val events = listOf(
            ChatEvent(type = "thread.started", threadId = "thread-1"),
            ChatEvent(type = "tool.output", threadId = "thread-1", text = "raw"),
            ChatEvent(type = "terminal.output", threadId = "thread-1", text = "raw"),
            ChatEvent(type = "message.delta", threadId = "thread-1", text = "answer"),
            ChatEvent(type = "message.delta", threadId = "thread-2", text = "other"),
        )
        val sanitized = sanitizedThreadEvents(events, "thread-1")
        assertTrue(sanitized.map { it.type }.contains("thread.started"))
        assertTrue(sanitized.map { it.type }.contains("message.delta"))
        assertFalse(sanitized.any { it.type == "tool.output" || it.type == "terminal.output" })
        assertFalse(sanitized.any { it.threadId == "thread-2" })
    }

    @Test
    fun taskLifecycleEventsRefreshThreadList() {
        assertTrue(shouldRefreshThreadsForEvent(ChatEvent(type = "thread.started", threadId = "thread-1")))
        assertTrue(shouldRefreshThreadsForEvent(ChatEvent(type = "user.message", threadId = "thread-1")))
        assertTrue(shouldRefreshThreadsForEvent(ChatEvent(type = "turn.completed", threadId = "thread-1")))
        assertFalse(shouldRefreshThreadsForEvent(ChatEvent(type = "message.delta", threadId = "thread-1")))
        assertFalse(shouldRefreshThreadsForEvent(ChatEvent(type = "tool.output", threadId = "thread-1")))
    }

    @Test
    fun otherThreadMessageDoesNotHijackActiveConversation() {
        val nextThread = nextActiveConversationThreadId(
            currentThreadId = "thread-1",
            pendingConversationStart = false,
            event = ChatEvent(type = "message.delta", threadId = "thread-2", text = "other"),
        )
        assertTrue(nextThread == "thread-1")
    }

    @Test
    fun pendingThreadStartCanActivateNewConversation() {
        val nextThread = nextActiveConversationThreadId(
            currentThreadId = "",
            pendingConversationStart = true,
            event = ChatEvent(type = "thread.started", threadId = "thread-2"),
        )
        assertTrue(nextThread == "thread-2")
    }

    @Test
    fun currentThreadKeepsStreamingOwnership() {
        val nextThread = nextActiveConversationThreadId(
            currentThreadId = "thread-1",
            pendingConversationStart = false,
            event = ChatEvent(type = "message.delta", threadId = "thread-1", text = "hello"),
        )
        assertTrue(nextThread == "thread-1")
    }

    @Test
    fun modelChoicesKeepCurrentModelFirstAndUnique() {
        val choices = modelChoices("gpt-5-codex", "model = \"gpt-5-codex\"")
        assertTrue(choices.first() == "gpt-5-codex")
        assertTrue(choices.distinct().size == choices.size)
    }

    @Test
    fun modelChoicesCanReadRawCodexConfig() {
        val choices = modelChoices("", """
            model = "codex-local-model"
            [profiles.fast]
            model = 'codex-fast-model'
        """.trimIndent())
        assertTrue(choices.contains("codex-local-model"))
        assertTrue(choices.contains("codex-fast-model"))
    }

    @Test
    fun providerChoicesCanReadRawCodexConfig() {
        val choices = providerChoices("", """
            model_provider = "custom"
            [model_providers.custom]
            base_url = "http://127.0.0.1:15721/v1"

            [model_providers.openai]
            wire_api = "responses"
        """.trimIndent())
        assertTrue(choices.contains("custom"))
        assertTrue(choices.contains("openai"))
    }

    @Test
    fun promptStartsNewThreadWhenActiveThreadIsMissingOrDebug() {
        assertTrue(shouldStartNewThreadForPrompt("debug", activeThreadExists = false))
        assertTrue(shouldStartNewThreadForPrompt("", activeThreadExists = false))
        assertTrue(shouldStartNewThreadForPrompt("thread-1", activeThreadExists = false))
        assertFalse(shouldStartNewThreadForPrompt("thread-1", activeThreadExists = true))
    }

    @Test
    fun sendButtonRequiresConnectionDraftAndNoPendingStart() {
        assertTrue(canSubmitChatDraft(connected = true, draft = "继续", pendingConversationStart = false, turnRunning = false))
        assertFalse(canSubmitChatDraft(connected = false, draft = "继续", pendingConversationStart = false, turnRunning = false))
        assertFalse(canSubmitChatDraft(connected = true, draft = "", pendingConversationStart = false, turnRunning = false))
        assertFalse(canSubmitChatDraft(connected = true, draft = "继续", pendingConversationStart = true, turnRunning = false))
        assertFalse(canSubmitChatDraft(connected = true, draft = "继续", pendingConversationStart = false, turnRunning = true))
    }

    @Test
    fun quickChatActionsUseSameRunningAndConnectionGuards() {
        assertTrue(canRunQuickChatAction(connected = true, pendingConversationStart = false, turnRunning = false, text = "继续"))
        assertFalse(canRunQuickChatAction(connected = false, pendingConversationStart = false, turnRunning = false, text = "继续"))
        assertFalse(canRunQuickChatAction(connected = true, pendingConversationStart = true, turnRunning = false, text = "继续"))
        assertFalse(canRunQuickChatAction(connected = true, pendingConversationStart = false, turnRunning = true, text = "继续"))
        assertFalse(canRunQuickChatAction(connected = true, pendingConversationStart = false, turnRunning = false, text = ""))
    }

    @Test
    fun emptyThreadRequiresConnectionTrustedProjectAndIdleState() {
        val project = Project(id = "p1", name = "App", path = "F:/Code/App", trusted = true)
        val untrustedProject = project.copy(trusted = false)
        assertTrue(canStartEmptyThread(connected = true, pendingConversationStart = false, turnRunning = false, project = project))
        assertFalse(canStartEmptyThread(connected = false, pendingConversationStart = false, turnRunning = false, project = project))
        assertFalse(canStartEmptyThread(connected = true, pendingConversationStart = true, turnRunning = false, project = project))
        assertFalse(canStartEmptyThread(connected = true, pendingConversationStart = false, turnRunning = true, project = project))
        assertFalse(canStartEmptyThread(connected = true, pendingConversationStart = false, turnRunning = false, project = untrustedProject))
        assertFalse(canStartEmptyThread(connected = true, pendingConversationStart = false, turnRunning = false, project = null))
    }

    @Test
    fun streamingOutputIsNotDeduplicatedByContent() {
        assertFalse(shouldDeduplicateEvent(ChatEvent(type = "message.delta", threadId = "thread-1", text = " ")))
        assertFalse(shouldDeduplicateEvent(ChatEvent(type = "terminal.output", threadId = "terminal:1", text = "same")))
        assertTrue(shouldDeduplicateEvent(ChatEvent(type = "thread.started", threadId = "thread-1")))
    }

    @Test
    fun pendingOutgoingUserMessageIsRemovedWhenConfirmed() {
        val pending = pendingOutgoingUserMessage("", "做这个")
        val confirmed = ChatEvent(type = "user.message", threadId = "thread-1", text = "做这个")
        val events = removeConfirmedPendingOutgoingUserMessages(listOf(pending), confirmed)
        assertTrue(events.isEmpty())
    }

    @Test
    fun pendingOutgoingUserMessageForCurrentThreadIsRemovedOnFailure() {
        val pending = pendingOutgoingUserMessage("thread-1", "做这个")
        val events = removePendingOutgoingUserMessages(listOf(pending), "thread-1")
        assertTrue(events.isEmpty())
    }

    @Test
    fun pendingOutgoingUserMessageMovesToStartedThread() {
        val pending = pendingOutgoingUserMessage("", "做这个")
        val existing = pendingOutgoingUserMessage("thread-old", "旧消息")
        val moved = movePendingOutgoingUserMessagesToThread(listOf(pending, existing), "thread-1")

        assertTrue(moved.first().threadId == "thread-1")
        assertTrue(moved.last().threadId == "thread-old")
    }

    @Test
    fun refreshKeepsUnconfirmedPendingOutgoingUserMessage() {
        val pending = pendingOutgoingUserMessage("thread-1", "做这个")
        val refreshed = listOf(ChatEvent(type = "message.delta", threadId = "thread-1", text = "之前的回答"))
        val kept = pendingOutgoingUserMessagesForRefresh(listOf(pending), "thread-1", refreshed)

        assertTrue(kept == listOf(pending))
    }

    @Test
    fun refreshDropsConfirmedPendingOutgoingUserMessage() {
        val pending = pendingOutgoingUserMessage("thread-1", "做这个")
        val refreshed = listOf(ChatEvent(type = "user.message", threadId = "thread-1", text = "做这个"))
        val kept = pendingOutgoingUserMessagesForRefresh(listOf(pending), "thread-1", refreshed)

        assertTrue(kept.isEmpty())
    }

    @Test
    fun startedThreadEventCarriesProjectMetadata() {
        val thread = threadRecordFromStartedEvent(
            ChatEvent(
                type = "thread.started",
                threadId = "thread-1",
                projectPath = "F:/Code/App",
                title = "实现功能",
                status = "idle",
                updatedAt = "2026-06-14T10:00:00.000Z",
            ),
            existing = null,
        )
        assertTrue(thread.projectPath == "F:/Code/App")
        assertTrue(thread.title == "实现功能")
        assertTrue(thread.updatedAt.isNotBlank())
    }

    @Test
    fun conversationTailOnlyFollowsWhenNearBottom() {
        assertTrue(shouldFollowConversationTail(lastVisibleIndex = -1, itemCount = 10))
        assertTrue(shouldFollowConversationTail(lastVisibleIndex = 9, itemCount = 10))
        assertTrue(shouldFollowConversationTail(lastVisibleIndex = 8, itemCount = 10))
        assertFalse(shouldFollowConversationTail(lastVisibleIndex = 6, itemCount = 10))
    }
}
