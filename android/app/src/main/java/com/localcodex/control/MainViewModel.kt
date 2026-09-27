package com.localcodex.control

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class UiState(
    val baseUrl: String = "",
    val token: String = "",
    val trustSelfSigned: Boolean = false,
    val connected: Boolean = false,
    val reconnecting: Boolean = false,
    val reconnectAttempt: Int = 0,
    val loading: Boolean = false,
    val error: String = "",
    val projects: List<Project> = emptyList(),
    val projectRoots: List<ProjectRoot> = emptyList(),
    val threads: List<ThreadRecord> = emptyList(),
    val devices: List<DeviceRecord> = emptyList(),
    val settings: ControlSettings = ControlSettings(),
    val approvalSummary: ApprovalPolicySummary = ApprovalPolicySummary(),
    val rawCodexConfig: RawCodexConfig = RawCodexConfig(),
    val gatewayHttps: GatewayHttpsConfig = GatewayHttpsConfig(),
    val gatewayHealth: GatewayHealth = GatewayHealth(),
    val protocolCompatible: Boolean = true,
    val events: List<ChatEvent> = emptyList(),
    val activeThreadId: String = "debug",
    val lastUserPrompt: String = "",
    val chatDraft: String = "",
    val pendingConversationStart: Boolean = false,
    val activeProjectId: String = "",
    val filePath: String = "",
    val files: List<FileEntry> = emptyList(),
    val openedFile: FileContent = FileContent(),
    val projectDiff: ProjectDiff = ProjectDiff(),
    val diffFiles: List<DiffFileEntry> = emptyList(),
    val selectedFileDiff: FileDiff = FileDiff(),
    val selectedFileHunks: List<DiffHunk> = emptyList(),
    val terminalCommands: List<TerminalCommandRecord> = emptyList(),
    val terminalFocusCommandId: String = "",
    val terminalFocusInteractive: Boolean = false,
    val terminalFocusRequestId: Long = 0L,
    val filePreviewUrl: String = "",
    val browserPreviewUrl: String = "",
    val codexStatus: CodexStatus = CodexStatus(),
    val codexCompatibility: CodexCompatibility = CodexCompatibility(),
    val codexUpgradeCheck: CodexUpgradeCheck = CodexUpgradeCheck(),
)

private data class ConnectionSnapshot(
    val health: GatewayHealth,
    val projects: List<Project>,
    val projectRoots: List<ProjectRoot>,
    val settings: ControlSettings,
    val approvalSummary: ApprovalPolicySummary,
    val rawCodexConfig: RawCodexConfig,
    val gatewayHttps: GatewayHttpsConfig,
    val threads: List<ThreadRecord>,
    val devices: List<DeviceRecord>,
    val codexStatus: CodexStatus,
    val codexCompatibility: CodexCompatibility,
    val codexUpgradeCheck: CodexUpgradeCheck,
    val terminalCommands: List<TerminalCommandRecord>,
)

private data class ReconnectSnapshot(
    val health: GatewayHealth,
    val projects: List<Project>,
    val threads: List<ThreadRecord>,
    val codexStatus: CodexStatus,
    val terminalCommands: List<TerminalCommandRecord>,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val supportedProtocolVersion = 1
    private val connectionStore = ConnectionStore(application)

    var state by mutableStateOf(
        UiState(
            baseUrl = connectionStore.baseUrl(),
            token = connectionStore.token(),
            trustSelfSigned = connectionStore.trustSelfSigned(),
            chatDraft = connectionStore.chatDraft("global"),
        )
    )
        private set

    private var client: GatewayClient? = null
    private var eventsJob: Job? = null
    private var reconnectJob: Job? = null
    private var appliedPairCode: String = ""
    private var autoConnectAttempted: Boolean = false
    private val pendingOutgoingDrafts = mutableMapOf<String, String>()

    fun updateToken(value: String) {
        state = state.copy(token = value)
    }

    fun updateTrustSelfSigned(value: Boolean) {
        state = state.copy(trustSelfSigned = value)
        connectionStore.save(state.baseUrl.trimEnd('/'), state.token.trim(), value)
    }

    fun clearError() {
        state = state.copy(error = "")
    }

    fun autoConnectSavedConnection(pairCode: String = "") {
        if (!shouldAutoConnectSavedConnection(state.baseUrl, state.token, pairCode, autoConnectAttempted, state.connected)) {
            return
        }
        autoConnectAttempted = true
        connect()
    }

    fun applyPairLink(baseUrl: String, code: String) {
        if (code.isBlank() || appliedPairCode == code) {
            return
        }
        appliedPairCode = code
        val nextBaseUrl = baseUrl.ifBlank { state.baseUrl }
        state = state.copy(baseUrl = nextBaseUrl)
        connectionStore.save(nextBaseUrl.trimEnd('/'), state.token, state.trustSelfSigned)
        pairWithCode(code)
    }

    fun pairWithCode(code: String) {
        val nextClient = GatewayClient(state.baseUrl.trimEnd('/'), "", state.trustSelfSigned)
        state = state.copy(loading = true, error = "")
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { nextClient.claimPairing(code) }
            }.onSuccess { result ->
                state = state.copy(token = result.token, loading = false)
                connectionStore.save(state.baseUrl.trimEnd('/'), result.token, state.trustSelfSigned)
                connect()
            }.onFailure { error ->
                state = state.copy(loading = false, error = error.message.orEmpty())
            }
        }
    }

    fun pairWithAddress(host: String, port: String, trustSelfSigned: Boolean, code: String) {
        if (code.isBlank()) {
            return
        }
        state = state.copy(loading = true, error = "")
        viewModelScope.launch {
            runCatching {
                val baseUrl = withContext(Dispatchers.IO) { resolveGatewayBaseUrl(host, port, trustSelfSigned) }
                val nextClient = GatewayClient(baseUrl, "", trustSelfSigned)
                val result = withContext(Dispatchers.IO) { nextClient.claimPairing(code) }
                baseUrl to result
            }.onSuccess { (baseUrl, result) ->
                state = state.copy(baseUrl = baseUrl, token = result.token, trustSelfSigned = trustSelfSigned, loading = false)
                connectionStore.save(baseUrl, result.token, trustSelfSigned)
                connect()
            }.onFailure { error ->
                state = state.copy(loading = false, error = error.message.orEmpty())
            }
        }
    }

    fun connect() {
        val baseUrl = state.baseUrl.trimEnd('/')
        if (baseUrl.isBlank()) {
            state = state.copy(error = "请输入电脑端 IP 和端口。")
            return
        }
        connectResolved(baseUrl, state.token.trim(), state.trustSelfSigned)
    }

    fun connectWithAddress(host: String, port: String, token: String, trustSelfSigned: Boolean) {
        state = state.copy(loading = true, error = "")
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { resolveGatewayBaseUrl(host, port, trustSelfSigned) }
            }.onSuccess { baseUrl ->
                connectResolved(baseUrl, token.trim(), trustSelfSigned)
            }.onFailure { error ->
                state = state.copy(loading = false, connected = false, error = error.message.orEmpty())
            }
        }
    }

    private fun connectResolved(baseUrl: String, token: String, trustSelfSigned: Boolean) {
        val nextClient = GatewayClient(baseUrl.trimEnd('/'), token, trustSelfSigned)
        client = nextClient
        connectionStore.save(baseUrl.trimEnd('/'), token, trustSelfSigned)
        reconnectJob?.cancel()
        state = state.copy(loading = true, reconnecting = false, reconnectAttempt = 0, error = "")
        viewModelScope.launch {
            runCatching {
                val health = withContext(Dispatchers.IO) { nextClient.health() }
                state = state.copy(gatewayHealth = health, protocolCompatible = isProtocolCompatible(health))
                if (!isProtocolCompatible(health)) {
                    error("Gateway 协议不兼容：服务端 ${health.protocolVersion}，手机端 $supportedProtocolVersion。请升级其中一端。")
                }
                val projects = withContext(Dispatchers.IO) { nextClient.listProjects() }
                val projectRoots = withContext(Dispatchers.IO) { nextClient.listProjectRoots() }
                val settings = withContext(Dispatchers.IO) { nextClient.readSettings() }
                val approvalSummary = withContext(Dispatchers.IO) { nextClient.readApprovalSummary() }
                val rawCodexConfig = withContext(Dispatchers.IO) { nextClient.readRawSettings() }
                val gatewayHttps = withContext(Dispatchers.IO) { nextClient.readHttpsConfig() }
                val threads = withContext(Dispatchers.IO) { nextClient.listThreads() }
                val devices = withContext(Dispatchers.IO) { nextClient.listDevices() }
                val codexStatus = withContext(Dispatchers.IO) { nextClient.codexStatus() }
                val codexCompatibility = withContext(Dispatchers.IO) { nextClient.codexCompatibility() }
                val codexUpgradeCheck = withContext(Dispatchers.IO) {
                    runCatching { nextClient.codexUpgradeCheck() }.getOrElse { CodexUpgradeCheck(error = it.message.orEmpty()) }
                }
                val terminalCommands = withContext(Dispatchers.IO) { nextClient.terminalCommands() }
                ConnectionSnapshot(health, projects, projectRoots, settings, approvalSummary, rawCodexConfig, gatewayHttps, threads, devices, codexStatus, codexCompatibility, codexUpgradeCheck, terminalCommands)
            }.onSuccess { snapshot ->
                state = state.copy(
                    baseUrl = baseUrl.trimEnd('/'),
                    token = token,
                    trustSelfSigned = trustSelfSigned,
                    connected = true,
                    reconnecting = false,
                    reconnectAttempt = 0,
                    loading = false,
                    gatewayHealth = snapshot.health,
                    protocolCompatible = true,
                    projects = snapshot.projects,
                    projectRoots = snapshot.projectRoots,
                    settings = snapshot.settings,
                    approvalSummary = snapshot.approvalSummary,
                    rawCodexConfig = snapshot.rawCodexConfig,
                    gatewayHttps = snapshot.gatewayHttps,
                    threads = snapshot.threads,
                    devices = snapshot.devices,
                    codexStatus = snapshot.codexStatus,
                    codexCompatibility = snapshot.codexCompatibility,
                    codexUpgradeCheck = snapshot.codexUpgradeCheck,
                    terminalCommands = snapshot.terminalCommands,
                    events = state.events.filter(::isStateEventWorthKeeping).takeLast(500),
                )
                subscribeEvents(nextClient)
            }.onFailure { error ->
                val message = error.message.orEmpty()
                val shouldRetry = shouldScheduleReconnectAfterConnectFailure(baseUrl, token, message)
                val nextAttempt = 1
                state = state.copy(
                    loading = false,
                    connected = false,
                    reconnecting = shouldRetry,
                    reconnectAttempt = if (shouldRetry) nextAttempt else 0,
                    pendingConversationStart = false,
                    error = message,
                )
                if (shouldRetry) {
                    reconnectJob = null
                    scheduleReconnect(nextAttempt)
                }
            }
        }
    }

    private fun isProtocolCompatible(health: GatewayHealth): Boolean {
        if (!health.ok || health.protocolVersion <= 0) {
            return false
        }
        return supportedProtocolVersion >= health.minAndroidProtocolVersion &&
            supportedProtocolVersion <= health.protocolVersion
    }

    fun saveSettings(settings: ControlSettings) {
        val activeClient = client ?: return
        state = state.copy(settings = settings, loading = true)
        viewModelScope.launch {
            runCatching {
                val saved = withContext(Dispatchers.IO) { activeClient.saveSettings(settings) }
                val approvalSummary = withContext(Dispatchers.IO) { activeClient.readApprovalSummary() }
                val raw = withContext(Dispatchers.IO) { activeClient.readRawSettings() }
                Triple(saved, approvalSummary, raw)
            }.onSuccess { (saved, approvalSummary, raw) ->
                state = state.copy(settings = saved, approvalSummary = approvalSummary, rawCodexConfig = raw, loading = false)
            }.onFailure {
                state = state.copy(loading = false, error = it.message.orEmpty())
            }
        }
    }

    fun saveRawSettings(content: String) {
        val activeClient = client ?: return
        state = state.copy(loading = true)
        viewModelScope.launch {
            runCatching {
                val raw = withContext(Dispatchers.IO) { activeClient.saveRawSettings(content) }
                val settings = withContext(Dispatchers.IO) { activeClient.readSettings() }
                val approvalSummary = withContext(Dispatchers.IO) { activeClient.readApprovalSummary() }
                Triple(raw, settings, approvalSummary)
            }.onSuccess { (raw, settings, approvalSummary) ->
                state = state.copy(rawCodexConfig = raw, settings = settings, approvalSummary = approvalSummary, loading = false)
            }.onFailure {
                state = state.copy(loading = false, error = it.message.orEmpty())
            }
        }
    }

    fun saveGatewayHttps(enabled: Boolean, generateSelfSigned: Boolean) {
        val activeClient = client ?: return
        state = state.copy(loading = true, error = "")
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.saveHttpsConfig(enabled, generateSelfSigned) }
            }.onSuccess {
                state = state.copy(gatewayHttps = it, loading = false, error = "HTTPS 配置已保存，重启 Gateway 后生效。")
            }.onFailure {
                state = state.copy(loading = false, error = it.message.orEmpty())
            }
        }
    }

    fun addLocalProject(path: String) {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.addProject(path) }
                val projects = withContext(Dispatchers.IO) { activeClient.listProjects() }
                val roots = withContext(Dispatchers.IO) { activeClient.listProjectRoots() }
                projects to roots
            }.onSuccess { (projects, roots) ->
                state = state.copy(projects = projects, projectRoots = roots, error = "")
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun addProjectRoot(path: String) {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                val roots = withContext(Dispatchers.IO) { activeClient.addProjectRoot(path) }
                val projects = withContext(Dispatchers.IO) { activeClient.listProjects() }
                roots to projects
            }.onSuccess { (roots, projects) ->
                state = state.copy(projectRoots = roots, projects = projects, error = "")
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun removeProjectRoot(root: ProjectRoot) {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                val roots = withContext(Dispatchers.IO) { activeClient.removeProjectRoot(root.path) }
                val projects = withContext(Dispatchers.IO) { activeClient.listProjects() }
                roots to projects
            }.onSuccess { (roots, projects) ->
                state = state.copy(
                    projectRoots = roots,
                    projects = projects,
                    activeProjectId = activeProjectIdAfterRefresh(state.activeProjectId, projects),
                    error = "",
                )
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun refreshProjectRoots() {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                val roots = withContext(Dispatchers.IO) { activeClient.listProjectRoots() }
                val projects = withContext(Dispatchers.IO) { activeClient.listProjects() }
                roots to projects
            }.onSuccess { (roots, projects) ->
                state = state.copy(projectRoots = roots, projects = projects, error = "")
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun refreshThreads() {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                val projects = withContext(Dispatchers.IO) { activeClient.listProjects() }
                val threads = withContext(Dispatchers.IO) { activeClient.listThreads() }
                projects to threads
            }.onSuccess { (projects, threads) ->
                state = state.copy(
                    projects = projects,
                    threads = threads,
                    activeProjectId = activeProjectIdAfterRefresh(state.activeProjectId, projects),
                    error = "",
                )
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun refreshDevices() {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.listDevices() }
            }.onSuccess {
                state = state.copy(devices = it, error = "")
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun rotateToken() {
        val activeClient = client ?: return
        state = state.copy(loading = true, error = "")
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.rotateToken() }
            }.onSuccess { result ->
                val nextBaseUrl = state.baseUrl.trimEnd('/')
                state = state.copy(token = result.token, loading = false, error = "Token 已轮换并保存。")
                connectionStore.save(nextBaseUrl, result.token, state.trustSelfSigned)
                connect()
            }.onFailure {
                state = state.copy(loading = false, error = it.message.orEmpty())
            }
        }
    }

    fun revokeDevice(device: DeviceRecord) {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.revokeDevice(device.id) }
                withContext(Dispatchers.IO) { activeClient.listDevices() }
            }.onSuccess {
                state = state.copy(devices = it, error = "")
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun startThread(project: Project?) {
        if (project == null || !project.trusted) {
            state = state.copy(error = "请先添加或选择一个可用项目。")
            return
        }
        if (state.pendingConversationStart) {
            state = state.copy(error = "会话正在启动，请稍等。")
            return
        }
        if (!state.connected) {
            state = state.copy(error = realtimeUnavailableMessage())
            return
        }
        openBlankThread(project)
    }

    fun selectChatProject(project: Project) {
        persistCurrentChatDraft()
        val latestThread = state.threads.firstOrNull { it.projectPath == project.path }
        if (latestThread != null) {
            openThread(latestThread)
            return
        }
        state = state.copy(
            activeProjectId = project.id,
            activeThreadId = "",
            chatDraft = connectionStore.chatDraft(chatDraftKey("", project.id)),
            events = emptyList(),
            filePath = "",
            files = emptyList(),
            openedFile = FileContent(),
            projectDiff = ProjectDiff(),
            diffFiles = emptyList(),
            selectedFileDiff = FileDiff(),
            selectedFileHunks = emptyList(),
            filePreviewUrl = "",
            error = "",
        )
    }

    fun openBlankThread(project: Project) {
        persistCurrentChatDraft()
        state = state.copy(
            activeProjectId = project.id,
            activeThreadId = "",
            chatDraft = connectionStore.chatDraft(chatDraftKey("", project.id)),
            pendingConversationStart = false,
            events = emptyList(),
            filePath = "",
            files = emptyList(),
            openedFile = FileContent(),
            projectDiff = ProjectDiff(),
            diffFiles = emptyList(),
            selectedFileDiff = FileDiff(),
            selectedFileHunks = emptyList(),
            filePreviewUrl = "",
            error = "",
        )
    }

    fun refreshCodexStatus() {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                val status = withContext(Dispatchers.IO) { activeClient.codexStatus() }
                val compatibility = withContext(Dispatchers.IO) { activeClient.codexCompatibility() }
                status to compatibility
            }.onSuccess { (status, compatibility) ->
                state = state.copy(codexStatus = status, codexCompatibility = compatibility)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun refreshCodexCompatibility() {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                val compatibility = withContext(Dispatchers.IO) { activeClient.codexCompatibility() }
                val upgrade = withContext(Dispatchers.IO) {
                    runCatching { activeClient.codexUpgradeCheck() }.getOrElse { CodexUpgradeCheck(error = it.message.orEmpty()) }
                }
                compatibility to upgrade
            }.onSuccess {
                state = state.copy(codexCompatibility = it.first, codexUpgradeCheck = it.second)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun refreshCodexUpgradeCheck() {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.codexUpgradeCheck() }
            }.onSuccess {
                state = state.copy(codexUpgradeCheck = it, error = "")
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun startCodex() {
        val activeClient = client ?: return
        state = state.copy(loading = true)
        viewModelScope.launch {
            runCatching {
                val status = withContext(Dispatchers.IO) { activeClient.startCodex() }
                val compatibility = withContext(Dispatchers.IO) { activeClient.codexCompatibility() }
                status to compatibility
            }.onSuccess { (status, compatibility) ->
                state = state.copy(codexStatus = status, codexCompatibility = compatibility, loading = false)
            }.onFailure {
                state = state.copy(loading = false, error = it.message.orEmpty())
            }
        }
    }

    fun restartCodex() {
        val activeClient = client ?: return
        state = state.copy(loading = true)
        viewModelScope.launch {
            runCatching {
                val status = withContext(Dispatchers.IO) { activeClient.restartCodex() }
                val compatibility = withContext(Dispatchers.IO) { activeClient.codexCompatibility() }
                status to compatibility
            }.onSuccess { (status, compatibility) ->
                state = state.copy(codexStatus = status, codexCompatibility = compatibility, loading = false)
            }.onFailure {
                state = state.copy(loading = false, error = it.message.orEmpty())
            }
        }
    }

    fun openThread(thread: ThreadRecord) {
        val activeClient = client ?: return
        persistCurrentChatDraft()
        val project = state.projects.firstOrNull { it.path == thread.projectPath && isUsableHomeProject(it) }
        val nextProjectId = project?.id.orEmpty()
        val projectError = if (thread.projectPath.isNotBlank() && project == null) {
            "这个会话属于未添加的项目：${thread.projectPath}"
        } else {
            ""
        }
        state = state.copy(
            activeThreadId = thread.id,
            activeProjectId = nextProjectId,
            chatDraft = connectionStore.chatDraft(chatDraftKey(thread.id, nextProjectId)),
            filePath = "",
            files = emptyList(),
            openedFile = FileContent(),
            projectDiff = ProjectDiff(),
            diffFiles = emptyList(),
            selectedFileDiff = FileDiff(),
            selectedFileHunks = emptyList(),
            filePreviewUrl = "",
            error = projectError,
        )
        viewModelScope.launch {
            runCatching {
                sanitizedThreadEvents(withContext(Dispatchers.IO) { activeClient.eventsForThread(thread.id) }, thread.id)
            }.onSuccess {
                state = state.copy(events = it)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun renameThread(thread: ThreadRecord, title: String) {
        val activeClient = client ?: return
        val nextTitle = title.trim()
        if (thread.id.isBlank() || nextTitle.isBlank()) {
            return
        }
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.renameThread(thread.id, nextTitle) }
            }.onSuccess { renamed ->
                state = state.copy(
                    threads = state.threads.map { item ->
                        if (item.id == renamed.id) renamed else item
                    },
                    error = "",
                )
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun deleteThread(thread: ThreadRecord) {
        val activeClient = client ?: return
        if (thread.id.isBlank()) {
            return
        }
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.deleteThread(thread.id) }
                withContext(Dispatchers.IO) { activeClient.listThreads() }
            }.onSuccess { threads ->
                val wasActive = state.activeThreadId == thread.id
                val fallback = threads.firstOrNull { it.projectPath == thread.projectPath } ?: threads.firstOrNull()
                val fallbackProject = state.projects.firstOrNull { it.path == fallback?.projectPath && isUsableHomeProject(it) }
                state = state.copy(
                    threads = threads,
                    activeThreadId = if (wasActive) fallback?.id.orEmpty() else state.activeThreadId,
                    activeProjectId = if (wasActive) {
                        fallbackProject?.id ?: state.projects.firstOrNull { it.path == thread.projectPath && isUsableHomeProject(it) }?.id.orEmpty()
                    } else {
                        projectIdForThread(threads, state.activeThreadId)
                    },
                    chatDraft = if (wasActive) {
                        connectionStore.chatDraft(chatDraftKey(fallback?.id.orEmpty(), fallbackProject?.id ?: state.projects.firstOrNull { it.path == thread.projectPath && isUsableHomeProject(it) }?.id.orEmpty()))
                    } else {
                        state.chatDraft
                    },
                    events = if (wasActive && fallback == null) emptyList() else state.events.filterNot { it.threadId == thread.id },
                    error = "",
                )
                if (wasActive && fallback != null) {
                    openThread(fallback)
                }
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun openProjectFiles(project: Project) {
        state = state.copy(activeProjectId = project.id, filePath = "", openedFile = FileContent(), filePreviewUrl = "", error = "")
        loadFiles(project.id, "")
    }

    fun openActiveProjectFiles(): Boolean {
        val projectId = state.activeProjectId
        if (projectId.isBlank()) {
            state = state.copy(error = "当前会话没有绑定到已添加项目。请先在首页打开对应项目，或到项目管理添加该路径。")
            return false
        }
        state = state.copy(filePath = "", openedFile = FileContent(), filePreviewUrl = "", error = "")
        loadFiles(projectId, "")
        return true
    }

    fun openDirectory(path: String) {
        val projectId = state.activeProjectId
        if (projectId.isBlank()) {
            state = state.copy(error = "当前没有可浏览的项目。")
            return
        }
        state = state.copy(filePath = path, openedFile = FileContent(), filePreviewUrl = "")
        loadFiles(projectId, path)
    }

    fun refreshCurrentFiles() {
        val projectId = state.activeProjectId
        if (projectId.isBlank()) {
            state = state.copy(error = "当前没有可刷新的项目文件。")
            return
        }
        loadFiles(projectId, state.filePath)
    }

    fun openFile(entry: FileEntry) {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        if (projectId.isBlank()) {
            state = state.copy(error = "当前没有可读取的项目文件。")
            return
        }
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.readFile(projectId, entry.path) }
            }.onSuccess {
                state = state.copy(openedFile = it.copy(editable = true), filePreviewUrl = activeClient.rawFileUrl(projectId, entry.path))
            }.onFailure {
                state = state.copy(openedFile = FileContent(path = entry.path), error = it.message.orEmpty(), filePreviewUrl = activeClient.rawFileUrl(projectId, entry.path))
            }
        }
    }

    fun saveOpenedFile(content: String) {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        val path = state.openedFile.path
        if (projectId.isBlank() || path.isBlank()) {
            state = state.copy(error = "当前没有可保存的项目文件。")
            return
        }
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.saveFile(projectId, path, content) }
            }.onSuccess {
                state = state.copy(openedFile = state.openedFile.copy(content = content))
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun setPreviewUrl(url: String) {
        val activeClient = client ?: return
        val validation = normalizePreviewAddress(url)
        if (validation.error.isNotBlank()) {
            state = state.copy(error = validation.error)
            return
        }
        state = state.copy(browserPreviewUrl = activeClient.proxyPreviewUrl(validation.url), error = "")
    }

    fun selectTerminalProject(project: Project) {
        state = state.copy(activeProjectId = project.id)
    }

    fun focusTerminalCommand(commandId: String, threadId: String = "", cwd: String = "", interactive: Boolean = false) {
        val normalizedCommandId = commandId.ifBlank { terminalCommandIdFromThreadId(threadId) }
        val record = state.terminalCommands.firstOrNull { it.commandId == normalizedCommandId }
        val resolvedCwd = record?.cwd?.ifBlank { cwd } ?: cwd
        val resolvedProjectId = projectForWorkspacePath(state.projects, resolvedCwd)?.id.orEmpty()
        state = state.copy(
            activeProjectId = resolvedProjectId.ifBlank { state.activeProjectId },
            terminalFocusCommandId = normalizedCommandId,
            terminalFocusInteractive = interactive || record?.interactive == true,
            terminalFocusRequestId = state.terminalFocusRequestId + 1,
            error = if (resolvedCwd.isNotBlank() && resolvedProjectId.isBlank()) {
                "终端路径未映射到已添加项目：$resolvedCwd"
            } else {
                ""
            },
        )
    }

    fun refreshTerminalCommands() {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.terminalCommands() }
            }.onSuccess {
                state = state.copy(terminalCommands = it, error = "")
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun runTerminalCommand(command: String) {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        if (projectId.isBlank()) {
            state = state.copy(error = "请先为终端选择一个项目。")
            return
        }
        if (command.isBlank()) {
            return
        }
        state = state.copy(error = "")
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.runTerminalCommand(projectId, command) }
                withContext(Dispatchers.IO) { activeClient.terminalCommands() }
            }.onSuccess {
                state = state.copy(terminalCommands = it)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun startTerminalSession() {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        if (projectId.isBlank()) {
            state = state.copy(error = "请先为终端选择一个项目。")
            return
        }
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.startTerminalSession(projectId) }
                withContext(Dispatchers.IO) { activeClient.terminalCommands() }
            }.onSuccess {
                state = state.copy(terminalCommands = it, error = "")
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun stopTerminalCommand(commandId: String) {
        val activeClient = client ?: return
        if (commandId.isBlank()) {
            return
        }
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.stopTerminalCommand(commandId) }
                withContext(Dispatchers.IO) { activeClient.terminalCommands() }
            }.onSuccess {
                state = state.copy(terminalCommands = it)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun sendTerminalSessionInput(sessionId: String, text: String, appendNewline: Boolean = true) {
        val activeClient = client ?: return
        if (sessionId.isBlank() || text.isEmpty()) {
            return
        }
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.sendTerminalSessionInput(sessionId, text, appendNewline) }
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun stopTerminalSession(sessionId: String) {
        val activeClient = client ?: return
        if (sessionId.isBlank()) {
            return
        }
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.stopTerminalSession(sessionId) }
                withContext(Dispatchers.IO) { activeClient.terminalCommands() }
            }.onSuccess {
                state = state.copy(terminalCommands = it)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun resizeTerminalSession(sessionId: String, cols: Int, rows: Int) {
        val activeClient = client ?: return
        if (sessionId.isBlank()) {
            return
        }
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.resizeTerminalSession(sessionId, cols, rows) }
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun loadEarlierTerminalOutput(record: TerminalCommandRecord) {
        val activeClient = client ?: return
        if (record.commandId.isBlank() || record.outputOffset <= 0) {
            return
        }
        val nextOffset = (record.outputOffset - 16000).coerceAtLeast(0)
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.terminalCommandOutput(record.commandId, nextOffset) }
            }.onSuccess { page ->
                state = state.copy(
                    terminalCommands = state.terminalCommands.map { item ->
                        if (item.commandId != record.commandId) {
                            item
                        } else {
                            val existingOutput = item.output
                            val nextOutput = if (page.end <= item.outputOffset) {
                                page.text + existingOutput
                            } else {
                                page.text + existingOutput.drop((page.end - item.outputOffset).coerceAtLeast(0))
                            }
                            item.copy(
                                output = nextOutput,
                                outputLength = page.totalLength,
                                outputOffset = page.offset,
                                outputEnd = item.outputEnd.coerceAtLeast(page.end),
                                outputTruncated = page.hasMoreBefore,
                            )
                        }
                    }
                )
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun loadDiff(): Boolean {
        val activeClient = client ?: return false
        val projectId = state.activeProjectId
        if (projectId.isBlank()) {
            state = state.copy(error = "当前会话没有绑定到已添加项目，无法查看改动。")
            return false
        }
        viewModelScope.launch {
            runCatching {
                val diff = withContext(Dispatchers.IO) { activeClient.readDiff(projectId) }
                val files = withContext(Dispatchers.IO) { activeClient.listDiffFiles(projectId) }
                diff to files
            }.onSuccess { (diff, files) ->
                state = state.copy(projectDiff = diff, diffFiles = files)
                if (files.isNotEmpty()) {
                    openFileDiff(files.first())
                }
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
        return true
    }

    fun openFileDiff(entry: DiffFileEntry) {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        if (projectId.isBlank()) return
        viewModelScope.launch {
            runCatching {
                val diff = withContext(Dispatchers.IO) { activeClient.readFileDiff(projectId, entry.path) }
                val hunks = withContext(Dispatchers.IO) { activeClient.listFileDiffHunks(projectId, entry.path) }
                diff to hunks
            }.onSuccess { (diff, hunks) ->
                state = state.copy(selectedFileDiff = diff, selectedFileHunks = hunks)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun acceptFileDiff(entry: DiffFileEntry) {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        if (projectId.isBlank()) return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.acceptFileDiff(projectId, entry.path) }
            }.onSuccess {
                refreshDiffState(entry.path)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun revertFileDiff(entry: DiffFileEntry) {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        if (projectId.isBlank()) return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.revertFileDiff(projectId, entry.path) }
            }.onSuccess {
                refreshDiffState(entry.path)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun acceptAllDiffs() {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        val paths = state.diffFiles.filter { it.status != "accepted" }.map { it.path }
        if (projectId.isBlank() || paths.isEmpty()) return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.acceptFileDiffs(projectId, paths) }
            }.onSuccess {
                refreshDiffState("")
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun revertAllDiffs() {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        val paths = state.diffFiles.map { it.path }
        if (projectId.isBlank() || paths.isEmpty()) return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.revertFileDiffs(projectId, paths) }
            }.onSuccess {
                refreshDiffState("")
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun acceptDiffHunk(hunk: DiffHunk) {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        val path = state.selectedFileDiff.path
        if (projectId.isBlank() || path.isBlank()) return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.acceptFileDiffHunk(projectId, path, hunk) }
            }.onSuccess {
                refreshDiffState(path)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun revertDiffHunk(hunk: DiffHunk) {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        val path = state.selectedFileDiff.path
        if (projectId.isBlank() || path.isBlank()) return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.revertFileDiffHunk(projectId, path, hunk) }
            }.onSuccess {
                refreshDiffState(path)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun resolveApproval(approvalId: String, decision: String) {
        val activeClient = client ?: return
        if (approvalId.isBlank()) return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.resolveApproval(approvalId, decision) }
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    fun updateChatDraft(value: String) {
        state = state.copy(chatDraft = value)
        connectionStore.saveChatDraft(currentChatDraftKey(), value)
    }

    fun sendChatDraft(): Boolean {
        return sendMessage(state.chatDraft, clearAcceptedDraft = true)
    }

    fun sendMessage(text: String, clearAcceptedDraft: Boolean = false): Boolean {
        val prompt = text.trim()
        if (prompt.isBlank()) {
            return false
        }
        val activeClient = client
        if (activeClient == null) {
            state = state.copy(error = "请先连接 Gateway。")
            return false
        }
        if (!state.connected) {
            state = state.copy(error = realtimeUnavailableMessage())
            return false
        }
        if (state.pendingConversationStart) {
            state = state.copy(error = "会话正在启动，等手机端收到会话后再继续发送。")
            return false
        }
        val threadId = state.activeThreadId
        val thread = state.threads.find { it.id == threadId }
        if (state.threads.any { it.id == threadId && it.status == "running" }) {
            state = state.copy(error = "当前任务仍在运行，先停止或等待完成。")
            return false
        }
        if (shouldStartNewThreadForPrompt(threadId, thread != null)) {
            val project = projectForNewThread()
            if (project == null) {
                state = state.copy(error = "请先添加或选择一个项目，再开始会话。")
                return false
            }
            val sent = activeClient.startThread(project, state.settings.model, prompt)
            if (sent) {
                val draftKey = currentChatDraftKey()
                if (clearAcceptedDraft) {
                    rememberPendingOutgoingDraft(draftKey, prompt)
                    connectionStore.clearChatDraft(draftKey)
                }
                state = state.copy(
                    activeProjectId = project.id,
                    lastUserPrompt = prompt,
                    chatDraft = if (clearAcceptedDraft) "" else state.chatDraft,
                    pendingConversationStart = true,
                    events = appendEvent(state.events, pendingOutgoingUserMessage("", prompt)).takeLast(500),
                    error = "",
                )
            } else {
                state = state.copy(pendingConversationStart = false, error = realtimeUnavailableMessage())
            }
            return sent
        }
        state = state.copy(threads = markThreadStatus(state.threads, threadId, "running"))
        if (thread != null) {
            val sent = activeClient.sendTurn(thread, prompt, state.settings.model)
            if (sent) {
                val draftKey = currentChatDraftKey()
                if (clearAcceptedDraft) {
                    rememberPendingOutgoingDraft(draftKey, prompt)
                    connectionStore.clearChatDraft(draftKey)
                }
                state = state.copy(
                    lastUserPrompt = prompt,
                    chatDraft = if (clearAcceptedDraft) "" else state.chatDraft,
                    events = appendEvent(state.events, pendingOutgoingUserMessage(threadId, prompt)).takeLast(500),
                    error = "",
                )
            } else {
                state = state.copy(
                    threads = markThreadStatus(state.threads, threadId, thread.status),
                    error = realtimeUnavailableMessage(),
                )
            }
            return sent
        }
        return false
    }

    fun refreshActiveThreadEvents() {
        val activeClient = client ?: return
        val threadId = state.activeThreadId
        if (!state.connected || threadId.isBlank()) {
            return
        }
        viewModelScope.launch {
            runCatching {
                sanitizedThreadEvents(withContext(Dispatchers.IO) { activeClient.eventsForThread(threadId) }, threadId)
            }.onSuccess { events ->
                if (events.isNotEmpty() && state.activeThreadId == threadId) {
                    val otherEvents = state.events.filter { it.threadId != threadId }
                    val pendingEvents = pendingOutgoingUserMessagesForRefresh(state.events, threadId, events)
                    state = state.copy(events = mergeEvents(otherEvents + pendingEvents, events).takeLast(500))
                }
            }
        }
    }

    fun continueLastTurn() {
        sendMessage("继续")
    }

    fun retryLastTurn() {
        sendMessage(state.lastUserPrompt)
    }

    fun stopTurn() {
        val threadId = state.activeThreadId
        if (threadId.isBlank()) {
            return
        }
        val sent = client?.interruptTurn(threadId) == true
        if (!sent) {
            state = state.copy(error = realtimeUnavailableMessage())
            return
        }
        state = state.copy(
            threads = state.threads.map { thread ->
                if (thread.id == threadId) thread.copy(status = "interrupted") else thread
            }
        )
    }

    fun sendDebugEcho(text: String) {
        if (text.isBlank()) {
            return
        }
        val sent = client?.sendEcho(text) == true
        if (!sent) {
            state = state.copy(error = realtimeUnavailableMessage())
        }
    }

    private fun subscribeEvents(activeClient: GatewayClient) {
        eventsJob?.cancel()
        eventsJob = viewModelScope.launch {
            activeClient.events()
                .catch { error -> handleRealtimeDisconnected(error.message.orEmpty().ifBlank { "实时连接已断开" }) }
                .collect { event ->
                if (event.type == "connection.opened") {
                    reconnectJob?.cancel()
                    state = state.copy(connected = true, reconnecting = false, reconnectAttempt = 0, error = "")
                    return@collect
                }
                if (event.type == "connection.closed" || event.type == "connection.failed") {
                    handleRealtimeDisconnected(event.detail.ifBlank { "实时连接已断开" })
                    return@collect
                }
                if (event.type == "error") {
                    val failedThreadId = event.threadId.ifBlank { state.activeThreadId }
                    val restoredDraft = restorePendingOutgoingDraft(failedThreadId)
                    state = state.copy(
                        threads = markThreadStatus(state.threads, failedThreadId, "idle"),
                        pendingConversationStart = false,
                        chatDraft = restoredDraft ?: state.chatDraft,
                        events = removePendingOutgoingUserMessages(state.events, failedThreadId),
                        error = event.detail.ifBlank { event.text.ifBlank { "发送失败" } },
                    )
                    return@collect
                }
                if (event.type == "codex.status") {
                    refreshCodexStatus()
                }
                if (event.type == "project.changed" || event.type == "projects.changed") {
                    refreshProjectsSilently(activeClient)
                }
                val shouldSyncThreads = shouldRefreshThreadsForEvent(event)
                if (shouldSyncThreads) {
                    refreshThreadsSilently(activeClient)
                }
                val nextThread = nextActiveConversationThreadId(
                    currentThreadId = state.activeThreadId,
                    pendingConversationStart = state.pendingConversationStart,
                    event = event,
                )
                val nextThreads = if (event.type == "thread.started" && event.threadId.isNotBlank()) {
                    val existing = state.threads.filterNot { it.id == event.threadId }
                    val existingThread = state.threads.firstOrNull { it.id == event.threadId }
                    listOf(threadRecordFromStartedEvent(event, existingThread)) + existing
                } else if (event.type == "user.message" && event.threadId.isNotBlank()) {
                    markThreadStatus(state.threads, event.threadId, "running")
                } else if (event.type == "message.delta" && event.threadId.isNotBlank()) {
                    markThreadStatus(state.threads, event.threadId, "running")
                } else if (event.type == "turn.completed" && event.threadId.isNotBlank()) {
                    markThreadStatus(state.threads, event.threadId, event.status.ifBlank { "completed" })
                } else {
                    state.threads
                }
                if (event.type == "user.message" && event.text.isNotBlank()) {
                    confirmPendingOutgoingDraft(event.threadId, event.text)
                }
                val threadChanged = nextThread != state.activeThreadId
                if (threadChanged) {
                    persistCurrentChatDraft()
                }
                val nextProjectId = if (threadChanged) {
                    projectIdForThread(nextThreads, nextThread)
                } else {
                    state.activeProjectId
                }
                val pendingAwareEvents = if (event.type == "thread.started" && event.threadId == nextThread && state.pendingConversationStart) {
                    movePendingOutgoingUserMessagesToThread(state.events, event.threadId)
                } else {
                    state.events
                }
                val baseEvents = if (event.type == "user.message") {
                    removeConfirmedPendingOutgoingUserMessages(pendingAwareEvents, event)
                } else {
                    pendingAwareEvents
                }
                val nextEvents = if (isStateEventWorthKeeping(event)) {
                    appendEvent(baseEvents, event).takeLast(500)
                } else {
                    baseEvents
                }
                state = state.copy(
                    events = nextEvents,
                    activeThreadId = nextThread,
                    activeProjectId = nextProjectId,
                    chatDraft = if (threadChanged) {
                        connectionStore.chatDraft(chatDraftKey(nextThread, nextProjectId))
                    } else {
                        state.chatDraft
                    },
                    pendingConversationStart = if (event.type == "connection.closed" || event.type == "connection.failed") {
                        false
                    } else if (event.threadId.isNotBlank() && event.threadId == nextThread && event.type in setOf("thread.started", "user.message", "message.delta", "turn.completed")) {
                        false
                    } else {
                        state.pendingConversationStart
                    },
                    threads = nextThreads,
                )
            }
        }
    }

    private fun handleRealtimeDisconnected(reason: String) {
        if (state.loading) {
            return
        }
        val nextAttempt = (state.reconnectAttempt + 1).coerceAtLeast(1)
        val restoredDraft = restorePendingOutgoingDraft(state.activeThreadId)
        state = state.copy(
            connected = false,
            reconnecting = true,
            reconnectAttempt = nextAttempt,
            pendingConversationStart = false,
            chatDraft = restoredDraft ?: state.chatDraft,
            events = removePendingOutgoingUserMessages(state.events, state.activeThreadId),
            error = reason,
        )
        scheduleReconnect(nextAttempt)
    }

    private fun realtimeUnavailableMessage(): String {
        return if (state.reconnecting) {
            "实时连接正在重连，稍后再发送。"
        } else {
            "实时连接未就绪，请重新连接 Gateway。"
        }
    }

    private fun currentChatDraftKey(): String {
        return chatDraftKey(state.activeThreadId, state.activeProjectId)
    }

    private fun persistCurrentChatDraft() {
        connectionStore.saveChatDraft(currentChatDraftKey(), state.chatDraft)
    }

    private fun rememberPendingOutgoingDraft(key: String, prompt: String) {
        if (prompt.isNotBlank()) {
            pendingOutgoingDrafts[key] = prompt
        }
    }

    private fun confirmPendingOutgoingDraft(threadId: String, prompt: String) {
        val threadKey = chatDraftKey(threadId, projectIdForThread(state.threads, threadId))
        pendingOutgoingDrafts.remove(threadKey)
        pendingOutgoingDrafts.entries.removeAll { it.value == prompt }
    }

    private fun restorePendingOutgoingDraft(threadId: String): String? {
        val keys = listOf(
            chatDraftKey(threadId, projectIdForThread(state.threads, threadId)),
            currentChatDraftKey(),
            chatDraftKey("", state.activeProjectId),
            "global",
        ).distinct()
        for (key in keys) {
            val draft = pendingOutgoingDrafts.remove(key)
            if (!draft.isNullOrBlank()) {
                connectionStore.saveChatDraft(key, draft)
                return if (state.chatDraft.isBlank()) draft else null
            }
        }
        return null
    }

    private fun projectForNewThread(): Project? {
        return state.projects.firstOrNull { it.id == state.activeProjectId && isUsableHomeProject(it) } ?: state.projects.firstOrNull(::isUsableHomeProject)
    }

    private fun projectIdForThread(threads: List<ThreadRecord>, threadId: String): String {
        val projectPath = threads.firstOrNull { it.id == threadId }?.projectPath.orEmpty()
        if (projectPath.isBlank()) {
            return state.activeProjectId
        }
        return state.projects.firstOrNull { it.path == projectPath && isUsableHomeProject(it) }?.id ?: state.activeProjectId
    }

    private fun scheduleReconnect(attempt: Int) {
        if (reconnectJob?.isActive == true) {
            return
        }
        reconnectJob = viewModelScope.launch {
            delay(reconnectDelayMillis(attempt - 1))
            reconnectOnce(attempt)
        }
    }

    private fun reconnectOnce(attempt: Int) {
        val baseUrl = state.baseUrl.trimEnd('/')
        val token = state.token.trim()
        if (baseUrl.isBlank() || token.isBlank()) {
            state = state.copy(connected = false, reconnecting = false)
            return
        }
        val nextClient = GatewayClient(baseUrl, token, state.trustSelfSigned)
        client = nextClient
        eventsJob?.cancel()
        viewModelScope.launch {
            runCatching {
                val health = withContext(Dispatchers.IO) { nextClient.health() }
                if (!isProtocolCompatible(health)) {
                    error("Gateway 协议不兼容：服务端 ${health.protocolVersion}，手机端 $supportedProtocolVersion。请升级其中一端。")
                }
                val projects = withContext(Dispatchers.IO) { nextClient.listProjects() }
                val threads = withContext(Dispatchers.IO) { nextClient.listThreads() }
                val codexStatus = withContext(Dispatchers.IO) { nextClient.codexStatus() }
                val terminalCommands = withContext(Dispatchers.IO) { nextClient.terminalCommands() }
                ReconnectSnapshot(health, projects, threads, codexStatus, terminalCommands)
            }.onSuccess { snapshot ->
                state = state.copy(
                    connected = true,
                    reconnecting = false,
                    reconnectAttempt = 0,
                    gatewayHealth = snapshot.health,
                    projects = snapshot.projects,
                    threads = snapshot.threads,
                    codexStatus = snapshot.codexStatus,
                    terminalCommands = snapshot.terminalCommands,
                    error = "",
                )
                subscribeEvents(nextClient)
            }.onFailure { error ->
                val nextAttempt = attempt + 1
                state = state.copy(
                    connected = false,
                    reconnecting = true,
                    reconnectAttempt = nextAttempt,
                    error = error.message.orEmpty().ifBlank { "正在重连 Gateway" },
                )
                reconnectJob = null
                scheduleReconnect(nextAttempt)
            }
        }
    }

    private fun refreshThreadsSilently(activeClient: GatewayClient) {
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.listThreads() }
            }.onSuccess {
                state = state.copy(
                    threads = it,
                    activeProjectId = projectIdForThread(it, state.activeThreadId),
                )
            }
        }
    }

    private fun refreshProjectsSilently(activeClient: GatewayClient) {
        viewModelScope.launch {
            runCatching {
                val projects = withContext(Dispatchers.IO) { activeClient.listProjects() }
                val roots = withContext(Dispatchers.IO) { activeClient.listProjectRoots() }
                projects to roots
            }.onSuccess { (projects, roots) ->
                val activeProjectId = activeProjectIdAfterRefresh(state.activeProjectId, projects)
                state = state.copy(
                    projects = projects,
                    projectRoots = roots,
                    activeProjectId = activeProjectId,
                    filePath = if (activeProjectId.isBlank()) "" else state.filePath,
                    files = if (activeProjectId.isBlank()) emptyList() else state.files,
                    openedFile = if (activeProjectId.isBlank()) FileContent() else state.openedFile,
                    filePreviewUrl = if (activeProjectId.isBlank()) "" else state.filePreviewUrl,
                    error = "",
                )
            }
        }
    }

    private fun loadFiles(projectId: String, path: String) {
        val activeClient = client ?: return
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { activeClient.listFiles(projectId, path) }
            }.onSuccess {
                state = state.copy(files = it)
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }

    private fun refreshDiffState(selectedPath: String) {
        val activeClient = client ?: return
        val projectId = state.activeProjectId
        if (projectId.isBlank()) return
        viewModelScope.launch {
            runCatching {
                val diff = withContext(Dispatchers.IO) { activeClient.readDiff(projectId) }
                val files = withContext(Dispatchers.IO) { activeClient.listDiffFiles(projectId) }
                val selectedEntry = files.find { it.path == selectedPath }
                val selected = selectedEntry?.let {
                    withContext(Dispatchers.IO) { activeClient.readFileDiff(projectId, it.path) }
                } ?: FileDiff()
                val hunks = selectedEntry?.let {
                    withContext(Dispatchers.IO) { activeClient.listFileDiffHunks(projectId, it.path) }
                } ?: emptyList()
                DiffRefresh(diff, files, selected, hunks)
            }.onSuccess { refresh ->
                state = state.copy(
                    projectDiff = refresh.diff,
                    diffFiles = refresh.files,
                    selectedFileDiff = refresh.selected,
                    selectedFileHunks = refresh.hunks,
                )
            }.onFailure {
                state = state.copy(error = it.message.orEmpty())
            }
        }
    }
}

private fun terminalCommandIdFromThreadId(threadId: String): String {
    val prefix = "terminal:"
    return if (threadId.startsWith(prefix)) threadId.removePrefix(prefix) else ""
}

private data class DiffRefresh(
    val diff: ProjectDiff,
    val files: List<DiffFileEntry>,
    val selected: FileDiff,
    val hunks: List<DiffHunk>,
)

private fun appendEvent(events: List<ChatEvent>, event: ChatEvent): List<ChatEvent> {
    val key = event.eventKey()
    if (shouldDeduplicateEvent(event) && events.any { it.eventKey() == key }) {
        return events
    }
    return events + event
}

private fun mergeEvents(left: List<ChatEvent>, right: List<ChatEvent>): List<ChatEvent> {
    var merged = emptyList<ChatEvent>()
    (left + right).forEach { event ->
        merged = appendEvent(merged, event)
    }
    return merged
}

private fun ChatEvent.eventKey(): String {
    return listOf(type, threadId, projectPath, stream, text, title, status, detail, itemId, commandId, cwd, command, createdAt, updatedAt, approvalId, approvalType, diff, files.joinToString("|")).joinToString("\u0001")
}

private fun markThreadStatus(threads: List<ThreadRecord>, threadId: String, status: String): List<ThreadRecord> {
    return threads.map { thread ->
        if (thread.id == threadId) thread.copy(status = status) else thread
    }
}

private fun resolveGatewayBaseUrl(hostInput: String, portInput: String, trustSelfSigned: Boolean): String {
    val host = hostInput.trim().trimEnd('/')
    if (host.isBlank()) {
        error("请输入电脑端 IP 或主机名。")
    }
    val candidates = gatewayBaseUrlCandidates(host, portInput)
    var lastError = ""
    for (candidate in candidates) {
        runCatching {
            GatewayClient(candidate, "", trustSelfSigned).health()
        }.onSuccess { health ->
            if (health.ok) {
                return candidate
            }
            lastError = "$candidate 健康检查未通过"
        }.onFailure {
            lastError = "${candidate}: ${it.message.orEmpty()}"
        }
    }
    error("无法连接 Gateway。已尝试：${candidates.joinToString("、")}。${lastError}")
}
