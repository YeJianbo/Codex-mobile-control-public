package com.localcodex.control

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resumeWithException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

internal class NativeFileReadException(val status:Int,val kind:String,message:String):IllegalStateException(message)

internal fun nativeCheckFileResponse(response:Response){
    if(response.isSuccessful)return
    val data=runCatching{JSONObject(response.peekBody(16L*1024).string())}.getOrNull()
    val message=(data?.opt("error") as? String)?.takeIf{it.isNotBlank()}
        ?:(data?.opt("message") as? String)?.takeIf{it.isNotBlank()}
        ?:"读取失败 (${response.code})"
    throw NativeFileReadException(response.code,data?.optString("kind").orEmpty(),message)
}

class GatewayClient(
    private val baseUrl: String,
    private val token: String,
    private val trustSelfSigned: Boolean = false,
    private val remotePassword: String = "",
    private val certificateSha256: String = "",
    private val useDeviceCertificate: Boolean = false,
) {
    @Volatile var cloudListError:String="";private set
    @Volatile internal var uploadOwner:String=""
    private val http = (if(certificateSha256.isNotBlank())pinnedOkHttpClient(certificateSha256) else if (trustSelfSigned) unsafeOkHttpClient() else defaultOkHttpClient())
        .newBuilder().eventListenerFactory{nativePerformanceListener(it.request(),remotePassword.isNotBlank())}.addInterceptor { chain ->
            val request=if(remotePassword.isNotBlank())chain.request().newBuilder().header("X-Remote-Password",remotePassword).build() else chain.request()
            chain.proceed(if(useDeviceCertificate)DeviceCertificate.sign(request) else request)
        }.build()
    private val connectionHttp=http.connectionTransport()
    internal fun desktopWebSocket(session:String,listener:WebSocketListener):WebSocket {
        val address=baseUrl.replace("http://","ws://").replace("https://","wss://")+"/ws/desktop?session="+session.urlEncode()
        return connectionHttp.newWebSocket(Request.Builder().url(address).header("Authorization","Bearer $token").build(),listener)
    }
    internal fun forkEventClient()=GatewayClient(baseUrl,token,trustSelfSigned,remotePassword,certificateSha256,useDeviceCertificate)
    private val jsonType = "application/json".toMediaType()
    @Volatile private var socket: WebSocket? = null
    @Volatile private var socketTrace:Pair<WebSocket,NativeSocketTrace>?=null
    private val socketDiagnostics=NativeSocketDiagnostics{path,done->
        val request=Request.Builder().url(baseUrl.trimEnd('/')+path).header("Authorization","Bearer $token").build()
        connectionHttp.newBuilder().callTimeout(3,TimeUnit.SECONDS).build().newCall(request).enqueue(object:okhttp3.Callback{
            override fun onFailure(call:okhttp3.Call,e:java.io.IOException){done(false)}
            override fun onResponse(call:okhttp3.Call,response:Response){response.use{done(it.isSuccessful)}}
        })
    }
    @Volatile private var focusedEvents=false
    private val eventFocus=NativeEventFocus()
    private val eventActivity=NativeEventConnectionActivity{android.os.SystemClock.elapsedRealtime()}
    private val eventProbes=mutableMapOf<String,Pair<WebSocket,CompletableDeferred<Boolean>>>()
    private val sidebarPages=linkedMapOf<String,JSONObject>()
    private suspend fun sidebarRequest(path:String):JSONObject {
        val previous=synchronized(sidebarPages){sidebarPages[path]}
        val revision=previous?.optString("sidebarRevision").orEmpty()
        val response=JSONObject(requestAsync("GET",path+"&delta=1"+if(revision.isBlank())"" else "&since="+revision.urlEncode()))
        val page=mergeSidebarDelta(previous,response)
        synchronized(sidebarPages){
            sidebarPages.remove(path);sidebarPages[path]=page
            while(sidebarPages.size>64)sidebarPages.remove(sidebarPages.keys.first())
        }
        return page
    }

    fun health(): GatewayHealth {
        return healthCall().execute().use{parseHealth(it.requireBody())}
    }

    suspend fun probeHealth():GatewayHealth = suspendCancellableCoroutine{continuation->
        val call=healthCall()
        continuation.invokeOnCancellation{call.cancel()}
        call.enqueue(object:okhttp3.Callback{
            override fun onFailure(call:okhttp3.Call,e:java.io.IOException){continuation.resumeWithException(e)}
            override fun onResponse(call:okhttp3.Call,response:Response){
                val result=runCatching{response.use{parseHealth(it.requireBody())}}
                continuation.resumeWith(result)
            }
        })
    }

    private fun healthCall():okhttp3.Call {
        // Public TLS may include DNS, edge connection and tunnel setup. Keep the
        // short LAN probe without applying its deadline to the public route.
        val publicConnection=remotePassword.isNotBlank()
        return connectionHttp.newBuilder().connectTimeout(if(publicConnection)10 else 3,TimeUnit.SECONDS)
            .readTimeout(if(publicConnection)10 else 4,TimeUnit.SECONDS)
            .callTimeout(if(publicConnection)15 else 5,TimeUnit.SECONDS).build()
            .newCall(Request.Builder().url(baseUrl.trimEnd('/')+"/health").get().build())
    }

    private fun parseHealth(body:String):GatewayHealth {
        val item=JSONObject(body)
        return GatewayHealth(
            ok = item.optBoolean("ok", false),
            version = item.optString("version"),
            protocolVersion = item.optInt("protocolVersion", 0),
            minAndroidProtocolVersion = item.optInt("minAndroidProtocolVersion", 0),
            capabilities = item.optStringArray("capabilities"),
        )
    }

    fun listProjects(): List<Project> {
        val response = request("GET", "/api/projects")
        val projects = JSONObject(response).getJSONArray("projects")
        return (0 until projects.length()).map { index ->
            val item = projects.getJSONObject(index)
            Project(
                id = item.getString("id"),
                name = item.getString("name"),
                path = item.getString("path"),
                trusted = item.optBoolean("trusted", false),
            )
        }
    }

    fun addProject(path: String,create:Boolean=false): Project {
        val response = request("POST", "/api/projects", JSONObject().put("path", path).put("create",create))
        val item = JSONObject(response).getJSONObject("project")
        return Project(
            id = item.getString("id"),
            name = item.getString("name"),
            path = item.getString("path"),
            trusted = item.optBoolean("trusted", false),
        )
    }

    fun listProjectRoots(): List<ProjectRoot> {
        val roots = JSONObject(request("GET", "/api/config/project-roots")).getJSONArray("roots")
        return (0 until roots.length()).map { index ->
            roots.getJSONObject(index).toProjectRoot()
        }
    }

    fun addProjectRoot(path: String): List<ProjectRoot> {
        val roots = JSONObject(request("POST", "/api/config/project-roots", JSONObject().put("path", path))).getJSONArray("roots")
        return (0 until roots.length()).map { index ->
            roots.getJSONObject(index).toProjectRoot()
        }
    }

    fun removeProjectRoot(path: String): List<ProjectRoot> {
        val roots = JSONObject(request("DELETE", "/api/config/project-roots?path=${path.urlEncode()}")).getJSONArray("roots")
        return (0 until roots.length()).map { index ->
            roots.getJSONObject(index).toProjectRoot()
        }
    }

    fun readSettings(): ControlSettings {
        val item = JSONObject(request("GET", "/api/settings/user")).getJSONObject("settings")
        return ControlSettings(
            model = item.optString("model"),
            modelProvider = item.optString("modelProvider"),
            providerBaseUrl = item.optString("providerBaseUrl"),
            approvalPolicy = item.optString("approvalPolicy"),
            sandboxMode = item.optString("sandboxMode"),
            reasoningEffort = item.optString("reasoningEffort"),
            networkAccess = item.optBoolean("networkAccess", false),
            disableResponseStorage = item.optBoolean("disableResponseStorage", false),
        )
    }

    fun readApprovalSummary(): ApprovalPolicySummary {
        val item = JSONObject(request("GET", "/api/settings/approval-summary")).getJSONObject("summary")
        return ApprovalPolicySummary(
            approvalPolicy = item.optString("approvalPolicy"),
            approvalLabel = item.optString("approvalLabel"),
            approvalRisk = item.optString("approvalRisk", "unknown"),
            sandboxMode = item.optString("sandboxMode"),
            sandboxLabel = item.optString("sandboxLabel"),
            networkAccess = item.optBoolean("networkAccess", false),
            summary = item.optString("summary"),
            recommendation = item.optString("recommendation"),
        )
    }

    fun readRawSettings(): RawCodexConfig {
        val item = JSONObject(request("GET", "/api/settings/user/raw")).getJSONObject("config")
        return RawCodexConfig(
            path = item.optString("path"),
            content = item.optString("content"),
        )
    }

    fun readHttpsConfig(): GatewayHttpsConfig {
        val item = JSONObject(request("GET", "/api/config/https")).getJSONObject("https")
        return item.toGatewayHttpsConfig()
    }

    fun saveHttpsConfig(enabled: Boolean, generateSelfSigned: Boolean): GatewayHttpsConfig {
        val item = JSONObject(
            request(
                "PUT",
                "/api/config/https",
                JSONObject()
                    .put("enabled", enabled)
                    .put("generateSelfSigned", generateSelfSigned),
            )
        ).getJSONObject("https")
        return item.toGatewayHttpsConfig()
    }

    fun codexStatus(): CodexStatus {
        val item = JSONObject(request("GET", "/api/codex/status")).getJSONObject("codex")
        return item.toCodexStatus()
    }

    fun codexCompatibility(): CodexCompatibility {
        val item = JSONObject(request("GET", "/api/codex/compatibility")).getJSONObject("compatibility")
        return item.toCodexCompatibility()
    }

    fun codexUpgradeCheck(): CodexUpgradeCheck {
        val item = JSONObject(request("GET", "/api/codex/upgrade-check")).getJSONObject("upgrade")
        return item.toCodexUpgradeCheck()
    }

    fun startCodex(): CodexStatus {
        val item = JSONObject(request("POST", "/api/codex/start",timeoutSeconds=65)).getJSONObject("codex")
        return item.toCodexStatus()
    }

    fun restartCodex(): CodexStatus {
        val item = JSONObject(request("POST", "/api/codex/restart")).getJSONObject("codex")
        return item.toCodexStatus()
    }
    fun sharedBackendRestart(planId:String?=null):JSONObject=JSONObject(request("POST",
        if(planId==null)"/api/local-console/backend/restart-preview" else "/api/local-console/backend/restart",
        if(planId==null)JSONObject() else JSONObject().put("planId",planId),timeoutSeconds=if(planId==null)75 else 150))
    fun agentHealth(force:Boolean=false):JSONObject=JSONObject(request("GET","/api/agents/health"+if(force)"?refresh=1" else "",timeoutSeconds=75))
    fun checkAgentUpdates():JSONObject=JSONObject(request("GET","/api/agents/updates?refresh=1",timeoutSeconds=45))

    fun claimPairing(code: String, name: String = "Android"): PairingResult {
        val body = JSONObject()
            .put("code", code)
            .put("name", name)
            .apply{if(useDeviceCertificate)put("certificate",DeviceCertificate.certificateBase64())}
        val item = JSONObject(publicRequest("POST", "/api/pair/claim", body))
        val device = item.getJSONObject("device")
        return PairingResult(
            token = item.getString("token"),
            deviceId = device.getString("id"),
            deviceName = device.optString("name"),
        )
    }

    fun listDevices(): List<DeviceRecord> {
        val devices = JSONObject(request("GET", "/api/devices")).getJSONArray("devices")
        return (0 until devices.length()).map { index ->
            devices.getJSONObject(index).toDeviceRecord()
        }
    }

    fun revokeDevice(deviceId: String): DeviceRecord {
        val device = JSONObject(request("DELETE", "/api/devices/${deviceId.urlEncode()}")).getJSONObject("device")
        return device.toDeviceRecord()
    }

    fun rotateToken(): TokenRotationResult {
        val item = JSONObject(request("POST", "/api/auth/token/rotate"))
        return TokenRotationResult(
            kind = item.optString("kind"),
            token = item.getString("token"),
            device = item.optJSONObject("device")?.toDeviceRecord(),
        )
    }

    fun listThreads(): List<ThreadRecord> = parseThreads(JSONObject(request("GET", "/api/threads")))
    suspend fun listThreadsAsync():List<ThreadRecord> = withContext(Dispatchers.Default){parseThreads(JSONObject(requestAsync("GET","/api/threads")))}
    fun markThreadRead(threadId:String,completedAt:Long):Long = JSONObject(request("POST","/api/threads/${threadId.urlEncode()}/read",JSONObject().put("completedAt",completedAt))).optLong("readThrough")

    suspend fun sidebarPins():List<String>{
        val pins=JSONObject(requestAsync("GET","/api/sidebar/pins")).getJSONArray("pinned")
        return (0 until pins.length()).map{pins.getString(it)}
    }

    suspend fun sidebarThreads(limit:Int,agent:String,include:String,project:String="",filter:NativeThreadFilter=NativeThreadFilter.ALL):Pair<List<ThreadRecord>,Boolean> {
        val result=sidebarRequest("/api/threads?limit=$limit&agent=${agent.urlEncode()}&include=${include.urlEncode()}${if(project.isNotBlank())"&project="+project.urlEncode() else ""}${if(filter!=NativeThreadFilter.ALL)"&filter="+filter.wire else ""}")
        cloudListError=result.optString("cloudError")
        return parseThreads(result) to result.optBoolean("hasMore")
    }
    suspend fun sidebarUnreadThreads(limit:Int):Pair<List<ThreadRecord>,Boolean> {
        val result=sidebarRequest("/api/threads?limit=$limit&filter=unread")
        return withContext(Dispatchers.Default){parseThreads(result) to result.optBoolean("hasMore")}
    }
    suspend fun sidebarProjectPage(limit:Int,include:String,threadId:String,keep:Set<String> = emptySet()):Triple<List<Project>,List<Project>,Boolean> {
        val result=sidebarRequest("/api/sidebar?limit=$limit&include=${include.urlEncode()}&threadId=${threadId.urlEncode()}&keep=${keep.sorted().joinToString(",").urlEncode()}")
        fun projects(key:String):List<Project>{
            val rows=result.optJSONArray(key)?:JSONArray()
            return (0 until rows.length()).map { val p=rows.getJSONObject(it); Project(p.optString("id"),p.optString("name"),p.optString("path"),p.optBoolean("trusted")) }
        }
        return Triple(projects("projects"),projects("allowedProjects"),result.optBoolean("hasMore"))
    }
    private fun parseThreads(result:JSONObject):List<ThreadRecord> {
        val threads=result.getJSONArray("threads")
        return (0 until threads.length()).map { index ->
            val item = threads.getJSONObject(index)
            ThreadRecord(
                id = item.getString("id"),
                projectPath = item.optString("projectPath"),
                title = nativeDisplayThreadTitle(item.optString("title"),""),
                status = item.optString("status"),
                updatedAt = item.optString("updatedAt"),
                unread = item.optBoolean("unread"),
                completedAt = item.optLong("completedAt"),
                source = item.optString("source"),
                readOnly = item.optBoolean("readOnly") || nativeReadOnlyThreadId(item.optString("id")),
                snapshotUpdatedAt = item.optString("snapshotUpdatedAt"),
                snapshotStatus = item.optString("snapshotStatus"),
                snapshotStale = item.optBoolean("snapshotStale"),
                snapshotContentKind = item.optString("snapshotContentKind", "summary"),
                pinnedIndex = item.optInt("pinnedIndex", -1),
                subagent = item.optJSONObject("subagent")?.toSubagent(),
                goal = item.optJSONObject("goal")?.toNativeGoal(),
            )
        }
    }

    suspend fun searchThreads(query: String, agent: String?, limit: Int = 12): List<ThreadMatch> = withContext(Dispatchers.IO) {
        val path = buildString {
            append("/api/threads/search?q=")
            append(query.trim().urlEncode())
            if (!agent.isNullOrBlank()) append("&agent=").append(agent.urlEncode())
            append("&limit=").append(limit.coerceIn(1, 30))
        }
        val matches = JSONObject(requestAsync("GET", path)).getJSONArray("matches")
        (0 until matches.length()).map { index ->
            val item = matches.getJSONObject(index)
            ThreadMatch(
                threadId = item.getString("threadId"),
                title = nativeDisplayThreadTitle(item.optString("title"),""),
                snippet = item.optString("snippet"),
                updatedAt = item.optString("updatedAt"),
            )
        }
    }

    fun eventsForThread(threadId: String): List<ChatEvent> {
        val events = JSONObject(request("GET", "/api/threads/$threadId/events")).getJSONArray("events")
        return (0 until events.length()).map { index ->
            events.getJSONObject(index).toChatEvent()
        }
    }

    fun renameThread(threadId: String, title: String): ThreadRecord {
        val item = JSONObject(
            request("PATCH", "/api/threads/${threadId.urlEncode()}", JSONObject().put("title", title))
        ).getJSONObject("thread")
        return item.toThreadRecord()
    }

    fun deleteThread(threadId: String) {
        request("DELETE", "/api/threads/${threadId.urlEncode()}")
    }
    fun archiveThread(threadId:String):JSONObject=JSONObject(request("POST","/api/threads/${threadId.urlEncode()}/archive",JSONObject()))
    fun subagentClosePreview(threadId:String):JSONObject=nativeJson("GET","/api/threads/${threadId.urlEncode()}/close-preview")
    fun closeSubagent(threadId:String,parentThreadId:String,stopRunning:Boolean):JSONObject=nativeJson("POST","/api/threads/${threadId.urlEncode()}/close",JSONObject().put("parentThreadId",parentThreadId).put("stopRunning",stopRunning))
    suspend fun archivedThreads(agent:String):List<ThreadRecord> = parseThreads(nativeJsonAsync("GET","/api/threads/archived?agent=${agent.urlEncode()}"))
    fun restoreArchivedThread(threadId:String){request("POST","/api/threads/${threadId.urlEncode()}/unarchive",JSONObject())}
    fun markThreadUnread(threadId:String):Long = nativeJson("POST","/api/threads/${threadId.urlEncode()}/unread",JSONObject()).optLong("completedAt")
    fun moveThread(threadId:String,body:JSONObject){request("POST","/api/threads/${threadId.urlEncode()}/move",body)}

    fun terminalHistory(limit: Int = 500): List<ChatEvent> {
        val events = JSONObject(request("GET", "/api/terminal/history?limit=$limit")).getJSONArray("events")
        return (0 until events.length()).map { index ->
            events.getJSONObject(index).toChatEvent()
        }
    }

    fun terminalCommands(limit: Int = 100): List<TerminalCommandRecord> {
        val commands = JSONObject(request("GET", "/api/terminal/commands?limit=$limit&includeOutput=false&previewChars=12000")).getJSONArray("commands")
        return (0 until commands.length()).map { index ->
            commands.getJSONObject(index).toTerminalCommandRecord()
        }
    }

    fun terminalCommandOutput(commandId: String, offset: Int, limit: Int = 16000): TerminalOutputPage {
        val item = JSONObject(
            request(
                "GET",
                "/api/terminal/commands/${commandId.urlEncode()}/output?offset=$offset&limit=$limit&stream=combined",
            )
        ).getJSONObject("output")
        return item.toTerminalOutputPage()
    }

    fun resumeThread(thread: ThreadRecord) {
        val body = JSONObject()
            .put("projectPath", thread.projectPath)
        request("POST", "/api/threads/${thread.id.urlEncode()}/resume", body)
    }

    fun listFiles(projectId: String, path: String = ""): List<FileEntry> {
        val files = JSONObject(request("GET", "/api/projects/$projectId/files?path=${path.urlEncode()}")).getJSONArray("files")
        return (0 until files.length()).map { index ->
            val item = files.getJSONObject(index)
            FileEntry(
                name = item.getString("name"),
                path = item.getString("path"),
                kind = item.getString("kind"),
                size = item.optLong("size", 0),
                modifiedAt = item.optString("modifiedAt"),
            )
        }
    }

    fun readFile(projectId: String, path: String): FileContent {
        val item = JSONObject(request("GET", "/api/projects/$projectId/file?path=${path.urlEncode()}"))
        return FileContent(path = path, content = item.optString("content"))
    }

    fun saveFile(projectId: String, path: String, content: String) {
        request("PUT", "/api/projects/$projectId/file?path=${path.urlEncode()}", JSONObject().put("content", content))
    }

    fun resolveApproval(approvalId: String, decision: String) {
        request("POST", "/api/approvals/${approvalId.urlEncode()}/resolve", JSONObject().put("decision", decision))
    }

    fun readDiff(projectId: String): ProjectDiff {
        val item = JSONObject(request("GET", "/api/projects/$projectId/diff"))
        return ProjectDiff(stat = item.optString("stat"), diff = item.optString("diff"))
    }

    fun listDiffFiles(projectId: String): List<DiffFileEntry> {
        val files = JSONObject(request("GET", "/api/projects/$projectId/diff/files")).getJSONArray("files")
        return (0 until files.length()).map { index ->
            val item = files.getJSONObject(index)
            DiffFileEntry(
                path = item.getString("path"),
                oldPath = item.optString("oldPath"),
                status = item.optString("status", "unknown"),
                additions = item.optInt("additions", 0),
                deletions = item.optInt("deletions", 0),
            )
        }
    }

    fun readFileDiff(projectId: String, path: String): FileDiff {
        val item = JSONObject(request("GET", "/api/projects/$projectId/diff/file?path=${path.urlEncode()}"))
        return FileDiff(path = item.optString("path"), diff = item.optString("diff"))
    }

    fun listFileDiffHunks(projectId: String, path: String): List<DiffHunk> {
        val hunks = JSONObject(request("GET", "/api/projects/$projectId/diff/file/hunks?path=${path.urlEncode()}")).getJSONArray("hunks")
        return (0 until hunks.length()).map { index ->
            val item = hunks.getJSONObject(index)
            DiffHunk(
                id = item.optString("id"),
                index = item.optInt("index"),
                source = item.optString("source"),
                header = item.optString("header"),
                text = item.optString("text"),
            )
        }
    }

    fun acceptFileDiff(projectId: String, path: String) {
        request("POST", "/api/projects/$projectId/diff/file/accept?path=${path.urlEncode()}")
    }

    fun revertFileDiff(projectId: String, path: String) {
        request("POST", "/api/projects/$projectId/diff/file/revert?path=${path.urlEncode()}")
    }

    fun acceptFileDiffs(projectId: String, paths: List<String>) {
        request("POST", "/api/projects/$projectId/diff/files/accept", JSONObject().put("paths", JSONArray(paths)))
    }

    fun revertFileDiffs(projectId: String, paths: List<String>) {
        request("POST", "/api/projects/$projectId/diff/files/revert", JSONObject().put("paths", JSONArray(paths)))
    }

    fun acceptFileDiffHunk(projectId: String, path: String, hunk: DiffHunk) {
        val body = JSONObject()
            .put("source", hunk.source)
            .put("index", hunk.index)
        request("POST", "/api/projects/$projectId/diff/file/hunk/accept?path=${path.urlEncode()}", body)
    }

    fun revertFileDiffHunk(projectId: String, path: String, hunk: DiffHunk) {
        val body = JSONObject()
            .put("source", hunk.source)
            .put("index", hunk.index)
        request("POST", "/api/projects/$projectId/diff/file/hunk/revert?path=${path.urlEncode()}", body)
    }

    fun runTerminalCommand(projectId: String, command: String): TerminalCommandResult {
        val item = JSONObject(
            request(
                "POST",
                "/api/projects/$projectId/terminal/run",
                JSONObject().put("command", command),
            )
        )
        return TerminalCommandResult(
            commandId = item.optString("commandId"),
            threadId = item.optString("threadId"),
            cwd = item.optString("cwd"),
            command = item.optString("command"),
        )
    }

    fun startTerminalSession(projectId: String): TerminalSessionResult {
        val item = JSONObject(request("POST", "/api/projects/$projectId/terminal/session"))
        return TerminalSessionResult(
            sessionId = item.optString("sessionId"),
            threadId = item.optString("threadId"),
            cwd = item.optString("cwd"),
            shell = item.optString("shell"),
            cols = item.optInt("cols"),
            rows = item.optInt("rows"),
            backend = item.optString("backend"),
        )
    }

    fun stopTerminalCommand(commandId: String) {
        request("POST", "/api/terminal/${commandId.urlEncode()}/stop")
    }

    fun sendTerminalSessionInput(sessionId: String, text: String, appendNewline: Boolean = true) {
        request(
            "POST",
            "/api/terminal/sessions/${sessionId.urlEncode()}/input",
            JSONObject()
                .put("text", text)
                .put("appendNewline", appendNewline),
        )
    }

    fun resizeTerminalSession(sessionId: String, cols: Int, rows: Int) {
        request(
            "POST",
            "/api/terminal/sessions/${sessionId.urlEncode()}/resize",
            JSONObject()
                .put("cols", cols)
                .put("rows", rows),
        )
    }

    fun stopTerminalSession(sessionId: String) {
        request("POST", "/api/terminal/sessions/${sessionId.urlEncode()}/stop")
    }

    fun rawFileUrl(projectId: String, path: String): String {
        return "${baseUrl.trimEnd('/')}/raw/projects/$projectId/file?path=${path.urlEncode()}&token=$token"
    }

    fun proxyPreviewUrl(url: String): String {
        return "${baseUrl.trimEnd('/')}/preview/proxy?url=${url.urlEncode()}&token=$token"
    }

    fun saveSettings(settings: ControlSettings): ControlSettings {
        val body = JSONObject()
            .put("model", settings.model)
            .put("modelProvider", settings.modelProvider)
            .put("providerBaseUrl", settings.providerBaseUrl)
            .put("approvalPolicy", settings.approvalPolicy)
            .put("sandboxMode", settings.sandboxMode)
            .put("reasoningEffort", settings.reasoningEffort)
            .put("networkAccess", settings.networkAccess)
            .put("disableResponseStorage", settings.disableResponseStorage)
        val item = JSONObject(request("PUT", "/api/settings/user", body)).getJSONObject("settings")
        return ControlSettings(
            model = item.optString("model"),
            modelProvider = item.optString("modelProvider"),
            providerBaseUrl = item.optString("providerBaseUrl"),
            approvalPolicy = item.optString("approvalPolicy"),
            sandboxMode = item.optString("sandboxMode"),
            reasoningEffort = item.optString("reasoningEffort"),
            networkAccess = item.optBoolean("networkAccess", false),
            disableResponseStorage = item.optBoolean("disableResponseStorage", false),
        )
    }

    fun saveRawSettings(content: String): RawCodexConfig {
        val item = JSONObject(
            request("PUT", "/api/settings/user/raw", JSONObject().put("content", content))
        ).getJSONObject("config")
        return RawCodexConfig(
            path = item.optString("path"),
            content = item.optString("content"),
        )
    }

    internal fun markEventDisconnect(cause:String){socketTrace?.second?.finish(cause)}
    private fun cancelEventSocket(active:WebSocket,cause:String,beforeCancel:()->Unit={}){
        socketTrace?.takeIf{it.first===active}?.second?.finish(cause)
        beforeCancel()
        active.cancel()
    }
    internal fun reconnectEvents() { socket?.let{cancelEventSocket(it,"requested_reconnect")} }
    internal fun discardIdleConnections(){connectionHttp.connectionPool.evictAll()}

    internal fun focusEvents(threadId:String){
        if(!focusedEvents)return
        val active=socket?:return
        eventFocus.request(active,threadId){id->
            active.send(JSONObject().put("type","thread.focus").put("requestId",id).put("threadId",threadId).toString())
        }
    }
    private suspend fun awaitEventFocus(threadId:String){
        if(!focusedEvents)return
        val active=socket?:return
        if(eventFocus.await(active,threadId,5000){if(socket===active)cancelEventSocket(active,"focus_timeout")})return
        throw java.net.SocketTimeoutException("会话订阅确认超时")
    }

    internal suspend fun verifyEventConnection(timeoutMillis:Long,onFailure:()->Unit={}):Boolean {
        val active=socket?:return false
        if(eventActivity.hasRecentTraffic(500))return true
        val id=java.util.UUID.randomUUID().toString()
        val reply=CompletableDeferred<Boolean>()
        synchronized(eventProbes){eventProbes[id]=active to reply}
        val alive=try{
            probeNativeConnection(timeoutMillis,
                {active.send(JSONObject().put("type","connection.ping").put("requestId",id).toString())},reply){
                // New data also proves liveness when a busy peer's probe reply is delayed.
                socket===active&&eventActivity.hasRecentTraffic(timeoutMillis)
            }
        }finally{synchronized(eventProbes){eventProbes.remove(id)}}
        // A late check must not cancel a replacement connection on the same client.
        if(!alive&&socket===active)cancelEventSocket(active,"foreground_probe_timeout",onFailure)
        return alive||socket?.let{it!==active}==true
    }

    fun events(deferActivities:Boolean=false,streamThreadId:String?=null,discardPendingOnClose:Boolean=false,traceLabel:String?=null): Flow<ChatEvent> = flow {
      val trace=NativeSocketTrace(traceLabel?:if(discardPendingOnClose||streamThreadId!="")"chat" else "notifications",BuildConfig.VERSION_NAME,
          {android.os.SystemClock.elapsedRealtime()},socketDiagnostics::record)
      emitAll(socketEvents(discardPendingOnClose=discardPendingOnClose,onBufferOverflow={trace.finish("event_queue_overflow")},
          onConsumerFailure={trace.finish("consumer_error",errorType=it.javaClass.simpleName)}) { emit,finish ->
        focusedEvents=streamThreadId!=null
        val wsUrl = baseUrl.replace("http://", "ws://").replace("https://", "wss://") + "/ws?token=$token&device=Android"+(if(deferActivities)"&activityDetails=deferred" else "")+(streamThreadId?.let{"&streamThread="+it.urlEncode()}?:"")
        val request = Request.Builder().url(wsUrl).build()
        val owner=Any()
        eventActivity.begin(owner)
        val activeSocket = connectionHttp.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                socketDiagnostics.flush()
                emit(ChatEvent(type = "connection.opened", status = response.code.toString()))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    val message=JSONObject(text)
                    trace.received()
                    eventActivity.received(owner)
                    if(message.optString("type")=="connection.pong"){
                        synchronized(eventProbes){eventProbes[message.optString("requestId")]?.takeIf{it.first===webSocket}?.second}?.complete(true)
                    }else if(message.optString("type")=="thread.focused"){
                        eventFocus.acknowledge(webSocket,message.optString("requestId"),message.optString("threadId"))
                    }else if(nativeSocketEventRelevant(message.optString("type"),message.optString("commandId"),
                        notificationsOnly=streamThreadId==""&&!discardPendingOnClose))emit(message.toChatEvent())
                    else Unit
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                trace.finish("peer_close",code)
                eventActivity.close(owner)
                emit(ChatEvent(type = "connection.closed", status = code.toString(), detail = reason))
                finish(null)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { eventActivity.close(owner);webSocket.close(code, reason) }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                trace.finish(nativeSocketFailureCause(t),response?.code,t.javaClass.simpleName)
                eventActivity.close(owner)
                emit(ChatEvent(type = "connection.failed", status = response?.code?.toString().orEmpty(), detail = t.message.orEmpty()))
                finish(t)
            }
        })
        socket=activeSocket
        socketTrace=activeSocket to trace
        val disconnect:()->Unit = {
            eventActivity.close(owner)
            eventFocus.close(activeSocket)
            synchronized(eventProbes){eventProbes.values.filter{it.first===activeSocket}.map{it.second}}.forEach{it.complete(false)}
            trace.finish("collector_cancelled")
            activeSocket.cancel()
            if(socket===activeSocket){socket=null;socketTrace=null}
        }
        disconnect
      })
    }

    fun startThread(project: Project? = null, model: String = "", initialText: String = ""): Boolean {
        return sendSocketMessage(
            JSONObject()
                .put("type", "thread.start")
                .put("projectPath", project?.path ?: "")
                .put("model", model)
                .put("initialText", initialText),
        )
    }

    fun sendTurn(thread: ThreadRecord, text: String, model: String = ""): Boolean {
        return sendSocketMessage(
            JSONObject()
                .put("type", "turn.start")
                .put("threadId", thread.id)
                .put("projectPath", thread.projectPath)
                .put("model", model)
                .put("text", text),
        )
    }

    fun interruptTurn(threadId: String, requestId: String = ""): Boolean {
        return sendSocketMessage(
            JSONObject()
                .put("type", "turn.interrupt")
                .put("threadId", threadId).put("requestId",requestId.ifBlank{null}),
        )
    }

    fun sendEcho(text: String): Boolean {
        return sendSocketMessage(
            JSONObject()
                .put("type", "debug.echo")
                .put("threadId", "debug")
                .put("text", text),
        )
    }

    fun sendSocketMessage(message: JSONObject): Boolean {
        return socket?.send(message.toString()) == true
    }

    var nativeBackendStatuses:List<NativeBackend> = emptyList()
        private set
    private val modelReadMutex=Mutex()
    private var cachedModels:List<NativeModel>?=null
    private var modelsReadAt=0L
    private data class ModelCatalog(val models:List<NativeModel>,val backends:List<NativeBackend>,val pending:Set<String> = emptySet())
    suspend fun nativeModelUpdates(refresh:Boolean=false,onUpdate:(List<NativeModel>,Set<String>)->Unit):List<NativeModel> {
        val cached=if(refresh)null else modelReadMutex.withLock{
            cachedModels?.takeIf{android.os.SystemClock.elapsedRealtime()-modelsReadAt<60000}
        }
        if(cached!=null){onUpdate(cached,emptySet());return cached}
        return withTimeoutOrNull(65000L){
        var first=true
        var previous:ModelCatalog?=null
        var catalog:ModelCatalog
        do{
            val path="/api/models?agents=all&partial=1"+if(first&&refresh)"&refresh=1" else ""
            catalog=withContext(Dispatchers.Default){parseNativeModels(requestAsync("GET",path,timeoutSeconds=10))}
            if(catalog.pending.isEmpty())check(catalog.models.isNotEmpty()){"电脑没有返回可选模型，请重试"}
            nativeBackendStatuses=catalog.backends.map{backend->if(backend.agent in catalog.pending)nativeBackendStatuses.find{it.agent==backend.agent}?:backend else backend}
            if(catalog!=previous){onUpdate(catalog.models,catalog.pending);previous=catalog}
            first=false
            if(catalog.pending.isNotEmpty())delay(600)
        }while(catalog.pending.isNotEmpty())
        modelReadMutex.withLock{cachedModels=catalog.models;modelsReadAt=android.os.SystemClock.elapsedRealtime()}
        catalog.models
        }?:error("模型目录读取超时，请重试")
    }
    suspend fun nativeModelsAsync(refresh:Boolean=false):List<NativeModel> {
        val requestedAt=android.os.SystemClock.elapsedRealtime()
        return modelReadMutex.withLock {
            cachedModels?.let{if(modelsReadAt>=requestedAt||!refresh&&requestedAt-modelsReadAt<60000)return@withLock it}
            val catalog=withContext(Dispatchers.Default){parseNativeModels(requestAsync("GET","/api/models?agents=all"+if(refresh)"&refresh=1" else "",timeoutSeconds=65))}
            val models=catalog.models
            check(models.isNotEmpty()){"电脑没有返回可选模型，请重试"}
            nativeBackendStatuses=catalog.backends;cachedModels=models;modelsReadAt=android.os.SystemClock.elapsedRealtime()
            models
        }
    }
    fun nativeModels(refresh:Boolean=false): List<NativeModel> {
        return parseNativeModels(request("GET", "/api/models?agents=all"+if(refresh)"&refresh=1" else "",timeoutSeconds=65)).let{nativeBackendStatuses=it.backends;it.models}
    }
    private fun parseNativeModels(raw:String):ModelCatalog {
        val catalog = JSONObject(raw)
        val rows = catalog.getJSONArray("models")
        val backends = catalog.optJSONArray("backends")?:JSONArray()
        val statuses=(0 until backends.length()).map{backends.getJSONObject(it).let{row->NativeBackend(row.getString("agent"),row.optBoolean("available"),row.optString("reason"),row.optBoolean("installed"),if(row.has("supportsImages")&&!row.isNull("supportsImages"))row.getBoolean("supportsImages") else null,if(row.has("supportsPlanMode")&&!row.isNull("supportsPlanMode"))row.getBoolean("supportsPlanMode") else null)}}
        val models=(0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            val levels = row.optJSONArray("supportedReasoningEfforts") ?: JSONArray()
            NativeModel(row.getString("model"), row.optString("displayName"),
                (0 until levels.length()).map { levels.getJSONObject(it).getString("reasoningEffort") }, row.optString("defaultReasoningEffort"),row.optBoolean("available",true),row.optString("unavailableReason"),
                if(row.isNull("providerId"))"" else row.optString("providerId"),if(row.isNull("providerName"))"" else row.optString("providerName"),if(row.isNull("shortName"))"" else row.optString("shortName"),
                row.optString("harness").takeIf{it in nativeHarnesses}?:nativeAgent(row.getString("model")))
        }
        return ModelCatalog(models,statuses,catalog.optStringArray("pending").toSet())
    }

    fun nativeSend(thread: ThreadRecord?, project: Project?, text: String, model: String, effort: String, permission:String, requestId: String, images: List<NativeImage>, files:List<NativeUploadedFile>,mode:String="",fast:Boolean?=null): Boolean = sendSocketMessage(nativeCommand(thread?.id.orEmpty(),thread,project,text,model,effort,permission,requestId,images,files,mode,fast))

    fun nativeCommand(threadId:String,thread: ThreadRecord?, project: Project?, text: String, model: String, effort: String, permission:String, requestId: String, images: List<NativeImage>, files:List<NativeUploadedFile>,mode:String="",fast:Boolean?=null): JSONObject {
        val message = JSONObject().put("type", if (threadId.isBlank()) "thread.start" else "turn.start")
            .put("requestId", requestId).put("model", model).put("effort", effort.ifBlank { null }).put("permission",permission)
            .put("projectPath", (thread?.projectPath ?: project?.path).orEmpty().ifBlank { null })
            .put(if (threadId.isBlank()) "initialText" else "text", text)
            .put("images", JSONArray(images.map { JSONObject().put("id", it.id).put("name", it.name) }))
            .put("files", JSONArray(files.map { JSONObject().put("id",it.id).put("name",it.name).put("mime",it.mime).put("size",it.size) }))
        if(mode.isNotBlank())message.put("mode",mode)
        if(fast!=null)message.put("fast",fast)
        if (threadId.isNotBlank()) message.put("threadId", threadId)
        return message
    }

    suspend fun nativeUpload(bytes: ByteArray, mime: String, name: String,onProgress:((NativeUploadProgress)->Unit)?=null): NativeImage {
        val prepared=withContext(Dispatchers.Default){prepareNativeImageUpload(bytes)}
        val body=withContext(Dispatchers.Default){
            val data=android.util.Base64.encodeToString(prepared.bytes,android.util.Base64.NO_WRAP)
            JSONObject().put("name",name).put("dataUrl","data:${prepared.mime};base64,$data").toString().toRequestBody(jsonType)
        }
        return uploadResult(Request.Builder().url(baseUrl+"/api/uploads/images").header("Authorization","Bearer $token").header("X-Upload-Owner",uploadOwner).post(body).build(),onProgress){data->
            NativeImage(data.getString("id"),data.getString("name"))
        }
    }
    suspend fun nativeUploadFile(input:()->java.io.InputStream,mime:String,name:String,size:Long,onProgress:((NativeUploadProgress)->Unit)?=null):NativeUploadedFile {
        val body=nativeFileUploadBody(input,size)
        val request=Request.Builder().url(baseUrl+"/api/uploads/files").header("Authorization","Bearer $token")
            .header("X-Upload-Owner",uploadOwner)
            .header("X-File-Name",nativeUploadNameHeader(name)).header("X-File-Type",mime).post(body).build()
        return uploadResult(request,onProgress){data->
            NativeUploadedFile(data.getString("id"),data.getString("name"),data.getString("mime"),data.getLong("size"))
        }
    }
    private suspend fun <T> uploadResult(request:Request,onProgress:((NativeUploadProgress)->Unit)?,decode:(JSONObject)->T):T {
        val body=request.body
        val tracked=if(body!=null&&onProgress!=null)request.newBuilder().method(request.method,nativeUploadProgressBody(body,onProgress)).build() else request
        return awaitNativeUpload(http.newBuilder().writeTimeout(5,TimeUnit.MINUTES).build().newCall(tracked)){response->
            val raw=response.body?.string().orEmpty()
            val data=runCatching{JSONObject(raw)}.getOrNull()
            if(!response.isSuccessful){
                val message=(data?.opt("message") as? String)?.takeIf{it.isNotBlank()}?:(data?.opt("error") as? String)
                throw NativeUploadResponseException(response.code,nativeUploadHttpSummary(response.code,message),raw)
            }
            if(data==null)throw NativeUploadResponseException(response.code,"电脑返回了无法识别的上传结果",raw)
            try{decode(data)}catch(error:org.json.JSONException){throw NativeUploadResponseException(response.code,"上传结果缺少有效的附件信息",raw)}
        }
    }

    fun nativeBytes(endpoint: String): ByteArray = http.newBuilder().readTimeout(30,TimeUnit.SECONDS).build().newCall(Request.Builder().url(baseUrl + endpoint)
        .header("Authorization", "Bearer $token").build()).execute().use { response ->
        nativeCheckFileResponse(response)
        response.body?.bytes() ?: byteArrayOf()
    }

    // Images leave the page frequently. Cancel the actual HTTP call, not only its UI coroutine.
    internal suspend fun nativeImageBytes(endpoint:String,maxBytes:Long=32L*1024*1024):ByteArray =
        kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
            val call=http.newBuilder().callTimeout(15,TimeUnit.SECONDS).readTimeout(10,TimeUnit.SECONDS).build()
                .newCall(Request.Builder().url(baseUrl+endpoint).header("Authorization","Bearer $token").build())
            continuation.invokeOnCancellation{call.cancel()}
            call.enqueue(object:okhttp3.Callback {
                override fun onFailure(call:okhttp3.Call,error:java.io.IOException){continuation.resumeWith(Result.failure(error))}
                override fun onResponse(call:okhttp3.Call,response:okhttp3.Response){
                    val result=runCatching{response.use{
                        nativeCheckFileResponse(it)
                        val body=it.body?:error("图片内容为空")
                        require(body.contentLength()<=maxBytes){"图片超过本机预览大小限制"}
                        val output=java.io.ByteArrayOutputStream()
                        body.byteStream().use{input->val buffer=ByteArray(8192);var count=input.read(buffer)
                            while(count>=0){if(count>0){require(output.size().toLong()+count<=maxBytes){"图片超过本机预览大小限制"};output.write(buffer,0,count)};count=input.read(buffer)}
                        }
                        output.toByteArray()
                    }}
                    continuation.resumeWith(result)
                }
            })
        }

    internal suspend fun nativeDownload(endpoint:String,file:java.io.File,maxBytes:Long=100L*1024*1024,onProgress:((Long,Long)->Unit)?=null) =
        kotlinx.coroutines.suspendCancellableCoroutine<Unit> { continuation ->
            val call=http.newCall(Request.Builder().url(baseUrl+endpoint).header("Authorization","Bearer $token").build())
            continuation.invokeOnCancellation{call.cancel();file.delete()}
            call.enqueue(object:okhttp3.Callback {
                override fun onFailure(call:okhttp3.Call,error:java.io.IOException){
                    file.delete()
                    continuation.resumeWith(Result.failure(error))
                }
                override fun onResponse(call:okhttp3.Call,response:okhttp3.Response){
                    val result=runCatching {
                        response.use { writeNativeDownload(it,file,maxBytes,{continuation.isActive},onProgress) }
                    }
                    // Cancellation can occur while the file is open; retry cleanup after closing it.
                    if(result.isFailure||!continuation.isActive)file.delete()
                    continuation.resumeWith(result)
                }
            })
        }

    private fun writeNativeDownload(response:okhttp3.Response,file:java.io.File,maxBytes:Long,current:()->Boolean,onProgress:((Long,Long)->Unit)?=null) {
        if(!current())throw kotlinx.coroutines.CancellationException("文件读取已取消")
        nativeCheckFileResponse(response)
        val body=response.body ?: error("文件内容为空")
        require(body.contentLength()<0||body.contentLength()<=maxBytes){"文件超过 ${maxBytes/1024/1024} MB，请在电脑打开"}
        try {
            // Android may reclaim cache directories while the app remains alive.
            file.parentFile?.let{parent->check(parent.isDirectory||parent.mkdirs()){"无法创建下载目录，请清理存储空间后重试"}}
            body.byteStream().use { input -> file.outputStream().use { output ->
                val buffer=ByteArray(32768);var total=0L;var reportedAt=0L
                while(true){
                    if(!current())throw kotlinx.coroutines.CancellationException("文件读取已取消")
                    val count=input.read(buffer);if(count<0)break;total+=count
                    require(total<=maxBytes){"文件超过 ${maxBytes/1024/1024} MB，请在电脑打开"};output.write(buffer,0,count)
                    if(onProgress!=null){val now=android.os.SystemClock.elapsedRealtime();if(now-reportedAt>=150){reportedAt=now;onProgress(total,body.contentLength())}}
                }
                onProgress?.invoke(total,body.contentLength())
            }}
        }catch(error:Exception){file.delete();throw error}
    }

    fun nativeApproval(id: String, decision: String) { resolveApproval(id, decision) }
    fun nativeJson(method:String, endpoint:String, body:JSONObject?=null):JSONObject = JSONObject(request(method,endpoint,body))
    suspend fun nativeJsonAsync(method:String,endpoint:String,body:JSONObject?=null):JSONObject = JSONObject(requestAsync(method,endpoint,body))
    suspend fun managementRequest(route:String,body:JSONObject?=null):JSONObject = withContext(Dispatchers.Default) {
        val parsed=android.net.Uri.parse(route)
        require(route.startsWith("/api/mobile-management/")&&parsed.scheme==null&&parsed.host==null&&parsed.fragment==null&&
            parsed.pathSegments.none{it=="."||it==".."||it.contains('\\')||it.contains('/')}){"无效的管理请求地址"}
        // Management responses include full statistics; decoding must not occupy the caller's UI thread.
        JSONObject(requestAsync(if(body==null)"GET" else "POST",route,body,if(route=="/api/mobile-management/maintenance/backend/restart")150 else 65))
    }
    fun localConsoleInfo():ConsoleInfo=parseConsoleInfo(JSONObject(request("GET","/api/local-console/state",timeoutSeconds=60)))
    suspend fun localConsoleInfoAsync():ConsoleInfo=parseConsoleInfo(JSONObject(requestAsync("GET","/api/local-console/state",timeoutSeconds=60)))
    suspend fun accountsAsync(service:String):JSONObject=withContext(Dispatchers.Default){JSONObject(requestAsync("GET","/api/local-console/accounts/${service.urlEncode()}",timeoutSeconds=60))}
    fun accountAction(service:String,action:String,body:JSONObject):JSONObject=JSONObject(request("POST","/api/local-console/accounts/${service.urlEncode()}/${action.urlEncode()}",body,65))
    fun localConsoleStatistics(source:String,range:String,pricing:String):ConsoleStatistics=parseConsoleStatistics(JSONObject(request("GET","/api/local-console/statistics?source=$source&range=$range&pricing=$pricing",timeoutSeconds=60)))
    suspend fun localConsoleStatisticsAsync(source:String,range:String,pricing:String):ConsoleStatistics=parseConsoleStatistics(JSONObject(requestAsync("GET","/api/local-console/statistics?source=$source&range=$range&pricing=$pricing",timeoutSeconds=60)))
    fun localConsoleAction(action:String,id:String?=null,enabled:Boolean?=null):ConsoleInfo {
        val body=JSONObject().put("action",action);if(id!=null)body.put("id",id);if(enabled!=null)body.put("enabled",enabled)
        return parseConsoleInfo(JSONObject(request("POST","/api/local-console/actions",body,60)))
    }
    data class NativeHistory(val first:List<ChatEvent>,val second:String,val third:Boolean,val model:String,val effort:String,val actualModel:String="")
    fun nativeHistory(threadId:String,count:Int=60):NativeHistory {
        val result=nativeJson("GET","/api/threads/$threadId/events?count=$count");val rows=result.getJSONArray("events")
        return NativeHistory((0 until rows.length()).map{rows.getJSONObject(it).toChatEvent()},result.optString("status"),result.optBoolean("hasMore"),result.optJSONObject("settings")?.optString("model").orEmpty(),result.optJSONObject("settings")?.optString("effort").orEmpty(),result.optJSONObject("settings")?.optString("actualModel").orEmpty())
    }
    suspend fun nativeHistoryAsync(threadId:String,count:Int=60):NativeHistory = withContext(Dispatchers.Default){
        parseConversationHistory(JSONObject(requestAsync("GET","/api/threads/${threadId.urlEncode()}/events?count=$count")))
    }
    fun nativeConversationHistory(threadId:String,turns:Int=10):NativeHistory {
        return parseConversationHistory(nativeJson("GET","/api/threads/${threadId.urlEncode()}/events?turns=$turns"))
    }
    suspend fun nativeConversationHistoryAsync(threadId:String,turns:Int=10):NativeHistory {
        awaitEventFocus(threadId)
        return parseConversationHistory(JSONObject(requestAsync("GET","/api/threads/${threadId.urlEncode()}/events?turns=$turns",timeoutSeconds=65)))
    }
    // Notifications read another conversation without changing the live stream focus.
    suspend fun nativeTaskHistoryAsync(threadId:String):List<ChatEvent> = withContext(Dispatchers.Default){
        parseConversationHistory(JSONObject(requestAsync("GET","/api/threads/${threadId.urlEncode()}/events?turns=2&activityDetails=deferred"))).first
    }
    private fun parseConversationHistory(result:JSONObject):NativeHistory {
        val rows=result.getJSONArray("events")
        return NativeHistory((0 until rows.length()).map{rows.getJSONObject(it).toChatEvent()},result.optString("status"),result.optBoolean("hasMore"),result.optJSONObject("settings")?.optString("model").orEmpty(),result.optJSONObject("settings")?.optString("effort").orEmpty(),result.optJSONObject("settings")?.optString("actualModel").orEmpty())
    }
    suspend fun nativeActivity(threadId:String,groupId:String="",eventIds:List<String> = emptyList()):List<ChatEvent> {
        val query=if(groupId.isNotBlank())"groupId="+groupId.urlEncode() else "eventIds="+JSONArray(eventIds).toString().urlEncode()
        val rows=nativeJsonAsync("GET","/api/threads/${threadId.urlEncode()}/activity?$query").getJSONArray("events")
        return (0 until rows.length()).map{rows.getJSONObject(it).toChatEvent().withNativeFileChanges()}
    }

    fun nativeSidebarProjects(): List<Project> {
        val rows = JSONObject(request("GET", "/api/sidebar")).optJSONArray("projects")?:JSONArray()
        return (0 until rows.length()).map { val p=rows.getJSONObject(it); Project(p.optString("id"),p.optString("name"),p.optString("path"),p.optBoolean("trusted")) }
    }

    private fun request(method: String, path: String, body: JSONObject? = null,timeoutSeconds:Long?=null): String {
        requestCall(method,path,body,timeoutSeconds).execute().use{return readResponse(it,path)}
    }
    private suspend fun requestAsync(method:String,path:String,body:JSONObject?=null,timeoutSeconds:Long?=null):String = suspendCancellableCoroutine { continuation ->
        val call=requestCall(method,path,body,timeoutSeconds)
        continuation.invokeOnCancellation{call.cancel()}
        call.enqueue(object:okhttp3.Callback{
            override fun onFailure(call:okhttp3.Call,e:java.io.IOException){if(continuation.isActive)continuation.resumeWithException(e)}
            override fun onResponse(call:okhttp3.Call,response:Response){
                val result=response.use{runCatching{readResponse(it,path)}}
                if(continuation.isActive)continuation.resumeWith(result)
            }
        })
    }
    private fun requestCall(method:String,path:String,body:JSONObject?,timeoutSeconds:Long?):okhttp3.Call {
        val builder = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
            .header("Authorization", "Bearer $token")

        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post((body ?: JSONObject()).toString().toRequestBody(jsonType))
            "PUT" -> builder.put((body ?: JSONObject()).toString().toRequestBody(jsonType))
            "PATCH" -> builder.patch((body ?: JSONObject()).toString().toRequestBody(jsonType))
            "DELETE" -> builder.delete((body ?: JSONObject()).toString().toRequestBody(jsonType))
        }

        val channel=http.requestTransport(connectionHttp,method,path)
        val transport=if(timeoutSeconds==null)channel else channel.newBuilder().readTimeout(timeoutSeconds,TimeUnit.SECONDS).callTimeout(timeoutSeconds,TimeUnit.SECONDS).build()
        return transport.newCall(builder.build())
    }
    private fun readResponse(response:Response,path:String):String {
            if(!response.isSuccessful&&path.startsWith("/api/local-console/")){
                val raw=response.body?.string().orEmpty()
                val detail=runCatching{JSONObject(raw).optString("error")}.getOrNull()?.takeIf{it.isNotBlank()}?.take(500)
                throw LocalConsoleRequestException(response.code,detail?:"HTTP ${response.code}")
            }
            return response.requireBody()
    }

    private fun publicRequest(method: String, path: String, body: JSONObject? = null): String {
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path)

        when (method) {
            "POST" -> builder.post((body ?: JSONObject()).toString().toRequestBody(jsonType))
            "GET" -> builder.get()
        }

        http.newCall(builder.build()).execute().use { response ->
            return response.requireBody()
        }
    }

    private fun Response.requireBody(): String {
        if (!isSuccessful) {
            val detail=runCatching{JSONObject(body?.string().orEmpty()).let{it.optString("message").ifBlank{it.optString("error")}}.takeIf{it.isNotBlank()}?.take(1000)}.getOrNull()
            error(detail?.let{"$it（HTTP $code）"}?:"HTTP $code")
        }
        return body?.string() ?: error("Empty response")
    }
}

private fun String.urlEncode(): String = java.net.URLEncoder.encode(this, "UTF-8")

private fun defaultOkHttpClient(): OkHttpClient {
    return OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
}

private fun pinnedOkHttpClient(fingerprint:String):OkHttpClient {
    val expected=fingerprint.replace(":","").lowercase()
    require(expected.matches(Regex("[0-9a-f]{64}"))) { "本地证书指纹无效" }
    val trustManager=object:X509TrustManager {
        override fun checkClientTrusted(chain:Array<out X509Certificate>?,authType:String?)=Unit
        override fun checkServerTrusted(chain:Array<out X509Certificate>?,authType:String?) {
            val certificate=chain?.firstOrNull()?:throw java.security.cert.CertificateException("缺少服务端证书")
            certificate.checkValidity()
            val actual=java.security.MessageDigest.getInstance("SHA-256").digest(certificate.encoded)
            val expectedBytes=expected.chunked(2).map{it.toInt(16).toByte()}.toByteArray()
            if(!java.security.MessageDigest.isEqual(actual,expectedBytes))throw java.security.cert.CertificateException("本地证书指纹不匹配")
        }
        override fun getAcceptedIssuers():Array<X509Certificate> = emptyArray()
    }
    val context=SSLContext.getInstance("TLS")
    context.init(null,arrayOf<TrustManager>(trustManager),SecureRandom())
    return OkHttpClient.Builder().sslSocketFactory(context.socketFactory,trustManager)
        .hostnameVerifier{_,_->true}.pingInterval(20,TimeUnit.SECONDS).build()
}

private fun unsafeOkHttpClient(): OkHttpClient {
    val trustManager = object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
    val sslContext = SSLContext.getInstance("TLS")
    sslContext.init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
    return OkHttpClient.Builder()
        .sslSocketFactory(sslContext.socketFactory, trustManager)
        .hostnameVerifier { _, _ -> true }
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
}

private fun JSONObject.optStringArray(name: String): List<String> {
    val array = optJSONArray(name) ?: return emptyList()
    return (0 until array.length()).map { index -> array.optString(index) }
}

private fun JSONObject.toChatEvent(): ChatEvent {
    val thread = optJSONObject("thread")
    return ChatEvent(
        type = optString("type"),
        threadId = optString("threadId"),
        turnId = optString("turnId"),
        projectPath = optString("projectPath").ifBlank { thread?.optString("projectPath").orEmpty() },
        stream = optString("stream"),
        text = optString("text").ifBlank { optString("message") },
        title = optString("title").ifBlank { thread?.optString("title").orEmpty() },
        status = optString("status").ifBlank { thread?.optString("status").orEmpty() },
        detail = optString("detail").ifBlank { optString("message") },
        willRetry = optBoolean("willRetry"),
        itemId = optString("itemId"),
        commandId = optString("commandId"),
        cwd = optString("cwd"),
        command = optString("command"),
        createdAt = optString("createdAt"),
        updatedAt = optString("updatedAt").ifBlank { thread?.optString("updatedAt").orEmpty() },
        readThrough = optLong("readThrough"),
        approvalId = optString("approvalId"),
        approvalType = optString("approvalType"),
        decision = optString("decision"),
        diff = optString("diff"),
        files = optStringArray("files"),
        eventId = optString("eventId"),
        requestId = optString("requestId"),
        replayed = optBoolean("replayed"),
        subagent = optBoolean("subagent"),
        messageSource = optJSONObject("messageSource")?.let{NativeMessageSource(it.optString("kind"),it.optString("name"),it.optString("threadId"),it.optString("avatar"),it.optString("automationId"))},
        timeUsedSeconds = if(isNull("timeUsedSeconds"))null else optLong("timeUsedSeconds"),
        detailsDeferred = optBoolean("detailsDeferred"),
        textComplete = optBoolean("textComplete"),
        activityGroupId = optString("activityGroupId"),
        activitySummary = optString("activitySummary"),
        activityCount = optInt("activityCount"),
        fileChanges = optJSONArray("fileChanges")?.let{a->(0 until a.length()).map{i->a.getJSONObject(i).let{NativeFileChange(it.getString("path"),if(it.isNull("added"))null else it.getInt("added"),if(it.isNull("removed"))null else it.getInt("removed"))}}}.orEmpty(),
        images = (optJSONArray("images") ?: JSONArray()).let { rows -> (0 until rows.length()).map { val image=rows.getJSONObject(it);NativeImage(image.getString("id"),image.optString("name","图片")) } },
        uploads = ((if(optString("type")=="user.message")optJSONArray("files") else null) ?: JSONArray()).let { rows -> (0 until rows.length()).mapNotNull { val file=rows.optJSONObject(it)?:return@mapNotNull null;NativeUploadedFile(file.optString("id"),file.optString("name"),file.optString("mime"),file.optLong("size")) } },
        questionReplies = (optJSONArray("questionReplies") ?: JSONArray()).let { rows -> (0 until rows.length()).mapNotNull { val reply=rows.optJSONObject(it)?:return@mapNotNull null;val question=reply.optString("question");val answer=reply.optString("answer");if(question.isBlank()||answer.isBlank())null else NativeQuestionReply(question,answer) } },
        questionReplyId = optString("questionReplyId"),
        attachments = (optJSONArray("attachments") ?: JSONArray()).let { rows -> (0 until rows.length()).map { val file=rows.getJSONObject(it);NativeAttachment(file.optString("name"),file.optString("path"),file.optString("url")) } },
        serviceTier = opt("serviceTier") as? String,
        hasServiceTier = has("serviceTier")&&(isNull("serviceTier")||opt("serviceTier") is String),
    )
}

internal fun JSONObject.toThreadRecord(): ThreadRecord {
    return ThreadRecord(
        id = getString("id"),
        projectPath = optString("projectPath"),
        title = nativeDisplayThreadTitle(optString("title"),""),
        status = optString("status"),
        updatedAt = optString("updatedAt"),
        unread = optBoolean("unread"),
        completedAt = optLong("completedAt"),
        pinnedIndex = optInt("pinnedIndex",-1),
        goal = optJSONObject("goal")?.toNativeGoal(),
        source = optString("source"),
        readOnly = optBoolean("readOnly") || nativeReadOnlyThreadId(optString("id")),
        snapshotUpdatedAt = optString("snapshotUpdatedAt"),
        snapshotStatus = optString("snapshotStatus"),
        snapshotStale = optBoolean("snapshotStale"),
        snapshotContentKind = optString("snapshotContentKind", "summary"),
        subagent = optJSONObject("subagent")?.toSubagent(),
        closureKind = if(isNull("closureKind"))null else optString("closureKind").takeIf{it.isNotBlank()},
    )
}

private fun JSONObject.toSubagent()=NativeSubagent(optString("parentThreadId"),optString("nickname"),optString("role"),optString("task"))
internal fun JSONObject.toNativeGoal()=NativeGoal(optString("objective"),optString("status"),optLong("tokensUsed"),if(isNull("tokenBudget"))null else optLong("tokenBudget"),if(isNull("timeUsedSeconds"))null else optLong("timeUsedSeconds"),optString("goalId"))
private fun JSONObject.toProjectRoot(): ProjectRoot {
    return ProjectRoot(
        path = optString("path"),
        name = optString("name"),
        exists = optBoolean("exists", false),
    )
}

private fun JSONObject.toGatewayHttpsConfig(): GatewayHttpsConfig {
    return GatewayHttpsConfig(
        enabled = optBoolean("enabled", false),
        certPath = optString("certPath"),
        keyPath = optString("keyPath"),
        certExists = optBoolean("certExists", false),
        keyExists = optBoolean("keyExists", false),
        restartRequired = optBoolean("restartRequired", false),
    )
}

private fun JSONObject.toCodexStatus(): CodexStatus {
    return CodexStatus(
        cliVersion = optString("cliVersion"),
        cliAvailable = optBoolean("cliAvailable", false),
        running = optBoolean("running", false),
        initialized = optBoolean("initialized", false),
        initializedAt = optString("initializedAt"),
        pendingRequests = optInt("pendingRequests", 0),
        startedAt = optString("startedAt"),
        lastExitCode = optString("lastExitCode"),
        lastError = optString("lastError"),
        malformedMessages = optInt("malformedMessages", 0),
        lastMalformedAt = optString("lastMalformedAt"),
        autoRestartEnabled = optBoolean("autoRestartEnabled", false),
        restartAttempts = optInt("restartAttempts", 0),
        nextRestartAt = optString("nextRestartAt"),
        lastRestartAt = optString("lastRestartAt"),
    )
}

private fun JSONObject.toCodexCompatibility(): CodexCompatibility {
    val adapter = optJSONObject("adapter") ?: JSONObject()
    val observations = optJSONObject("observations") ?: JSONObject()
    return CodexCompatibility(
        status = optString("status", "warning"),
        checkedAt = optString("checkedAt"),
        cliVersion = optString("cliVersion"),
        cliAvailable = optBoolean("cliAvailable", false),
        appServerRunning = optBoolean("appServerRunning", false),
        initialized = optBoolean("initialized", false),
        initializedAt = optString("initializedAt"),
        pendingRequests = optInt("pendingRequests", 0),
        clientRequests = adapter.optStringArray("clientRequests"),
        notifications = adapter.optStringArray("notifications"),
        serverRequests = adapter.optStringArray("serverRequests"),
        clientCapabilities = adapter.optStringArray("clientCapabilities"),
        unknownNotifications = observations.optMethodObservations("unknownNotifications"),
        unsupportedServerRequests = observations.optMethodObservations("unsupportedServerRequests"),
        malformedMessages = observations.optInt("malformedMessages", 0),
        lastMalformedAt = observations.optString("lastMalformedAt"),
        recommendations = optStringArray("recommendations"),
    )
}

private fun JSONObject.toCodexUpgradeCheck(): CodexUpgradeCheck {
    return CodexUpgradeCheck(
        checkedAt = optString("checkedAt"),
        installedVersion = optString("installedVersion"),
        installedRaw = optString("installedRaw"),
        latestVersion = optString("latestVersion"),
        packageName = optString("packageName"),
        updateAvailable = optBoolean("updateAvailable", false),
        command = optString("command"),
        source = optString("source"),
        error = optString("error"),
    )
}

private fun JSONObject.optMethodObservations(name: String): List<MethodObservation> {
    val array = optJSONArray(name) ?: return emptyList()
    return (0 until array.length()).map { index ->
        val item = array.optJSONObject(index) ?: JSONObject()
        MethodObservation(
            method = item.optString("method"),
            count = item.optInt("count", 0),
            lastSeenAt = item.optString("lastSeenAt"),
        )
    }
}

private fun JSONObject.toTerminalCommandRecord(): TerminalCommandRecord {
    return TerminalCommandRecord(
        commandId = optString("commandId"),
        threadId = optString("threadId"),
        cwd = optString("cwd"),
        command = optString("command"),
        status = optString("status", "unknown"),
        startedAt = optString("startedAt"),
        endedAt = optString("endedAt"),
        stdout = optString("stdout"),
        stderr = optString("stderr"),
        output = optString("output"),
        stdoutLength = optInt("stdoutLength", optString("stdout").length),
        stderrLength = optInt("stderrLength", optString("stderr").length),
        outputLength = optInt("outputLength", optString("output").length),
        outputOffset = optInt("outputOffset", 0),
        outputEnd = optInt("outputEnd", optString("output").length),
        outputTruncated = optBoolean("outputTruncated", false),
        chunks = optInt("chunks", 0),
        interactive = optString("command").contains("交互式会话"),
    )
}

private fun JSONObject.toTerminalOutputPage(): TerminalOutputPage {
    return TerminalOutputPage(
        commandId = optString("commandId"),
        threadId = optString("threadId"),
        stream = optString("stream", "combined"),
        offset = optInt("offset", 0),
        end = optInt("end", 0),
        limit = optInt("limit", 0),
        totalLength = optInt("totalLength", 0),
        text = optString("text"),
        hasMoreBefore = optBoolean("hasMoreBefore", false),
        hasMoreAfter = optBoolean("hasMoreAfter", false),
    )
}

private fun JSONObject.toDeviceRecord(): DeviceRecord {
    return DeviceRecord(
        id = optString("id"),
        name = optString("name"),
        userAgent = optString("userAgent"),
        firstSeenAt = optString("firstSeenAt"),
        lastSeenAt = optString("lastSeenAt"),
        revokedAt = optString("revokedAt"),
    )
}
