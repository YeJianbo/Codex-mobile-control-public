package com.localcodex.control

import org.json.JSONObject

data class NativeThreadSection(val id:String,val name:String)

internal data class NativeLegacySubmission(val id:String,val address:String,val text:String,val attachmentNames:List<String>,val submittedAt:String)

data class NativeQueued(val id:String,val text:String,val status:String,val error:String,val canSteer:Boolean,val images:List<NativeImage> = emptyList(),val uploads:List<NativeUploadedFile> = emptyList())
data class NativePdf(val path:String,val name:String,val revision:Long=0)
data class NativeReadableFile(val name:String,val sourcePath:String,val content:String,val eventId:String="",val threadId:String="",val mime:String="text/markdown",val encoding:NativeTextEncoding=NativeTextEncoding.UTF8,val hasBom:Boolean=false)
data class NativeProjectThreads(val rows:List<ThreadRecord> = emptyList(),val limit:Int=10,val hasMore:Boolean=false,val loading:Boolean=false,val loaded:Boolean=false,val loadedAtMs:Long=0L)
data class NativeOpenedImage(val endpoint:String,val bitmap:android.graphics.Bitmap,
    val endpoints:List<String> = listOf(endpoint),val thumbnails:Map<String,Pair<android.graphics.Bitmap,String>> = emptyMap())
data class NativeState(
    val capabilities:List<String> = emptyList(),
    val submissionNotice:String="",
    val submissionNoticeRequestId:String="",
    val harness:String="codex",
    val backends:List<NativeBackend> = emptyList(),val actualModel:String="",
    val backendStatusLoading:Boolean=false,val backendStatusError:String="",
    val route:ConnectionRoute=ConnectionRoute.AUTO,val connected:Boolean=false,val connecting:Boolean=false,val error:String="",val address:String="",val publicUrl:String="",val remotePassword:String="",val certificateSha256:String="",val activeAddress:String="",
    val publicTestRunning:Boolean=false,val publicTestMessage:String="",val publicTestPassed:Boolean=false,
    val projects:List<Project> = emptyList(),val sidebarProjects:List<Project> = emptyList(),val threads:List<ThreadRecord> = emptyList(),
    val projectThreads:Map<String,NativeProjectThreads> = emptyMap(),
    val threadFilter:NativeThreadFilter=NativeThreadFilter.ALL,
    val moreThreads:Boolean=false,val moreProjects:Boolean=false,val loadingSidebar:Boolean=false,
    val cloudListError:String="",
    val remoteSearch:NativeThreadSearch=NativeThreadSearch(),
    val models:List<NativeModel> = emptyList(),val modelsFallback:Boolean=false,val model:String="",val effort:String="",val permission:String="full",
    val nextMode:String="default",val fastMode:Boolean?=null,val sessionFast:Boolean?=null,val fastBusy:Boolean=false,
    val threadId:String="",val projectId:String="",val events:List<ChatEvent> = emptyList(),
    val draft:String="",val images:List<NativeImage> = emptyList(),val uploads:List<NativeUploadedFile> = emptyList(),val uploading:Boolean=false,val uploadMessage:String="",val uploadProgress:NativeUploadProgress?=null,val uploadError:String="",
    val editingMessage:ChatEvent?=null,val messageEditText:String="",
    val sending:Boolean=false,val running:Boolean=false,val stopping:Boolean=false,val stopError:String="",val loadingHistory:Boolean=false,val loadingOlderHistory:Boolean=false,val hasMoreHistory:Boolean=false,
    val historySyncing:Boolean=false,val historyErrors:Map<String,String> = emptyMap(),
    val queue:List<NativeQueued> = emptyList(),val queueDrafts:List<NativeQueued> = emptyList(),val canSteer:Boolean=false,val files:List<FileEntry> = emptyList(),val filePath:String="",
    val file:FileContent?=null,val fileDraft:String="",val fileProjectId:String="",val fileRootPath:String="",val diff:String="",val terminal:String="",val terminalSession:String="",val terminalDraft:String="",val terminalError:String="",val terminalBusy:Boolean=false,
    val fileBusy:Boolean=false,val fileMessage:String="",val fileError:String="",val fileFeedbackVisible:Boolean=false,val openedImage:NativeOpenedImage?=null,
    val approvalResults:Map<String,String> = emptyMap(),
    val approvals:Set<String> = emptySet(),val workBusy:Boolean=false,val pdf:NativePdf?=null,val markdown:NativeReadableFile?=null,val storagePermissionRequired:Boolean=false,
    val pendingApprovals:List<ChatEvent> = emptyList(),
    val desktopAutoApprove:Boolean=false,val remoteApprovalBusy:Boolean=false,val approvalBridgeConfigured:Boolean=false,val approvalBridgeConnected:Boolean=false,
    val capacityAutoRetry:Boolean=false,val capacityRetryBusy:Boolean=false,val capacityRetryError:String="",
    val usage:JSONObject?=null,val usageLoading:Boolean=false,val usageError:String="",val usageDays:Int=1,
    val usageDataDays:Int=1,val activityLoading:Set<String> = emptySet(),val activityErrors:Map<String,String> = emptyMap(),
    val recoveryVersion:Int=0,val sendingStage:String="",
    val modelServiceNotice:ModelServiceNotice?=null,
    val taskNotice:TaskNotification?=null,
    val automationSaving:Boolean=false,val automationError:String="",val automations:List<NativeAutomation> = emptyList(),val automationsVisible:Boolean=false,val automationsLoading:Boolean=false,val automationFocus:String="",
    val codexReady:Boolean=false,val codexStarting:Boolean=false,val codexStatusLoading:Boolean=false,val codexStatusError:String="",
    val localConsole:LocalConsoleUiState=LocalConsoleUiState(),
    val backendRestart:NativeBackendRestart=NativeBackendRestart()
)
data class NativeBackendRestart(val busy:Boolean=false,val planId:String="",val blockingCount:Int=0,val canRestart:Boolean=false,val error:String="",val done:Boolean=false,val desktopRunning:Boolean=false)
