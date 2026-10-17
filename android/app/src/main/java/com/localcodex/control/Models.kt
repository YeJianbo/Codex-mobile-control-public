package com.localcodex.control

data class Project(
    val id: String,
    val name: String,
    val path: String,
    val trusted: Boolean,
)

data class ProjectRoot(
    val path: String,
    val name: String = "",
    val exists: Boolean = false,
)

data class ControlSettings(
    val model: String = "",
    val modelProvider: String = "",
    val providerBaseUrl: String = "",
    val approvalPolicy: String = "",
    val sandboxMode: String = "",
    val reasoningEffort: String = "",
    val networkAccess: Boolean = false,
    val disableResponseStorage: Boolean = false,
)

data class ApprovalPolicySummary(
    val approvalPolicy: String = "",
    val approvalLabel: String = "",
    val approvalRisk: String = "unknown",
    val sandboxMode: String = "",
    val sandboxLabel: String = "",
    val networkAccess: Boolean = false,
    val summary: String = "",
    val recommendation: String = "",
)

data class RawCodexConfig(
    val path: String = "",
    val content: String = "",
)

data class GatewayHttpsConfig(
    val enabled: Boolean = false,
    val certPath: String = "",
    val keyPath: String = "",
    val certExists: Boolean = false,
    val keyExists: Boolean = false,
    val restartRequired: Boolean = false,
)

data class GatewayHealth(
    val ok: Boolean = false,
    val version: String = "",
    val protocolVersion: Int = 0,
    val minAndroidProtocolVersion: Int = 0,
    val capabilities: List<String> = emptyList(),
)

data class ChatEvent(
    val type: String,
    val threadId: String = "",
    val projectPath: String = "",
    val stream: String = "",
    val text: String = "",
    val title: String = "",
    val status: String = "",
    val detail: String = "",
    val itemId: String = "",
    val commandId: String = "",
    val cwd: String = "",
    val command: String = "",
    val createdAt: String = "",
    val updatedAt: String = "",
    val readThrough:Long=0,
    val approvalId: String = "",
    val approvalType: String = "",
    val diff: String = "",
    val files: List<String> = emptyList(),
    val eventId: String = "",
    val displayKey: String = "",
    val requestId: String = "",
    val replayed: Boolean = false,
    val subagent: Boolean = false,
    val timeUsedSeconds:Long?=null,
    val detailsDeferred: Boolean = false,
    val activityGroupId: String = "",
    val activitySummary: String = "",
    val activityCount: Int = 0,
    val fileChanges:List<NativeFileChange> = emptyList(),
    val images: List<NativeImage> = emptyList(),
    val uploads: List<NativeUploadedFile> = emptyList(),
    val attachments: List<NativeAttachment> = emptyList(),
    val questionReplies: List<NativeQuestionReply> = emptyList(),
    val questionReplyId:String = "",
    val messageSource:NativeMessageSource?=null,
    val willRetry:Boolean=false,
    val textComplete: Boolean = false,
    val decision: String = "",
    val turnId: String = "",
    val serviceTier:String?=null,
    val hasServiceTier:Boolean=false,
)
data class NativeMessageSource(val kind:String,val name:String,val threadId:String="",val avatar:String="",val automationId:String="")

data class NativeQuestionReply(val question:String,val answer:String)

data class NativeAttachment(val name:String,val path:String,val url:String="")
data class NativeImage(val id: String, val name: String)
data class NativeUploadedFile(val id:String,val name:String,val mime:String,val size:Long)
data class NativeModel(val id: String, val name: String, val efforts: List<String>, val defaultEffort: String,val available:Boolean=true,val unavailableReason:String="",val providerId:String="",val providerName:String="",val shortName:String="")
data class NativeBackend(val agent:String,val available:Boolean,val reason:String="",val installed:Boolean=false,val supportsImages:Boolean?=null,val supportsPlanMode:Boolean?=null)
data class NativeGoal(val objective:String,val status:String,val tokensUsed:Long=0,val tokenBudget:Long?=null,val timeUsedSeconds:Long?=null,val id:String="")

data class ThreadRecord(
    val id: String,
    val projectPath: String = "",
    val title: String = "",
    val status: String = "",
    val updatedAt: String = "",
    val pinnedIndex: Int = -1,
    val goal:NativeGoal?=null,
    val source:String="",
    val readOnly:Boolean=false,
    val snapshotUpdatedAt:String="",
    val snapshotStatus:String="",
    val snapshotStale:Boolean=false,
    val snapshotContentKind:String="summary",
    val subagent:NativeSubagent?=null,
    val unread:Boolean=false,
    val completedAt:Long=0,
    val closureKind:String?=null,
)
data class NativeSubagent(val parentThreadId:String="",val nickname:String="",val role:String="",val task:String="")

data class ThreadMatch(
    val threadId: String,
    val title: String,
    val snippet: String,
    val updatedAt: String,
)

data class FileEntry(
    val name: String,
    val path: String,
    val kind: String,
    val size: Long = 0,
    val modifiedAt: String = "",
)

data class FileContent(
    val path: String = "",
    val content: String = "",
    val editable: Boolean = false,
)

data class ProjectDiff(
    val stat: String = "",
    val diff: String = "",
)

data class DiffFileEntry(
    val path: String,
    val oldPath: String = "",
    val status: String = "unknown",
    val additions: Int = 0,
    val deletions: Int = 0,
)

data class FileDiff(
    val path: String = "",
    val diff: String = "",
)

data class DiffHunk(
    val id: String,
    val index: Int,
    val source: String,
    val header: String,
    val text: String,
)

data class TerminalCommandResult(
    val commandId: String,
    val threadId: String,
    val cwd: String,
    val command: String,
)

data class TerminalSessionResult(
    val sessionId: String,
    val threadId: String,
    val cwd: String,
    val shell: String,
    val cols: Int = 0,
    val rows: Int = 0,
    val backend: String = "",
)

data class TerminalCommandRecord(
    val commandId: String,
    val threadId: String,
    val cwd: String = "",
    val command: String = "",
    val status: String = "unknown",
    val startedAt: String = "",
    val endedAt: String = "",
    val stdout: String = "",
    val stderr: String = "",
    val output: String = "",
    val stdoutLength: Int = 0,
    val stderrLength: Int = 0,
    val outputLength: Int = 0,
    val outputOffset: Int = 0,
    val outputEnd: Int = 0,
    val outputTruncated: Boolean = false,
    val chunks: Int = 0,
    val interactive: Boolean = false,
)

data class TerminalOutputPage(
    val commandId: String = "",
    val threadId: String = "",
    val stream: String = "combined",
    val offset: Int = 0,
    val end: Int = 0,
    val limit: Int = 0,
    val totalLength: Int = 0,
    val text: String = "",
    val hasMoreBefore: Boolean = false,
    val hasMoreAfter: Boolean = false,
)

data class PairingResult(
    val token: String,
    val deviceId: String,
    val deviceName: String,
)

data class TokenRotationResult(
    val kind: String,
    val token: String,
    val device: DeviceRecord? = null,
)

data class DeviceRecord(
    val id: String,
    val name: String = "",
    val userAgent: String = "",
    val firstSeenAt: String = "",
    val lastSeenAt: String = "",
    val revokedAt: String = "",
)

data class CodexStatus(
    val cliVersion: String = "",
    val cliAvailable: Boolean = false,
    val running: Boolean = false,
    val initialized: Boolean = false,
    val initializedAt: String = "",
    val pendingRequests: Int = 0,
    val startedAt: String = "",
    val lastExitCode: String = "",
    val lastError: String = "",
    val malformedMessages: Int = 0,
    val lastMalformedAt: String = "",
    val autoRestartEnabled: Boolean = false,
    val restartAttempts: Int = 0,
    val nextRestartAt: String = "",
    val lastRestartAt: String = "",
)

data class MethodObservation(
    val method: String = "",
    val count: Int = 0,
    val lastSeenAt: String = "",
)

data class CodexCompatibility(
    val status: String = "warning",
    val checkedAt: String = "",
    val cliVersion: String = "",
    val cliAvailable: Boolean = false,
    val appServerRunning: Boolean = false,
    val initialized: Boolean = false,
    val initializedAt: String = "",
    val pendingRequests: Int = 0,
    val clientRequests: List<String> = emptyList(),
    val notifications: List<String> = emptyList(),
    val serverRequests: List<String> = emptyList(),
    val clientCapabilities: List<String> = emptyList(),
    val unknownNotifications: List<MethodObservation> = emptyList(),
    val unsupportedServerRequests: List<MethodObservation> = emptyList(),
    val malformedMessages: Int = 0,
    val lastMalformedAt: String = "",
    val recommendations: List<String> = emptyList(),
)

data class CodexUpgradeCheck(
    val checkedAt: String = "",
    val installedVersion: String = "",
    val installedRaw: String = "",
    val latestVersion: String = "",
    val packageName: String = "",
    val updateAvailable: Boolean = false,
    val command: String = "",
    val source: String = "",
    val error: String = "",
)
