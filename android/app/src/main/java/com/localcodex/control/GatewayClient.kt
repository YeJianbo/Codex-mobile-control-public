package com.localcodex.control

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
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

class GatewayClient(
    private val baseUrl: String,
    private val token: String,
    private val trustSelfSigned: Boolean = false,
    private val remotePassword: String = "",
    private val certificateSha256: String = "",
    private val useDeviceCertificate: Boolean = false,
) {
    private val http = (if(certificateSha256.isNotBlank())pinnedOkHttpClient(certificateSha256) else if (trustSelfSigned) unsafeOkHttpClient() else defaultOkHttpClient())
        .newBuilder().addInterceptor { chain ->
            val request=if(remotePassword.isNotBlank())chain.request().newBuilder().header("X-Remote-Password",remotePassword).build() else chain.request()
            chain.proceed(if(useDeviceCertificate)DeviceCertificate.sign(request) else request)
        }.build()
    private val jsonType = "application/json".toMediaType()
    private var socket: WebSocket? = null

    fun health(): GatewayHealth {
        val item = JSONObject(publicRequest("GET", "/health"))
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

    fun addProject(path: String): Project {
        val response = request("POST", "/api/projects", JSONObject().put("path", path))
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
        val item = JSONObject(request("POST", "/api/codex/start")).getJSONObject("codex")
        return item.toCodexStatus()
    }

    fun restartCodex(): CodexStatus {
        val item = JSONObject(request("POST", "/api/codex/restart")).getJSONObject("codex")
        return item.toCodexStatus()
    }

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

    fun listThreads(): List<ThreadRecord> {
        val threads = JSONObject(request("GET", "/api/threads")).getJSONArray("threads")
        return (0 until threads.length()).map { index ->
            val item = threads.getJSONObject(index)
            ThreadRecord(
                id = item.getString("id"),
                projectPath = item.optString("projectPath"),
                title = item.optString("title"),
                status = item.optString("status"),
                updatedAt = item.optString("updatedAt"),
                pinnedIndex = item.optInt("pinnedIndex", -1),
                goal = item.optJSONObject("goal")?.let{goal->NativeGoal(goal.optString("objective"),goal.optString("status"),goal.optLong("tokensUsed"),if(goal.isNull("tokenBudget"))null else goal.optLong("tokenBudget"))},
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

    fun events(): Flow<ChatEvent> = callbackFlow {
        val wsUrl = baseUrl.replace("http://", "ws://").replace("https://", "wss://") + "/ws?token=$token&device=Android"
        val request = Request.Builder().url(wsUrl).build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                trySend(ChatEvent(type = "connection.opened", status = response.code.toString()))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching { JSONObject(text).toChatEvent() }.onSuccess { trySend(it) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                trySend(ChatEvent(type = "connection.closed", status = code.toString(), detail = reason))
                close()
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, reason) }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                trySend(ChatEvent(type = "connection.failed", status = response?.code?.toString().orEmpty(), detail = t.message.orEmpty()))
                close(t)
            }
        })
        awaitClose { socket?.close(1000, "closed") }
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

    fun interruptTurn(threadId: String): Boolean {
        return sendSocketMessage(
            JSONObject()
                .put("type", "turn.interrupt")
                .put("threadId", threadId),
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

    private fun sendSocketMessage(message: JSONObject): Boolean {
        return socket?.send(message.toString()) == true
    }

    fun nativeModels(): List<NativeModel> {
        val rows = JSONObject(request("GET", "/api/models?agents=all")).getJSONArray("models")
        return (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            val levels = row.optJSONArray("supportedReasoningEfforts") ?: JSONArray()
            NativeModel(row.getString("model"), row.optString("displayName"),
                (0 until levels.length()).map { levels.getJSONObject(it).getString("reasoningEffort") }, row.optString("defaultReasoningEffort"))
        }
    }

    fun nativeSend(thread: ThreadRecord?, project: Project?, text: String, model: String, effort: String, permission:String, requestId: String, images: List<NativeImage>, files:List<NativeUploadedFile>): Boolean {
        val message = JSONObject().put("type", if (thread == null) "thread.start" else "turn.start")
            .put("requestId", requestId).put("model", model).put("effort", effort.ifBlank { null }).put("permission",permission)
            .put("projectPath", (thread?.projectPath ?: project?.path).orEmpty().ifBlank { null })
            .put(if (thread == null) "initialText" else "text", text)
            .put("images", JSONArray(images.map { JSONObject().put("id", it.id).put("name", it.name) }))
            .put("files", JSONArray(files.map { JSONObject().put("id",it.id).put("name",it.name).put("mime",it.mime).put("size",it.size) }))
        if (thread != null) message.put("threadId", thread.id)
        return sendSocketMessage(message)
    }

    fun nativeUpload(bytes: ByteArray, mime: String, name: String): NativeImage {
        require(bytes.size <= 5 * 1024 * 1024) { "图片不能超过 5 MB" }
        val data = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        val result = JSONObject(request("POST", "/api/uploads/images", JSONObject().put("name", name).put("dataUrl", "data:$mime;base64,$data")))
        return NativeImage(result.getString("id"), result.getString("name"))
    }
    fun nativeUploadFile(input:()->java.io.InputStream,mime:String,name:String,size:Long):NativeUploadedFile {
        require(size in 1..(100L*1024*1024)){"文件不能超过 100 MB"}
        val body=object:RequestBody(){
            override fun contentType()="application/octet-stream".toMediaType()
            override fun contentLength()=size
            override fun writeTo(sink:BufferedSink){input().use{source->val chunk=ByteArray(32768);while(true){val count=source.read(chunk);if(count<0)break;sink.write(chunk,0,count)}}}
        }
        val request=Request.Builder().url(baseUrl+"/api/uploads/files").header("Authorization","Bearer $token")
            .header("X-File-Name",java.net.URLEncoder.encode(name,"UTF-8")).header("X-File-Type",mime).post(body).build()
        http.newBuilder().writeTimeout(5,TimeUnit.MINUTES).build().newCall(request).execute().use{response->
            val data=JSONObject(response.body?.string().orEmpty());check(response.isSuccessful){data.optString("message",data.optString("error","上传失败"))}
            return NativeUploadedFile(data.getString("id"),data.getString("name"),data.getString("mime"),data.getLong("size"))
        }
    }

    fun nativeBytes(endpoint: String): ByteArray = http.newCall(Request.Builder().url(baseUrl + endpoint)
        .header("Authorization", "Bearer $token").build()).execute().use { response ->
        check(response.isSuccessful) { "读取失败 (${response.code})" }
        response.body?.bytes() ?: byteArrayOf()
    }

    fun nativeDownload(endpoint:String,file:java.io.File,maxBytes:Long=100L*1024*1024) {
        http.newCall(Request.Builder().url(baseUrl+endpoint).header("Authorization","Bearer $token").build()).execute().use { response ->
            check(response.isSuccessful) { "读取失败 (${response.code})" }
            val body=response.body ?: error("文件内容为空")
            require(body.contentLength()<0||body.contentLength()<=maxBytes){"文件超过 ${maxBytes/1024/1024} MB，请在电脑打开"}
            try {
                body.byteStream().use { input -> file.outputStream().use { output ->
                    val buffer=ByteArray(32768);var total=0L
                    while(true){val count=input.read(buffer);if(count<0)break;total+=count
                        require(total<=maxBytes){"文件超过 ${maxBytes/1024/1024} MB，请在电脑打开"};output.write(buffer,0,count)
                    }
                }}
            }catch(error:Exception){file.delete();throw error}
        }
    }

    fun nativeApproval(id: String, decision: String) { resolveApproval(id, decision) }
    fun nativeJson(method:String, endpoint:String, body:JSONObject?=null):JSONObject = JSONObject(request(method,endpoint,body))
    fun nativeHistory(threadId:String,count:Int=60):Triple<List<ChatEvent>,String,Boolean> {
        val result=nativeJson("GET","/api/threads/$threadId/events?count=$count");val rows=result.getJSONArray("events")
        return Triple((0 until rows.length()).map{rows.getJSONObject(it).toChatEvent()},result.optString("status"),result.optBoolean("hasMore"))
    }

    fun nativeSidebarProjects(): List<Project> {
        val rows = JSONObject(request("GET", "/api/sidebar")).optJSONArray("projects")?:JSONArray()
        return (0 until rows.length()).map { val p=rows.getJSONObject(it); Project(p.optString("id"),p.optString("name"),p.optString("path"),p.optBoolean("trusted")) }
    }

    private fun request(method: String, path: String, body: JSONObject? = null): String {
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

        http.newCall(builder.build()).execute().use { response ->
            return response.requireBody()
        }
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
            error("HTTP $code")
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
        projectPath = optString("projectPath").ifBlank { thread?.optString("projectPath").orEmpty() },
        stream = optString("stream"),
        text = optString("text").ifBlank { optString("message") },
        title = optString("title").ifBlank { thread?.optString("title").orEmpty() },
        status = optString("status").ifBlank { thread?.optString("status").orEmpty() },
        detail = optString("detail").ifBlank { optString("message") },
        itemId = optString("itemId"),
        commandId = optString("commandId"),
        cwd = optString("cwd"),
        command = optString("command"),
        createdAt = optString("createdAt"),
        updatedAt = optString("updatedAt").ifBlank { thread?.optString("updatedAt").orEmpty() },
        approvalId = optString("approvalId"),
        approvalType = optString("approvalType"),
        diff = optString("diff"),
        files = optStringArray("files"),
        eventId = optString("eventId"),
        requestId = optString("requestId"),
        replayed = optBoolean("replayed"),
        images = (optJSONArray("images") ?: JSONArray()).let { rows -> (0 until rows.length()).map { val image=rows.getJSONObject(it);NativeImage(image.getString("id"),image.optString("name","图片")) } },
        uploads = ((if(optString("type")=="user.message")optJSONArray("files") else null) ?: JSONArray()).let { rows -> (0 until rows.length()).mapNotNull { val file=rows.optJSONObject(it)?:return@mapNotNull null;NativeUploadedFile(file.optString("id"),file.optString("name"),file.optString("mime"),file.optLong("size")) } },
        attachments = (optJSONArray("attachments") ?: JSONArray()).let { rows -> (0 until rows.length()).map { val file=rows.getJSONObject(it);NativeAttachment(file.optString("name"),file.optString("path"),file.optString("url")) } },
    )
}

private fun JSONObject.toThreadRecord(): ThreadRecord {
    return ThreadRecord(
        id = getString("id"),
        projectPath = optString("projectPath"),
        title = optString("title"),
        status = optString("status"),
        updatedAt = optString("updatedAt"),
    )
}

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
