package com.localcodex.control

import android.os.Bundle
import android.content.Intent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.Button
import androidx.compose.material.ButtonDefaults
import androidx.compose.material.Card
import androidx.compose.material.Checkbox
import androidx.compose.material.DropdownMenu
import androidx.compose.material.DropdownMenuItem
import androidx.compose.material.Icon
import androidx.compose.material.IconButton
import androidx.compose.material.MaterialTheme
import androidx.compose.material.OutlinedTextField
import androidx.compose.material.Shapes
import androidx.compose.material.Surface
import androidx.compose.material.Text
import androidx.compose.material.TextButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Work
import androidx.compose.material.lightColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class LegacyControlActivity : ComponentActivity() {
    private var pendingPairBaseUrl by mutableStateOf("")
    private var pendingPairCode by mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        readPairIntent(intent)
        setContent {
            CodexControlTheme {
                AppBackground {
                    ControlApp(
                        initialPairBaseUrl = pendingPairBaseUrl,
                        initialPairCode = pendingPairCode,
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) {
            setIntent(intent)
            readPairIntent(intent)
        }
    }

    private fun readPairIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "codex-control" && data.host == "pair") {
            pendingPairBaseUrl = data.getQueryParameter("baseUrl").orEmpty()
            pendingPairCode = data.getQueryParameter("code").orEmpty()
        }
    }
}

private data class DisplayEvent(
    val key: String,
    val event: ChatEvent,
    val parts: Int = 1,
)

private data class PanelPixelSize(
    val width: Int = 0,
    val height: Int = 0,
)

internal data class TerminalViewport(
    val cols: Int,
    val rows: Int,
)

private data class NavDestination(
    val title: String,
    val icon: ImageVector,
    val tabIndex: Int,
)

private object AppPalette {
    val Background = Color(0xFFF5F7FB)
    val Surface = Color(0xF2FFFFFF)
    val SurfaceVariant = Color(0xDDEAF1F8)
    val Glass = Color(0xCCFFFFFF)
    val GlassStrong = Color(0xEEFFFFFF)
    val GlassBorder = Color(0x99FFFFFF)
    val Primary = Color(0xFF2563EB)
    val PrimaryContainer = Color(0xFFD9E7FF)
    val OnPrimaryContainer = Color(0xFF102A66)
    val SecondaryContainer = Color(0xFFDDF7EF)
    val OnSecondaryContainer = Color(0xFF0D3B2E)
    val TertiaryContainer = Color(0xFFFFE7CF)
    val OnTertiaryContainer = Color(0xFF5A2A00)
    val ErrorContainer = Color(0xFFFFDADD)
    val OnErrorContainer = Color(0xFF611A1F)
    val Terminal = Color(0xFF111827)
    val TerminalMuted = Color(0xFF9CA3AF)
    val TextPrimary = Color(0xFF111827)
    val TextSecondary = Color(0xFF5B6472)
    val Outline = Color(0xFFC9D4E4)
    val Online = Color(0xFF22C55E)
    val Offline = Color(0xFFEF4444)
    val AmbientStart = Color(0xFFEAF2FF)
    val AmbientMiddle = Color(0xFFF6F1FF)
    val AmbientEnd = Color(0xFFEAFBF5)
}

@Composable
private fun CodexControlTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = lightColors(
            primary = AppPalette.Primary,
            primaryVariant = Color(0xFF2647C9),
            secondary = Color(0xFF00796B),
            background = AppPalette.Background,
            surface = AppPalette.Surface,
            error = Color(0xFFB3261E),
            onPrimary = Color.White,
            onSecondary = Color.White,
            onBackground = AppPalette.TextPrimary,
            onSurface = AppPalette.TextPrimary,
            onError = Color.White,
        ),
        shapes = Shapes(
            small = RoundedCornerShape(8.dp),
            medium = RoundedCornerShape(8.dp),
            large = RoundedCornerShape(8.dp),
        ),
        content = content,
    )
}

@Composable
private fun AppBackground(content: @Composable () -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(
                        AppPalette.AmbientStart,
                        AppPalette.AmbientMiddle,
                        AppPalette.AmbientEnd,
                    ),
                ),
            ),
    ) {
        content()
    }
}

@Composable
private fun GlassCard(
    modifier: Modifier = Modifier,
    backgroundColor: Color = AppPalette.Glass,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = modifier,
        backgroundColor = backgroundColor,
        elevation = 0.dp,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, AppPalette.GlassBorder),
        content = content,
    )
}

@Composable
private fun StatusPill(text: String, positive: Boolean) {
    val background = if (positive) AppPalette.SecondaryContainer else AppPalette.Surface
    val foreground = if (positive) AppPalette.OnSecondaryContainer else AppPalette.TextSecondary
    Card(backgroundColor = background, elevation = 0.dp, shape = RoundedCornerShape(50.dp)) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            color = foreground,
            style = MaterialTheme.typography.caption,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun StatusDot(online: Boolean) {
    Box(
        Modifier
            .width(10.dp)
            .height(10.dp)
            .background(
                color = if (online) AppPalette.Online else AppPalette.Offline,
                shape = RoundedCornerShape(50.dp),
            ),
    )
}

@Composable
private fun ErrorBanner(message: String, onDismiss: () -> Unit) {
    Card(backgroundColor = AppPalette.ErrorContainer, elevation = 0.dp) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = message,
                modifier = Modifier.weight(1f),
                color = AppPalette.OnErrorContainer,
                style = MaterialTheme.typography.body2,
            )
            TextButton(onClick = onDismiss) {
                Text("知道了", color = AppPalette.OnErrorContainer)
            }
        }
    }
}

@Composable
private fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    GlassCard(modifier = modifier, backgroundColor = AppPalette.GlassStrong) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
            placeholder = { Text(placeholder) },
            leadingIcon = {
                Icon(Icons.Filled.Search, "搜索", tint = AppPalette.TextSecondary)
            },
            singleLine = true,
        )
    }
}

@Composable
fun ControlApp(
    initialPairBaseUrl: String = "",
    initialPairCode: String = "",
    viewModel: MainViewModel = viewModel(),
) {
    val state = viewModel.state
    var selectedTab by remember { mutableStateOf(5) }
    var moreExpanded by remember { mutableStateOf(false) }
    val hasSavedConnection = state.baseUrl.isNotBlank() && state.token.isNotBlank()
    var connectionDialogOpen by remember(initialPairCode) { mutableStateOf(initialPairCode.isNotBlank() || !hasSavedConnection) }
    var connectionDialogAutoOpened by remember(initialPairCode) { mutableStateOf(initialPairCode.isNotBlank() || !hasSavedConnection) }
    LaunchedEffect(initialPairBaseUrl, initialPairCode) {
        if (initialPairBaseUrl.isNotBlank() || initialPairCode.isNotBlank()) {
            viewModel.applyPairLink(initialPairBaseUrl, initialPairCode)
        } else {
            viewModel.autoConnectSavedConnection(initialPairCode)
        }
    }
    LaunchedEffect(state.connected, connectionDialogAutoOpened, initialPairCode) {
        if (shouldAutoCloseConnectionDialog(state.connected, connectionDialogAutoOpened)) {
            connectionDialogOpen = false
            connectionDialogAutoOpened = false
        }
    }
    val primaryTabs = listOf(
        NavDestination("首页", Icons.Filled.Work, 5),
        NavDestination("聊天", Icons.Filled.Chat, 1),
        NavDestination("文件", Icons.Filled.Folder, 0),
    )
    val moreTabs = listOf(
        NavDestination("终端", Icons.Filled.Code, 3),
        NavDestination("浏览器", Icons.Filled.Language, 2),
        NavDestination("项目", Icons.Filled.Work, 4),
        NavDestination("设置", Icons.Filled.Tune, 6),
    )
    val allTabs = primaryTabs + moreTabs
    val activeThread = state.threads.firstOrNull { it.id == state.activeThreadId }
    val selectedDestination = allTabs.firstOrNull { it.tabIndex == selectedTab }
    val topTitle = if (selectedTab == 1) {
        activeThread?.title?.ifBlank { "聊天" } ?: "聊天"
    } else {
        selectedDestination?.title?.let { if (it == "首页") "Codex 控制台" else it } ?: "Codex 控制台"
    }
    BackHandler(enabled = selectedTab != 5) {
        selectedTab = 5
    }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        GlassCard(backgroundColor = AppPalette.GlassStrong) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                StatusDot(state.connected)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        topTitle,
                        style = MaterialTheme.typography.h6,
                        fontWeight = FontWeight.Bold,
                        color = AppPalette.TextPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        connectionLabel(state.connected, state.reconnecting, state.reconnectAttempt),
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.TextSecondary,
                    )
                }
                Box {
                    IconButton(
                        onClick = { moreExpanded = true },
                    ) {
                        Icon(Icons.Filled.MoreVert, "更多", tint = AppPalette.TextSecondary)
                    }
                    DropdownMenu(expanded = moreExpanded, onDismissRequest = { moreExpanded = false }) {
                        moreTabs.forEach { destination ->
                            DropdownMenuItem(onClick = {
                                selectedTab = destination.tabIndex
                                moreExpanded = false
                            }) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(destination.icon, destination.title, tint = AppPalette.Primary)
                                    Spacer(Modifier.width(10.dp))
                                    Text(destination.title)
                                }
                            }
                        }
                        DropdownMenuItem(onClick = {
                            connectionDialogAutoOpened = false
                            connectionDialogOpen = true
                            moreExpanded = false
                        }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Tune, "连接设置", tint = AppPalette.Primary)
                                Spacer(Modifier.width(10.dp))
                                Text("连接设置")
                            }
                        }
                    }
                }
            }
        }
        PrimaryDestinationBar(
            destinations = primaryTabs,
            selectedTab = selectedTab,
            onSelected = { selectedTab = it },
        )
        if (connectionDialogOpen) {
            ConnectionSettingsDialog(
                state = state,
                viewModel = viewModel,
                initialPairCode = initialPairCode,
                onDismiss = { connectionDialogOpen = false },
            )
        }
        if (state.error.isNotBlank() && !connectionDialogOpen) {
            ErrorBanner(state.error, viewModel::clearError)
        }
        Box(Modifier.weight(1f)) {
            when (selectedTab) {
                0 -> FilesPanel(state, viewModel)
                1 -> ConversationPanel(
                    state,
                    viewModel,
                    onOpenTab = { selectedTab = it },
                    onOpenConnectionSettings = {
                        connectionDialogAutoOpened = false
                        connectionDialogOpen = true
                    },
                )
                2 -> BrowserPanel(state, viewModel)
                3 -> TerminalPanel(state, viewModel)
                4 -> ProjectsPanel(state, viewModel)
                5 -> HomePanel(
                    state,
                    viewModel,
                    onOpenChat = { selectedTab = 1 },
                    onOpenFiles = { selectedTab = 0 },
                )
                6 -> SettingsPanel(state, viewModel)
            }
        }
    }
}

@Composable
private fun PrimaryDestinationBar(
    destinations: List<NavDestination>,
    selectedTab: Int,
    onSelected: (Int) -> Unit,
) {
    GlassCard(backgroundColor = AppPalette.Glass) {
        Row(
            Modifier.fillMaxWidth().padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            destinations.forEach { destination ->
                val selected = selectedTab == destination.tabIndex
                Card(
                    modifier = Modifier
                        .weight(1f)
                        .clickable { onSelected(destination.tabIndex) },
                    backgroundColor = if (selected) AppPalette.PrimaryContainer else Color.Transparent,
                    elevation = 0.dp,
                    shape = RoundedCornerShape(50.dp),
                ) {
                    Row(
                        Modifier.padding(horizontal = 10.dp, vertical = 9.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            destination.icon,
                            destination.title,
                            tint = if (selected) AppPalette.Primary else AppPalette.TextSecondary,
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            destination.title,
                            color = if (selected) AppPalette.OnPrimaryContainer else AppPalette.TextSecondary,
                            style = MaterialTheme.typography.body2,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ConnectionSettingsDialog(state: UiState, viewModel: MainViewModel, initialPairCode: String = "", onDismiss: () -> Unit) {
    val parsed = remember(state.baseUrl) { parseConnectionDraft(state.baseUrl) }
    var hostDraft by remember(state.baseUrl) { mutableStateOf(parsed.host) }
    var portDraft by remember(state.baseUrl) { mutableStateOf(parsed.port) }
    var tokenDraft by remember(state.token) { mutableStateOf(state.token) }
    var tokenVisible by remember { mutableStateOf(false) }
    var trustDraft by remember(state.trustSelfSigned) { mutableStateOf(state.trustSelfSigned) }
    var pairCode by remember(initialPairCode) { mutableStateOf(initialPairCode) }
    androidx.compose.material.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("连接设置") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(connectionLabel(state.connected, state.reconnecting, state.reconnectAttempt), fontWeight = FontWeight.Bold)
                    Text(
                        text = state.baseUrl.ifBlank { "未设置电脑端地址" },
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.TextSecondary,
                    )
                }
                StatusDot(state.connected)
            }
            CompactCodexStatus(state)
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = hostDraft,
                    onValueChange = { hostDraft = it.trim() },
                    modifier = Modifier.weight(1f),
                    label = { Text("电脑 IP / 主机名") },
                    placeholder = { Text("192.168.1.5") },
                    singleLine = true,
                )
                Spacer(Modifier.width(8.dp))
                OutlinedTextField(
                    value = portDraft,
                    onValueChange = { portDraft = it.filter(Char::isDigit).take(5) },
                    modifier = Modifier.width(104.dp),
                    label = { Text("端口") },
                    placeholder = { Text("38457") },
                    singleLine = true,
                )
            }
            OutlinedTextField(
                value = tokenDraft,
                onValueChange = { tokenDraft = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("访问 Token") },
                visualTransformation = if (tokenVisible) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    TextButton(onClick = { tokenVisible = !tokenVisible }) {
                        Text(if (tokenVisible) "隐藏" else "显示")
                    }
                },
                singleLine = true,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = trustDraft,
                    onCheckedChange = { trustDraft = it },
                )
                Text("信任自签名 HTTPS 证书")
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = { viewModel.connectWithAddress(hostDraft, portDraft, tokenDraft, trustDraft) },
                    enabled = !state.loading && hostDraft.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(backgroundColor = AppPalette.Primary, contentColor = Color.White),
                ) {
                    Text(if (state.connected) "重新连接" else "连接")
                }
                Spacer(Modifier.width(8.dp))
                Button(onClick = viewModel::refreshCodexStatus, enabled = state.connected && !state.loading) {
                    Text("刷新")
                }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = viewModel::rotateToken, enabled = state.connected && !state.loading) {
                    Text("轮换 Token")
                }
            }
            CodexStatusPanel(state, viewModel)
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = pairCode,
                    onValueChange = { pairCode = it.uppercase() },
                    modifier = Modifier.weight(1f),
                    label = { Text("配对码") },
                    singleLine = true,
                )
                Spacer(Modifier.width(8.dp))
                Button(onClick = {
                    viewModel.pairWithAddress(hostDraft, portDraft, trustDraft, pairCode)
                    pairCode = ""
                }, enabled = !state.loading && hostDraft.isNotBlank() && pairCode.isNotBlank()) {
                    Text("配对")
                }
            }
            if (state.error.isNotBlank()) {
                Card(backgroundColor = AppPalette.ErrorContainer, elevation = 0.dp) {
                    Text(
                        state.error,
                        modifier = Modifier.fillMaxWidth().padding(10.dp),
                        color = AppPalette.OnErrorContainer,
                    )
                }
            }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("完成")
            }
        },
    )
}

@Composable
private fun CompactCodexStatus(state: UiState) {
    val codex = state.codexStatus
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = listOf(
                    if (codex.running) "app-server 运行中" else "app-server 未运行",
                    codex.cliVersion.ifBlank { "未找到 CLI" },
                ).joinToString(" · "),
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.caption,
                color = AppPalette.TextSecondary,
            )
            if (codex.pendingRequests > 0) {
                StatusPill("待处理 ${codex.pendingRequests}", false)
            }
        }
        if (state.gatewayHealth.version.isNotBlank()) {
            Text(
                "Gateway ${state.gatewayHealth.version} · 协议 ${state.gatewayHealth.protocolVersion}",
                style = MaterialTheme.typography.caption,
                color = AppPalette.TextSecondary,
            )
        }
    }
}

@Composable
private fun CodexStatusPanel(state: UiState, viewModel: MainViewModel) {
    val codex = state.codexStatus
    Card(backgroundColor = AppPalette.SurfaceVariant, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Codex", modifier = Modifier.weight(1f), fontWeight = FontWeight.Bold)
                StatusPill(if (codex.running) "运行中" else "未运行", codex.running)
            }
            Text(
                text = listOf(
                    codex.cliVersion.ifBlank { "未找到 CLI" },
                    "pending ${codex.pendingRequests}",
                    if (codex.autoRestartEnabled) "自动恢复已开" else "自动恢复关闭",
                ).joinToString(" · "),
                style = MaterialTheme.typography.caption,
                color = AppPalette.TextSecondary,
            )
            if (codex.nextRestartAt.isNotBlank()) {
                Text("下次自动重启：${compactTime(codex.nextRestartAt)}", color = AppPalette.OnTertiaryContainer, style = MaterialTheme.typography.caption)
            }
            if (codex.lastError.isNotBlank()) {
                Text(codex.lastError, color = AppPalette.OnErrorContainer, style = MaterialTheme.typography.caption)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = viewModel::refreshCodexStatus, enabled = state.connected && !state.loading) {
                    Text("刷新")
                }
                Spacer(Modifier.width(8.dp))
                Button(onClick = viewModel::startCodex, enabled = state.connected && !state.loading) {
                    Text("启动")
                }
                Spacer(Modifier.width(8.dp))
                Button(onClick = viewModel::restartCodex, enabled = state.connected && !state.loading) {
                    Text("重启")
                }
            }
        }
    }
}

@Composable
internal fun HomePanel(state: UiState, viewModel: MainViewModel, onOpenChat: () -> Unit, onOpenFiles: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var expandedProjectIds by remember { mutableStateOf(setOf<String>()) }
    val turnRunning = isTurnRunning(state)
    val homeContent = remember(state.projects, state.threads, query, expandedProjectIds) {
        buildHomeContent(state.projects, state.threads, query, expandedProjectIds)
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("项目与会话", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.h6)
                    Text(
                        if (state.connected) "${homeContent.trustedProjects.size} 个项目 · ${state.threads.size} 个会话" else "离线，连接后同步电脑端 Codex",
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.TextSecondary,
                    )
                }
                IconButton(onClick = viewModel::refreshThreads, enabled = state.connected && !state.loading) {
                    Icon(Icons.Filled.Refresh, "刷新会话", tint = AppPalette.TextSecondary)
                }
            }
            Spacer(Modifier.height(8.dp))
            SearchField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = "搜索项目或会话",
            )
        }
        if (homeContent.trustedProjects.isEmpty() && homeContent.query.isBlank()) {
            item {
                GlassCard(backgroundColor = AppPalette.SurfaceVariant) {
                    Text(
                        text = "还没有添加项目。打开右上角菜单进入项目管理。",
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        style = MaterialTheme.typography.body2,
                        color = AppPalette.TextSecondary,
                    )
                }
            }
        }
        items(homeContent.projectGroups) { group ->
            val project = group.project
            val projectThreads = group.threads
            val expanded = group.expanded
            val shownThreads = group.shownThreads
            var projectMenuOpen by remember(project.id) { mutableStateOf(false) }
            GlassCard(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        viewModel.selectChatProject(project)
                        onOpenChat()
                    },
                backgroundColor = AppPalette.Glass,
            ) {
                Column(Modifier.fillMaxWidth().padding(13.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                project.name,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                "${projectThreads.size} 个会话 · 点按进入",
                                style = MaterialTheme.typography.caption,
                                color = AppPalette.TextSecondary,
                            )
                        }
                        if (project.id == state.activeProjectId) {
                            StatusPill("当前", true)
                            Spacer(Modifier.width(4.dp))
                        }
                        Box {
                            IconButton(onClick = { projectMenuOpen = true }) {
                                Icon(Icons.Filled.MoreVert, "项目操作", tint = AppPalette.TextSecondary)
                            }
                            DropdownMenu(expanded = projectMenuOpen, onDismissRequest = { projectMenuOpen = false }) {
                                DropdownMenuItem(
                                    onClick = {
                                        viewModel.openBlankThread(project)
                                        projectMenuOpen = false
                                        onOpenChat()
                                    },
                                    enabled = canStartEmptyThread(state.connected, state.pendingConversationStart, turnRunning, project),
                                ) {
                                    Text("新会话")
                                }
                                DropdownMenuItem(onClick = {
                                    viewModel.openProjectFiles(project)
                                    projectMenuOpen = false
                                    onOpenFiles()
                                }) {
                                    Text("文件")
                                }
                            }
                        }
                    }
                    Text(
                        project.path,
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.TextSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (projectThreads.isNotEmpty()) {
                        shownThreads.forEach { thread ->
                            ThreadRow(
                                thread = thread,
                                selected = state.activeThreadId == thread.id,
                                onOpen = {
                                    viewModel.openThread(thread)
                                    onOpenChat()
                                },
                                onRename = viewModel::renameThread,
                                onDelete = viewModel::deleteThread,
                            )
                        }
                        if (projectThreads.size > 3 && homeContent.query.isBlank()) {
                            TextButton(
                                onClick = {
                                    expandedProjectIds = if (expanded) {
                                        expandedProjectIds - project.id
                                    } else {
                                        expandedProjectIds + project.id
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(
                                    if (expanded) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                                    if (expanded) "收起会话" else "展开全部会话",
                                    tint = AppPalette.Primary,
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(if (expanded) "收起" else "查看全部 ${projectThreads.size} 个会话")
                            }
                        }
                    }
                }
            }
        }

        if (homeContent.orphanThreads.isNotEmpty()) {
            item {
            Spacer(Modifier.height(6.dp))
                Text("历史会话", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.h6)
            }
            items(homeContent.orphanThreads) { thread ->
                ThreadRow(
                    thread = thread,
                    selected = state.activeThreadId == thread.id,
                    onOpen = {
                        viewModel.openThread(thread)
                        onOpenChat()
                    },
                    onRename = viewModel::renameThread,
                    onDelete = viewModel::deleteThread,
                )
            }
        }
        if (homeContent.trustedProjects.isEmpty() && state.threads.isEmpty()) {
            item {
                GlassCard(backgroundColor = AppPalette.SurfaceVariant) {
                    Text(
                        text = "暂无会话。先添加项目，然后从项目卡片进入聊天。",
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        style = MaterialTheme.typography.body2,
                        color = AppPalette.TextSecondary,
                    )
                }
            }
        }
        if (homeContent.query.isNotBlank() && homeContent.projectGroups.isEmpty() && homeContent.orphanThreads.isEmpty()) {
            item {
                GlassCard(backgroundColor = AppPalette.SurfaceVariant) {
                    Text(
                        text = "没有匹配的项目或会话。",
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        style = MaterialTheme.typography.body2,
                        color = AppPalette.TextSecondary,
                    )
                }
            }
        }
    }
}

@Composable
private fun ProjectsPanel(state: UiState, viewModel: MainViewModel) {
    var projectPath by remember { mutableStateOf("") }
    val trustedProjects = state.projects.filter(::isUsableHomeProject)
    val turnRunning = isTurnRunning(state)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = projectPath,
                onValueChange = { projectPath = it },
                modifier = Modifier.weight(1f),
                label = { Text("添加电脑端项目路径") },
                singleLine = true,
            )
            Spacer(Modifier.width(8.dp))
            Button(onClick = {
                viewModel.addLocalProject(projectPath)
                projectPath = ""
            }) {
                Text("添加")
            }
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(trustedProjects) { project ->
                Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
                    Column(Modifier.padding(12.dp)) {
                        Text(project.name, fontWeight = FontWeight.Bold)
                        Text(project.path, style = MaterialTheme.typography.body2, color = AppPalette.TextSecondary)
                        Spacer(Modifier.height(8.dp))
                        Button(
                            onClick = { viewModel.startThread(project) },
                            enabled = canStartEmptyThread(state.connected, state.pendingConversationStart, turnRunning, project),
                        ) {
                            Text("开启对话")
                        }
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = { viewModel.openProjectFiles(project) }) {
                            Text("查看文件")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilesPanel(state: UiState, viewModel: MainViewModel) {
    var editedContent by remember(state.openedFile.path, state.openedFile.content) { mutableStateOf(state.openedFile.content) }
    var fileMode by remember(state.openedFile.path) { mutableStateOf("edit") }
    var fileQuery by remember(state.filePath) { mutableStateOf("") }
    var fileKindFilter by remember(state.filePath) { mutableStateOf("all") }
    var fileKindMenuOpen by remember { mutableStateOf(false) }
    var diffQuery by remember(state.activeProjectId) { mutableStateOf("") }
    var diffStatusFilter by remember(state.activeProjectId) { mutableStateOf("all") }
    var diffStatusMenuOpen by remember { mutableStateOf(false) }
    var pendingBulkDiffAction by remember { mutableStateOf("") }
    var fileActionsOpen by remember { mutableStateOf(false) }
    val filteredFiles = remember(state.files, fileQuery, fileKindFilter) {
        filterFileEntries(state.files, fileQuery, fileKindFilter)
    }
    val filteredDiffFiles = remember(state.diffFiles, diffQuery, diffStatusFilter) {
        filterDiffFiles(state.diffFiles, diffQuery, diffStatusFilter)
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ProjectContextBar(
            state = state,
            actionLabel = "打开",
            emptyText = "暂无项目。先到项目管理添加可访问的项目路径。",
            onProjectSelected = viewModel::openProjectFiles,
        )

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = state.filePath.ifBlank { "项目根目录" },
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.caption,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            IconButton(onClick = viewModel::refreshCurrentFiles, enabled = state.connected && state.activeProjectId.isNotBlank()) {
                Icon(Icons.Filled.Refresh, "刷新文件", tint = AppPalette.TextSecondary)
            }
            Spacer(Modifier.width(4.dp))
            Button(onClick = { viewModel.loadDiff() }, enabled = state.activeProjectId.isNotBlank()) {
                Text("改动")
            }
            Box {
                IconButton(onClick = { fileActionsOpen = true }) {
                    Icon(Icons.Filled.MoreVert, "文件操作", tint = AppPalette.TextSecondary)
                }
                DropdownMenu(expanded = fileActionsOpen, onDismissRequest = { fileActionsOpen = false }) {
                    DropdownMenuItem(onClick = {
                        viewModel.loadDiff()
                        fileActionsOpen = false
                    }, enabled = state.activeProjectId.isNotBlank()) {
                        ChatToolMenuLabel(Icons.Filled.Code, "查看改动")
                    }
                    DropdownMenuItem(onClick = {
                        pendingBulkDiffAction = "accept"
                        fileActionsOpen = false
                    }, enabled = state.diffFiles.any { it.status != "accepted" }) {
                        ChatToolMenuLabel(Icons.Filled.Refresh, "接受全部改动")
                    }
                    DropdownMenuItem(onClick = {
                        pendingBulkDiffAction = "revert"
                        fileActionsOpen = false
                    }, enabled = state.diffFiles.isNotEmpty()) {
                        ChatToolMenuLabel(Icons.Filled.Stop, "撤销全部改动")
                    }
                }
            }
        }

        BoxWithConstraints(Modifier.weight(1f)) {
            if (maxWidth < 720.dp) {
                Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FileListPane(
                        state = state,
                        viewModel = viewModel,
                        filteredFiles = filteredFiles,
                        fileQuery = fileQuery,
                        onFileQueryChange = { fileQuery = it },
                        fileKindFilter = fileKindFilter,
                        onFileKindFilterChange = { fileKindFilter = it },
                        fileKindMenuOpen = fileKindMenuOpen,
                        onFileKindMenuOpenChange = { fileKindMenuOpen = it },
                        modifier = Modifier.fillMaxWidth().height(280.dp),
                    )
                    FileWorkspacePane(
                        state = state,
                        viewModel = viewModel,
                        filteredDiffFiles = filteredDiffFiles,
                        diffQuery = diffQuery,
                        onDiffQueryChange = { diffQuery = it },
                        diffStatusFilter = diffStatusFilter,
                        onDiffStatusFilterChange = { diffStatusFilter = it },
                        diffStatusMenuOpen = diffStatusMenuOpen,
                        onDiffStatusMenuOpenChange = { diffStatusMenuOpen = it },
                        fileMode = fileMode,
                        onFileModeChange = { fileMode = it },
                        editedContent = editedContent,
                        onEditedContentChange = { editedContent = it },
                        modifier = Modifier.fillMaxWidth().weight(1f),
                    )
                }
            } else {
                Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FileListPane(
                        state = state,
                        viewModel = viewModel,
                        filteredFiles = filteredFiles,
                        fileQuery = fileQuery,
                        onFileQueryChange = { fileQuery = it },
                        fileKindFilter = fileKindFilter,
                        onFileKindFilterChange = { fileKindFilter = it },
                        fileKindMenuOpen = fileKindMenuOpen,
                        onFileKindMenuOpenChange = { fileKindMenuOpen = it },
                        modifier = Modifier.weight(0.42f),
                    )
                    FileWorkspacePane(
                        state = state,
                        viewModel = viewModel,
                        filteredDiffFiles = filteredDiffFiles,
                        diffQuery = diffQuery,
                        onDiffQueryChange = { diffQuery = it },
                        diffStatusFilter = diffStatusFilter,
                        onDiffStatusFilterChange = { diffStatusFilter = it },
                        diffStatusMenuOpen = diffStatusMenuOpen,
                        onDiffStatusMenuOpenChange = { diffStatusMenuOpen = it },
                        fileMode = fileMode,
                        onFileModeChange = { fileMode = it },
                        editedContent = editedContent,
                        onEditedContentChange = { editedContent = it },
                        modifier = Modifier.weight(0.58f),
                    )
                }
            }
        }
    }
    if (pendingBulkDiffAction.isNotBlank()) {
        val action = pendingBulkDiffAction
        val affectedCount = if (action == "accept") {
            state.diffFiles.count { it.status != "accepted" }
        } else {
            state.diffFiles.size
        }
        androidx.compose.material.AlertDialog(
            onDismissRequest = { pendingBulkDiffAction = "" },
            title = { Text(if (action == "accept") "接受全部改动" else "撤销全部改动") },
            text = {
                Text(
                    if (action == "accept") {
                        "将接受 $affectedCount 个文件的改动。确认后会修改 Git 暂存/工作区状态。"
                    } else {
                        "将撤销 $affectedCount 个文件的改动。这个操作可能丢弃未保存工作区内容。"
                    }
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (action == "accept") {
                        viewModel.acceptAllDiffs()
                    } else {
                        viewModel.revertAllDiffs()
                    }
                    pendingBulkDiffAction = ""
                }) {
                    Text(if (action == "accept") "接受全部" else "撤销全部")
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingBulkDiffAction = "" }) {
                    Text("取消")
                }
            },
        )
    }
}

@Composable
private fun ProjectContextBar(
    state: UiState,
    actionLabel: String,
    emptyText: String,
    onProjectSelected: (Project) -> Unit,
) {
    var projectMenuOpen by remember { mutableStateOf(false) }
    val trustedProjects = state.projects.filter(::isUsableHomeProject)
    val activeProject = trustedProjects.firstOrNull { it.id == state.activeProjectId }
    Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    activeProject?.name ?: "未选择项目",
                    fontWeight = FontWeight.Bold,
                    color = AppPalette.TextPrimary,
                )
                Text(
                    activeProject?.path ?: emptyText,
                    style = MaterialTheme.typography.caption,
                    color = AppPalette.TextSecondary,
                )
            }
            Box {
                Button(
                    onClick = { projectMenuOpen = true },
                    enabled = trustedProjects.isNotEmpty(),
                ) {
                    Text(actionLabel)
                }
                DropdownMenu(expanded = projectMenuOpen, onDismissRequest = { projectMenuOpen = false }) {
                    trustedProjects.forEach { project ->
                        DropdownMenuItem(onClick = {
                            onProjectSelected(project)
                            projectMenuOpen = false
                        }) {
                            Column {
                                Text(project.name, fontWeight = FontWeight.Bold)
                                Text(project.path, style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FileListPane(
    state: UiState,
    viewModel: MainViewModel,
    filteredFiles: List<FileEntry>,
    fileQuery: String,
    onFileQueryChange: (String) -> Unit,
    fileKindFilter: String,
    onFileKindFilterChange: (String) -> Unit,
    fileKindMenuOpen: Boolean,
    onFileKindMenuOpenChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = fileQuery,
                onValueChange = onFileQueryChange,
                modifier = Modifier.weight(1f),
                label = { Text("搜索文件") },
                singleLine = true,
            )
            Spacer(Modifier.width(8.dp))
            Box {
                TextButton(onClick = { onFileKindMenuOpenChange(true) }) {
                    Text(fileKindFilterLabel(fileKindFilter))
                }
                DropdownMenu(expanded = fileKindMenuOpen, onDismissRequest = { onFileKindMenuOpenChange(false) }) {
                    fileKindFilters().forEach { option ->
                        DropdownMenuItem(onClick = {
                            onFileKindFilterChange(option)
                            onFileKindMenuOpenChange(false)
                        }) {
                            Text(fileKindFilterLabel(option))
                        }
                    }
                }
            }
        }
        Text(
            "${filteredFiles.size}/${state.files.size} 个条目",
            style = MaterialTheme.typography.caption,
            color = AppPalette.TextSecondary,
        )
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (state.filePath.isNotBlank()) {
                item {
                    Button(onClick = { viewModel.openDirectory(parentPath(state.filePath)) }) {
                        Text("上一级")
                    }
                }
            }
            if (state.files.isEmpty()) {
                item {
                    Card(backgroundColor = AppPalette.SurfaceVariant, elevation = 0.dp) {
                        Text(
                            text = "当前目录没有文件。",
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            style = MaterialTheme.typography.body2,
                            color = AppPalette.TextSecondary,
                        )
                    }
                }
            } else if (filteredFiles.isEmpty()) {
                item {
                    Card(backgroundColor = AppPalette.SurfaceVariant, elevation = 0.dp) {
                        Text(
                            text = "没有匹配的文件。",
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            style = MaterialTheme.typography.body2,
                            color = AppPalette.TextSecondary,
                        )
                    }
                }
            }
            items(filteredFiles) { entry ->
                FileEntryRow(entry, viewModel)
            }
        }
    }
}

@Composable
private fun FileWorkspacePane(
    state: UiState,
    viewModel: MainViewModel,
    filteredDiffFiles: List<DiffFileEntry>,
    diffQuery: String,
    onDiffQueryChange: (String) -> Unit,
    diffStatusFilter: String,
    onDiffStatusFilterChange: (String) -> Unit,
    diffStatusMenuOpen: Boolean,
    onDiffStatusMenuOpenChange: (Boolean) -> Unit,
    fileMode: String,
    onFileModeChange: (String) -> Unit,
    editedContent: String,
    onEditedContentChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (state.projectDiff.stat.isNotBlank() || state.projectDiff.diff.isNotBlank()) {
            Card(backgroundColor = AppPalette.TertiaryContainer, elevation = 0.dp) {
                Column(Modifier.fillMaxWidth().height(132.dp).padding(10.dp)) {
                    Text("Git 改动", fontWeight = FontWeight.Bold, color = AppPalette.OnTertiaryContainer)
                    Text(
                        text = (state.projectDiff.stat + "\n" + state.projectDiff.diff).trim(),
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.OnTertiaryContainer,
                    )
                }
            }
        }
        if (state.diffFiles.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = diffQuery,
                        onValueChange = onDiffQueryChange,
                        modifier = Modifier.weight(1f),
                        label = { Text("搜索改动") },
                        singleLine = true,
                    )
                    Spacer(Modifier.width(8.dp))
                    Box {
                        TextButton(onClick = { onDiffStatusMenuOpenChange(true) }) {
                            Text(diffStatusFilterLabel(diffStatusFilter))
                        }
                        DropdownMenu(expanded = diffStatusMenuOpen, onDismissRequest = { onDiffStatusMenuOpenChange(false) }) {
                            diffStatusFilters().forEach { option ->
                                DropdownMenuItem(onClick = {
                                    onDiffStatusFilterChange(option)
                                    onDiffStatusMenuOpenChange(false)
                                }) {
                                    Text(diffStatusFilterLabel(option))
                                }
                            }
                        }
                    }
                }
                Text(
                    "${filteredDiffFiles.size}/${state.diffFiles.size} 个改动文件",
                    style = MaterialTheme.typography.caption,
                    color = AppPalette.TextSecondary,
                )
                LazyColumn(Modifier.height(136.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (filteredDiffFiles.isEmpty()) {
                        item {
                            Card(backgroundColor = AppPalette.SurfaceVariant, elevation = 0.dp) {
                                Text(
                                    text = "没有匹配的改动文件。",
                                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                                    style = MaterialTheme.typography.body2,
                                    color = AppPalette.TextSecondary,
                                )
                            }
                        }
                    }
                    items(filteredDiffFiles) { entry ->
                        DiffFileRow(entry, state.selectedFileDiff.path == entry.path, viewModel)
                    }
                }
            }
        }
        if (state.selectedFileDiff.diff.isNotBlank()) {
            Card(backgroundColor = AppPalette.SecondaryContainer, elevation = 0.dp) {
                Column(
                    Modifier.fillMaxWidth()
                        .height(if (state.selectedFileHunks.isEmpty()) 180.dp else 276.dp)
                        .padding(10.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(state.selectedFileDiff.path, fontWeight = FontWeight.Bold, color = AppPalette.OnSecondaryContainer)
                    Text(
                        text = state.selectedFileDiff.diff.take(if (state.selectedFileHunks.isEmpty()) 3200 else 1600),
                        modifier = Modifier.height(if (state.selectedFileHunks.isEmpty()) 140.dp else 70.dp),
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.OnSecondaryContainer,
                    )
                    if (state.selectedFileHunks.isNotEmpty()) {
                        Text("Hunk 操作", fontWeight = FontWeight.Bold, color = AppPalette.OnSecondaryContainer)
                        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            items(state.selectedFileHunks) { hunk ->
                                DiffHunkRow(hunk, viewModel)
                            }
                        }
                    }
                }
            }
        }
        if (state.openedFile.path.isBlank() && state.filePreviewUrl.isBlank()) {
            FileEmptyState()
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = state.openedFile.path.ifBlank { "文件预览" },
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.caption,
                )
                Button(onClick = { onFileModeChange("edit") }, enabled = state.openedFile.editable) {
                    Text("编辑")
                }
                Spacer(Modifier.width(8.dp))
                Button(onClick = { onFileModeChange("preview") }, enabled = state.filePreviewUrl.isNotBlank()) {
                    Text("预览")
                }
            }
            if (fileMode == "preview" || !state.openedFile.editable) {
                FilePreviewPane(state.openedFile.path, state.openedFile.content, state.filePreviewUrl, Modifier.weight(1f))
            } else {
                OutlinedTextField(
                    value = editedContent,
                    onValueChange = onEditedContentChange,
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    label = { Text(state.openedFile.path.ifBlank { "文件内容" }) },
                )
                Button(
                    onClick = { viewModel.saveOpenedFile(editedContent) },
                    enabled = state.openedFile.editable,
                ) {
                    Text("保存文件")
                }
            }
        }
    }
}

@Composable
private fun FileEntryRow(entry: FileEntry, viewModel: MainViewModel) {
    Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(10.dp)) {
            Text(
                text = if (entry.kind == "directory") "[目录] ${entry.name}" else entry.name,
                fontWeight = if (entry.kind == "directory") FontWeight.Bold else FontWeight.Normal,
            )
            Text(entry.path, style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
            Spacer(Modifier.height(6.dp))
            Button(onClick = {
                if (entry.kind == "directory") viewModel.openDirectory(entry.path) else viewModel.openFile(entry)
            }) {
                Text(if (entry.kind == "directory") "进入" else "打开")
            }
        }
    }
}

@Composable
private fun FileEmptyState() {
    Card(backgroundColor = AppPalette.SurfaceVariant, elevation = 0.dp) {
        Text(
            text = "选择文件后可直接编辑或预览。",
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            style = MaterialTheme.typography.body2,
        )
    }
}

@Composable
private fun FilePreviewPane(path: String, content: String, url: String, modifier: Modifier = Modifier) {
    val kind = filePreviewKind(path)
    Card(backgroundColor = AppPalette.Surface, modifier = modifier.fillMaxWidth(), elevation = 0.dp) {
        when {
            url.isBlank() -> {
                Text(
                    text = "暂无可预览内容。",
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    style = MaterialTheme.typography.body2,
                )
            }
            kind == "text" && content.isNotBlank() -> {
                Text(
                    text = content.take(8000),
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.caption,
                )
            }
            else -> {
                AndroidView(
                    modifier = Modifier.fillMaxSize().padding(6.dp),
                    factory = { context ->
                        WebView(context).apply {
                            settings.javaScriptEnabled = kind == "web"
                            settings.builtInZoomControls = true
                            settings.displayZoomControls = false
                            loadUrl(url)
                        }
                    },
                    update = { webView -> webView.loadUrl(url) },
                )
            }
        }
    }
}

@Composable
private fun DiffFileRow(entry: DiffFileEntry, selected: Boolean, viewModel: MainViewModel) {
    Card(backgroundColor = if (selected) AppPalette.PrimaryContainer else AppPalette.Surface, elevation = 0.dp) {
        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(entry.path, fontWeight = FontWeight.Bold)
                Text(
                    text = listOf(
                        diffStatusLabel(entry.status),
                        if (entry.additions > 0) "+${entry.additions}" else "",
                        if (entry.deletions > 0) "-${entry.deletions}" else "",
                        if (entry.oldPath.isNotBlank()) "from ${entry.oldPath}" else "",
                    ).filter { it.isNotBlank() }.joinToString(" · "),
                    style = MaterialTheme.typography.caption,
                )
            }
            Button(onClick = { viewModel.openFileDiff(entry) }) {
                Text("Diff")
            }
            Spacer(Modifier.width(8.dp))
            Button(onClick = { viewModel.acceptFileDiff(entry) }, enabled = entry.status != "accepted") {
                Text("接受")
            }
            Spacer(Modifier.width(8.dp))
            Button(onClick = { viewModel.revertFileDiff(entry) }) {
                Text("撤销")
            }
        }
    }
}

@Composable
private fun DiffHunkRow(hunk: DiffHunk, viewModel: MainViewModel) {
    Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${diffSourceLabel(hunk.source)} #${hunk.index + 1}", fontWeight = FontWeight.Bold)
                    Text(hunk.header, style = MaterialTheme.typography.caption, fontFamily = FontFamily.Monospace)
                }
                Button(onClick = { viewModel.acceptDiffHunk(hunk) }, enabled = hunk.source == "worktree") {
                    Text("接受")
                }
                Spacer(Modifier.width(8.dp))
                Button(onClick = { viewModel.revertDiffHunk(hunk) }) {
                    Text("撤销")
                }
            }
            Text(
                text = hunk.text.take(1200),
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.caption,
            )
        }
    }
}

@Composable
private fun BrowserPanel(state: UiState, viewModel: MainViewModel) {
    var previewInput by remember { mutableStateOf("") }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = previewInput,
                onValueChange = { previewInput = it },
                modifier = Modifier.weight(1f),
                label = { Text("本机浏览器地址") },
                placeholder = { Text("localhost:5173") },
                singleLine = true,
            )
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = { viewModel.setPreviewUrl(previewInput) },
                enabled = previewInput.isNotBlank(),
            ) {
                Text("打开")
            }
        }
        if (state.browserPreviewUrl.isNotBlank()) {
            AndroidView(
                modifier = Modifier.fillMaxWidth().weight(1f),
                factory = { context ->
                    WebView(context).apply {
                        settings.javaScriptEnabled = true
                        loadUrl(state.browserPreviewUrl)
                    }
                },
                update = { webView -> webView.loadUrl(state.browserPreviewUrl) },
            )
        } else {
            Card(backgroundColor = AppPalette.SurfaceVariant, elevation = 0.dp) {
                Text(
                    text = "输入电脑本机 localhost 预览地址后打开。",
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    style = MaterialTheme.typography.body2,
                )
            }
        }
    }
}

@Composable
internal fun TerminalPanel(state: UiState, viewModel: MainViewModel) {
    var command by remember { mutableStateOf("") }
    var historyQuery by remember { mutableStateOf("") }
    var statusFilter by remember { mutableStateOf("all") }
    var statusMenuOpen by remember { mutableStateOf(false) }
    var terminalSessionInput by remember { mutableStateOf("") }
    var rawInputMode by remember { mutableStateOf(false) }
    var terminalPanelSize by remember { mutableStateOf(PanelPixelSize()) }
    var lastResizedSessionKey by rememberSaveable { mutableStateOf("") }
    var lastHandledTerminalFocusRequestId by rememberSaveable { mutableStateOf(0L) }
    var extraShortcutKeysExpanded by rememberSaveable { mutableStateOf(false) }
    val historyListState = rememberLazyListState()
    val sessionSwitcherScroll = rememberScrollState()
    val terminalCommands = remember(state.terminalCommands, state.events) {
        mergeTerminalCommands(state.terminalCommands, terminalCommandsFromEvents(state.events))
    }
    val projectTerminalCommands = remember(terminalCommands, state.projects, state.activeProjectId) {
        terminalCommandsForActiveProject(terminalCommands, state.projects, state.activeProjectId)
    }
    val filteredTerminalCommands = remember(projectTerminalCommands, historyQuery, statusFilter) {
        filterTerminalCommands(projectTerminalCommands, historyQuery, statusFilter)
    }
    val runningTerminalCount = remember(projectTerminalCommands) { terminalRunningCount(projectTerminalCommands) }
    val runningInteractiveSessions = remember(projectTerminalCommands) { interactiveTerminalSessions(projectTerminalCommands) }
    var activeSessionId by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(runningInteractiveSessions.map { it.commandId to it.status }) {
        activeSessionId = resolveInteractiveSessionSelection(activeSessionId, runningInteractiveSessions)
    }
    LaunchedEffect(state.terminalFocusRequestId) {
        if (state.terminalFocusRequestId <= lastHandledTerminalFocusRequestId || state.terminalFocusCommandId.isBlank()) {
            return@LaunchedEffect
        }
        historyQuery = ""
        statusFilter = "all"
        if (state.terminalFocusInteractive) {
            activeSessionId = state.terminalFocusCommandId
        }
    }
    LaunchedEffect(state.terminalFocusRequestId, state.terminalFocusCommandId, filteredTerminalCommands) {
        if (state.terminalFocusRequestId <= lastHandledTerminalFocusRequestId || state.terminalFocusCommandId.isBlank()) {
            return@LaunchedEffect
        }
        val targetIndex = filteredTerminalCommands.indexOfFirst { it.commandId == state.terminalFocusCommandId }
        if (targetIndex >= 0) {
            historyListState.animateScrollToItem(targetIndex)
            lastHandledTerminalFocusRequestId = state.terminalFocusRequestId
        }
    }
    val activeSession = remember(runningInteractiveSessions, activeSessionId) {
        runningInteractiveSessions.firstOrNull { it.commandId == activeSessionId }
    }
    val activeSessionIndex = remember(runningInteractiveSessions, activeSessionId) {
        runningInteractiveSessions.indexOfFirst { it.commandId == activeSessionId }.takeIf { it >= 0 } ?: 0
    }
    val canSendTerminalInput = canSendTerminalSessionInput(rawInputMode, terminalSessionInput)
    val terminalInputImeAction = terminalSessionImeAction(rawInputMode)
    val estimatedViewport = remember(terminalPanelSize) {
        estimateTerminalViewport(terminalPanelSize.width, terminalPanelSize.height)
    }
    val sendTerminalInput = {
        activeSession?.let {
            if (canSendTerminalInput) {
                viewModel.sendTerminalSessionInput(it.commandId, terminalSessionInput, appendNewline = !rawInputMode)
                terminalSessionInput = ""
            }
        }
    }
    LaunchedEffect(activeSession?.commandId, estimatedViewport) {
        val sessionId = activeSession?.commandId.orEmpty()
        val viewport = estimatedViewport
        if (sessionId.isBlank() || viewport == null) {
            return@LaunchedEffect
        }
        val nextKey = "${sessionId}:${viewport.cols}x${viewport.rows}"
        if (nextKey != lastResizedSessionKey) {
            lastResizedSessionKey = nextKey
            viewModel.resizeTerminalSession(sessionId, viewport.cols, viewport.rows)
        }
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .onSizeChanged { terminalPanelSize = PanelPixelSize(it.width, it.height) },
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ProjectContextBar(
            state = state,
            actionLabel = "切换",
            emptyText = "暂无项目。先到项目管理添加项目，再运行终端命令。",
            onProjectSelected = viewModel::selectTerminalProject,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = command,
                onValueChange = { command = it },
                modifier = Modifier.weight(1f),
                label = { Text("终端命令") },
                singleLine = true,
            )
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = {
                    viewModel.runTerminalCommand(command)
                    command = ""
                },
                enabled = state.connected && command.isNotBlank() && state.activeProjectId.isNotBlank(),
            ) {
                Text("运行")
            }
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = viewModel::startTerminalSession,
                enabled = state.connected && state.activeProjectId.isNotBlank(),
            ) {
                Text("会话")
            }
        }
        Card(backgroundColor = AppPalette.Terminal, elevation = 0.dp) {
            Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("当前交互会话", color = Color(0xFFE4E7EC), fontWeight = FontWeight.Bold)
                        Text(
                            text = activeSession?.let {
                                listOf(
                                    if (runningInteractiveSessions.size > 1) "已选 ${activeSessionIndex + 1}/${runningInteractiveSessions.size}" else "",
                                    it.command,
                                    it.cwd,
                                ).filter { part -> part.isNotBlank() }.joinToString(" · ")
                            } ?: "没有活跃交互会话，点击上面的“会话”创建一个。",
                            color = AppPalette.TerminalMuted,
                            style = MaterialTheme.typography.caption,
                        )
                    }
                    StatusPill(
                        text = if (activeSession != null) {
                            if (runningInteractiveSessions.size > 1) "会话 ${runningInteractiveSessions.size}" else "在线"
                        } else {
                            "空闲"
                        },
                        positive = activeSession != null,
                    )
                }
                if (runningInteractiveSessions.isNotEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(sessionSwitcherScroll),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        runningInteractiveSessions.forEachIndexed { index, session ->
                            TerminalModeButton(
                                label = terminalSessionChipLabel(session, index, runningInteractiveSessions.size),
                                selected = session.commandId == activeSessionId,
                                onClick = { activeSessionId = session.commandId },
                            )
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        InputModeToggle(
                            rawInputMode = rawInputMode,
                            onRawInputModeChange = { rawInputMode = it },
                        )
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = { extraShortcutKeysExpanded = !extraShortcutKeysExpanded }) {
                            Text(if (extraShortcutKeysExpanded) "收起" else "更多")
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = terminalSessionInput,
                            onValueChange = { terminalSessionInput = it },
                            modifier = Modifier.weight(1f),
                            label = { Text(if (rawInputMode) "原样发送到当前会话" else "发送到当前会话", color = AppPalette.TerminalMuted) },
                            placeholder = {
                                Text(
                                    if (rawInputMode) "可粘贴多行文本、空格或控制序列片段"
                                    else "输入一条命令或一行交互输入",
                                    color = AppPalette.TerminalMuted,
                                )
                            },
                            singleLine = !rawInputMode,
                            maxLines = if (rawInputMode) 4 else 1,
                            keyboardOptions = KeyboardOptions(imeAction = terminalInputImeAction),
                            keyboardActions = KeyboardActions(
                                onSend = {
                                    if (!rawInputMode) {
                                        sendTerminalInput()
                                    }
                                },
                            ),
                        )
                        Spacer(Modifier.width(8.dp))
                        IconButton(
                            onClick = { sendTerminalInput() },
                            enabled = activeSession != null && canSendTerminalInput,
                        ) {
                            Icon(
                                Icons.Filled.Send,
                                if (rawInputMode) "原样发送到交互会话" else "发送到交互会话",
                                tint = if (activeSession != null && canSendTerminalInput) AppPalette.Primary else AppPalette.TextSecondary,
                            )
                        }
                        Spacer(Modifier.width(4.dp))
                        IconButton(
                            onClick = { activeSession?.let { viewModel.stopTerminalSession(it.commandId) } },
                            enabled = activeSession != null,
                        ) {
                            Icon(
                                Icons.Filled.Stop,
                                "停止交互会话",
                                tint = if (activeSession != null) Color(0xFFF87171) else AppPalette.TextSecondary,
                            )
                        }
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        terminalPrimaryShortcuts().forEach { shortcut ->
                            TerminalShortcutButton(
                                shortcut = shortcut,
                                enabled = activeSession != null,
                                onClick = {
                                    activeSession?.let {
                                        viewModel.sendTerminalSessionInput(it.commandId, shortcut.sequence, appendNewline = false)
                                    }
                                },
                            )
                        }
                    }
                    if (extraShortcutKeysExpanded) {
                        terminalSecondaryShortcutRows().forEach { shortcuts ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                shortcuts.forEach { shortcut ->
                                    TerminalShortcutButton(
                                        shortcut = shortcut,
                                        modifier = Modifier.weight(1f),
                                        enabled = activeSession != null,
                                        onClick = {
                                            activeSession?.let {
                                                viewModel.sendTerminalSessionInput(it.commandId, shortcut.sequence, appendNewline = false)
                                            }
                                        },
                                    )
                                }
                            }
                        }
                    }
                    Text(
                        if (rawInputMode) "模式：原样" else "模式：回车",
                        color = AppPalette.TerminalMuted,
                        style = MaterialTheme.typography.caption,
                    )
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = historyQuery,
                onValueChange = { historyQuery = it },
                modifier = Modifier.weight(1f),
                label = { Text("搜索") },
                singleLine = true,
            )
            Spacer(Modifier.width(8.dp))
            Box {
                TextButton(onClick = { statusMenuOpen = true }) {
                    Text(
                        terminalHistoryToolbarLabel(
                            status = statusFilter,
                            filteredCount = filteredTerminalCommands.size,
                            totalCount = projectTerminalCommands.size,
                            runningCount = runningTerminalCount,
                        )
                    )
                }
                DropdownMenu(expanded = statusMenuOpen, onDismissRequest = { statusMenuOpen = false }) {
                    terminalStatusFilters().forEach { option ->
                        DropdownMenuItem(onClick = {
                            statusFilter = option
                            statusMenuOpen = false
                        }) {
                            Text(terminalStatusFilterLabel(option))
                        }
                    }
                }
            }
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = viewModel::refreshTerminalCommands, enabled = state.connected) {
                Icon(Icons.Filled.Refresh, "刷新终端记录", tint = AppPalette.TextSecondary)
            }
        }
        LazyColumn(
            state = historyListState,
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
        if (projectTerminalCommands.isEmpty()) {
            item {
                Card(backgroundColor = AppPalette.SurfaceVariant, elevation = 0.dp) {
                    Text(
                        text = if (state.activeProjectId.isBlank()) "暂无终端命令。" else "当前项目暂无终端命令。",
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        style = MaterialTheme.typography.body2,
                    )
                }
            }
        } else if (filteredTerminalCommands.isEmpty()) {
            item {
                Card(backgroundColor = AppPalette.SurfaceVariant, elevation = 0.dp) {
                    Text(
                        text = "没有匹配的终端记录。",
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        style = MaterialTheme.typography.body2,
                    )
                }
            }
        }
        items(filteredTerminalCommands, key = { "terminal-page-${it.commandId}" }) { record ->
            TerminalCommandBlock(
                record = record,
                viewModel = viewModel,
                onResumeInteractive = {
                    viewModel.focusTerminalCommand(
                        commandId = it.commandId,
                        threadId = it.threadId,
                        cwd = it.cwd,
                        interactive = it.interactive,
                    )
                },
            )
        }
        }
    }
}

@Composable
internal fun ConversationPanel(
    state: UiState,
    viewModel: MainViewModel,
    onOpenTab: (Int) -> Unit,
    onOpenConnectionSettings: () -> Unit,
) {
    var toolMenuOpen by remember { mutableStateOf(false) }
    var modelMenuOpen by remember { mutableStateOf(false) }
    var customModelDialogOpen by remember { mutableStateOf(false) }
    var customModelDraft by remember { mutableStateOf("") }
    var threadDialogOpen by remember { mutableStateOf(false) }
    var quickSettings by remember(state.settings) { mutableStateOf(state.settings) }
    val turnRunning = isTurnRunning(state)
    val activeProject = state.projects.firstOrNull { it.id == state.activeProjectId && isUsableHomeProject(it) }
    val canSubmitDraft = canSubmitChatDraft(state.connected, state.chatDraft, state.pendingConversationStart, turnRunning)
    val canContinue = canRunQuickChatAction(state.connected, state.pendingConversationStart, turnRunning, "继续")
    val canRetry = canRunQuickChatAction(state.connected, state.pendingConversationStart, turnRunning, state.lastUserPrompt)
    val canStartThread = canStartEmptyThread(state.connected, state.pendingConversationStart, turnRunning, activeProject)
    val conversationEvents = remember(state.events, state.activeThreadId) {
        state.events.filter { event -> isConversationEventForThread(event, state.activeThreadId) }
    }
    val blocks = remember(conversationEvents) { aggregateConversationEvents(conversationEvents) }
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    val showJumpToBottom by remember(blocks.size) {
        derivedStateOf {
            val lastVisibleIndex = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            blocks.isNotEmpty() && !shouldFollowConversationTail(lastVisibleIndex, blocks.size)
        }
    }
    LaunchedEffect(blocks.size, blocks.lastOrNull()?.event?.text?.length ?: 0) {
        val lastVisibleIndex = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
        if (blocks.isNotEmpty() && shouldFollowConversationTail(lastVisibleIndex, blocks.size)) {
            listState.animateScrollToItem(blocks.lastIndex)
        }
    }
    LaunchedEffect(state.connected, state.activeThreadId) {
        while (state.connected && state.activeThreadId.isNotBlank()) {
            viewModel.refreshActiveThreadEvents()
            delay(2000)
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ConversationStatusStrip(
            project = activeProject,
            running = turnRunning,
            pendingStart = state.pendingConversationStart,
            model = quickSettings.model,
        )
        Box(Modifier.weight(1f)) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                itemsIndexed(blocks, key = { _, block -> block.key }) { index, block ->
                    val event = block.event
                    when (event.type) {
                        "terminal.output" -> TerminalBlock(block, viewModel)
                        "user.message" -> UserMessageBlock(event)
                        "message.delta" -> MessageBlock(
                            event = event,
                            animate = index == blocks.lastIndex && turnRunning,
                        )
                        "tool.started", "tool.output", "tool.completed" -> ToolBlock(event)
                        "approval.requested" -> ApprovalBlock(event, viewModel)
                        "file.changed" -> FileChangedBlock(event) {
                            if (viewModel.openActiveProjectFiles()) {
                                onOpenTab(0)
                            }
                        }
                        "diff.updated" -> DiffBlock(event) {
                            if (viewModel.loadDiff()) {
                                onOpenTab(0)
                            }
                        }
                        "warning" -> WarningBlock(event)
                        else -> StatusBlock(event)
                    }
                }
            }
            if (blocks.isEmpty()) {
                ConversationEmptyState(
                    modifier = Modifier.align(Alignment.Center).padding(18.dp),
                    connected = state.connected,
                    pendingStart = state.pendingConversationStart,
                    project = activeProject,
                )
            }
            if (showJumpToBottom) {
                GlassCard(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(10.dp)
                        .clickable {
                            coroutineScope.launch {
                                if (blocks.isNotEmpty()) {
                                    listState.animateScrollToItem(blocks.lastIndex)
                                }
                            }
                        },
                    backgroundColor = AppPalette.GlassStrong,
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.KeyboardArrowDown, "跳到底部", tint = AppPalette.Primary)
                        Spacer(Modifier.width(4.dp))
                        Text("跳到底部", style = MaterialTheme.typography.caption, color = AppPalette.TextPrimary)
                    }
                }
            }
        }
        GlassCard(backgroundColor = AppPalette.GlassStrong) {
            Column(Modifier.fillMaxWidth().padding(8.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        IconButton(onClick = { toolMenuOpen = true }) {
                            Icon(Icons.Filled.Add, "更多工具", tint = AppPalette.TextSecondary)
                        }
                        DropdownMenu(expanded = toolMenuOpen, onDismissRequest = { toolMenuOpen = false }) {
                            DropdownMenuItem(onClick = {
                                threadDialogOpen = true
                                toolMenuOpen = false
                            }) {
                                ChatToolMenuLabel(Icons.Filled.Chat, "会话列表")
                            }
                            DropdownMenuItem(
                                onClick = {
                                    viewModel.startThread(activeProject)
                                    toolMenuOpen = false
                                },
                                enabled = canStartThread,
                            ) {
                                ChatToolMenuLabel(Icons.Filled.Add, "新会话")
                            }
                            DropdownMenuItem(onClick = {
                                if (viewModel.openActiveProjectFiles()) {
                                    onOpenTab(0)
                                }
                                toolMenuOpen = false
                            }) {
                                ChatToolMenuLabel(Icons.Filled.Folder, "当前项目文件")
                            }
                            DropdownMenuItem(
                                onClick = {
                                    viewModel.continueLastTurn()
                                    toolMenuOpen = false
                                },
                                enabled = canContinue,
                            ) {
                                ChatToolMenuLabel(Icons.Filled.Chat, "继续")
                            }
                            DropdownMenuItem(
                                onClick = {
                                    viewModel.retryLastTurn()
                                    toolMenuOpen = false
                                },
                                enabled = canRetry,
                            ) {
                                ChatToolMenuLabel(Icons.Filled.Refresh, "重试上一条")
                            }
                            DropdownMenuItem(onClick = {
                                onOpenTab(3)
                                toolMenuOpen = false
                            }) {
                                ChatToolMenuLabel(Icons.Filled.Code, "终端")
                            }
                            DropdownMenuItem(onClick = {
                                onOpenTab(2)
                                toolMenuOpen = false
                            }) {
                                ChatToolMenuLabel(Icons.Filled.Language, "浏览器预览")
                            }
                            DropdownMenuItem(onClick = {
                                onOpenTab(4)
                                toolMenuOpen = false
                            }) {
                                ChatToolMenuLabel(Icons.Filled.Work, "项目管理")
                            }
                            DropdownMenuItem(onClick = {
                                onOpenConnectionSettings()
                                toolMenuOpen = false
                            }) {
                                ChatToolMenuLabel(Icons.Filled.Tune, "连接设置")
                            }
                        }
                    }
                    OutlinedTextField(
                        value = state.chatDraft,
                        onValueChange = viewModel::updateChatDraft,
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("向 Codex 发送消息") },
                        maxLines = 4,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(
                            onSend = {
                                if (turnRunning) {
                                    viewModel.stopTurn()
                                } else if (canSubmitDraft) {
                                    viewModel.sendChatDraft()
                                }
                            },
                        ),
                    )
                    Spacer(Modifier.width(8.dp))
                    IconButton(
                        onClick = {
                            if (turnRunning) {
                                viewModel.stopTurn()
                            } else {
                                viewModel.sendChatDraft()
                            }
                        },
                        enabled = (turnRunning && state.connected) || canSubmitDraft,
                    ) {
                        Icon(
                            if (turnRunning) Icons.Filled.Stop else Icons.Filled.Send,
                            if (turnRunning) "停止" else "发送",
                            tint = if ((turnRunning && state.connected) || canSubmitDraft) AppPalette.Primary else AppPalette.TextSecondary,
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        Card(
                            modifier = Modifier.clickable { modelMenuOpen = true },
                            backgroundColor = AppPalette.SurfaceVariant,
                            elevation = 0.dp,
                            shape = RoundedCornerShape(50.dp),
                        ) {
                            Row(
                                Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    quickSettings.model.ifBlank { "默认模型" },
                                    modifier = Modifier.width(132.dp),
                                    style = MaterialTheme.typography.caption,
                                    color = AppPalette.TextPrimary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Icon(Icons.Filled.KeyboardArrowDown, "选择模型", tint = AppPalette.TextSecondary)
                            }
                        }
                        DropdownMenu(expanded = modelMenuOpen, onDismissRequest = { modelMenuOpen = false }) {
                            DropdownMenuItem(onClick = {
                                val next = quickSettings.copy(model = "")
                                quickSettings = next
                                viewModel.saveSettings(next)
                                modelMenuOpen = false
                            }) {
                                Text("默认")
                            }
                            modelChoices(quickSettings.model, state.rawCodexConfig.content).forEach { model ->
                                DropdownMenuItem(onClick = {
                                    val next = quickSettings.copy(model = model)
                                    quickSettings = next
                                    viewModel.saveSettings(next)
                                    modelMenuOpen = false
                                }) {
                                    Text(model.ifBlank { "默认" })
                                }
                            }
                            DropdownMenuItem(onClick = {
                                customModelDraft = quickSettings.model
                                customModelDialogOpen = true
                                modelMenuOpen = false
                            }) {
                                Text("自定义模型...")
                            }
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    val inputHint = when {
                        !state.connected -> "离线"
                        state.pendingConversationStart -> "会话启动中"
                        turnRunning -> "点停止中断"
                        state.chatDraft.isBlank() -> "输入后发送"
                        else -> ""
                    }
                    if (inputHint.isNotBlank()) {
                        Text(
                            inputHint,
                            style = MaterialTheme.typography.caption,
                            color = AppPalette.TextSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
        if (threadDialogOpen) {
            ThreadPickerDialog(
                state = state,
                viewModel = viewModel,
                project = activeProject,
                onDismiss = { threadDialogOpen = false },
            )
        }
        if (customModelDialogOpen) {
            androidx.compose.material.AlertDialog(
                onDismissRequest = { customModelDialogOpen = false },
                title = { Text("自定义模型") },
                text = {
                    OutlinedTextField(
                        value = customModelDraft,
                        onValueChange = { customModelDraft = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("模型名称") },
                        placeholder = { Text("留空使用默认模型") },
                        singleLine = true,
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        val next = quickSettings.copy(model = customModelDraft.trim())
                        quickSettings = next
                        viewModel.saveSettings(next)
                        customModelDialogOpen = false
                    }) {
                        Text("保存")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { customModelDialogOpen = false }) {
                        Text("取消")
                    }
                },
            )
        }
    }
}

@Composable
private fun ConversationEmptyState(
    connected: Boolean,
    pendingStart: Boolean,
    project: Project?,
    modifier: Modifier = Modifier,
) {
    GlassCard(modifier = modifier, backgroundColor = AppPalette.Glass) {
        Column(
            Modifier.fillMaxWidth().padding(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                when {
                    !connected -> "未连接电脑端"
                    pendingStart -> "正在创建会话"
                    project == null -> "先选择项目"
                    else -> "开始和 Codex 对话"
                },
                fontWeight = FontWeight.Bold,
                color = AppPalette.TextPrimary,
            )
            Text(
                project?.name ?: "从首页点项目或会话进入",
                style = MaterialTheme.typography.caption,
                color = AppPalette.TextSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ChatToolMenuLabel(icon: ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, text, tint = AppPalette.Primary)
        Spacer(Modifier.width(10.dp))
        Text(text)
    }
}

@Composable
private fun ConversationStatusStrip(
    project: Project?,
    running: Boolean,
    pendingStart: Boolean,
    model: String,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 1.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusDot(running || pendingStart)
        Spacer(Modifier.width(8.dp))
        Text(
            project?.name ?: "未选择项目",
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.caption,
            color = AppPalette.TextSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            when {
                pendingStart -> "启动中"
                running -> "运行中"
                model.isNotBlank() -> model
                else -> "默认模型"
            },
            style = MaterialTheme.typography.caption,
            color = AppPalette.TextSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ThreadPickerDialog(state: UiState, viewModel: MainViewModel, project: Project?, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val projectThreads = remember(state.threads, project) {
        threadsForProject(state.threads, project)
    }
    val filteredThreads = remember(projectThreads, state.projects, query) {
        projectThreads.filter { threadMatchesQuery(it, state.projects, query) }
    }
    androidx.compose.material.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(project?.name ?: "会话列表") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SearchField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = "搜索会话或项目",
                )
                Text(
                    "${filteredThreads.size}/${projectThreads.size} 个会话",
                    style = MaterialTheme.typography.caption,
                    color = AppPalette.TextSecondary,
                )
                LazyColumn(Modifier.height(320.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (project == null) {
                        item {
                            Text("先从首页选择一个项目。", color = AppPalette.TextSecondary)
                        }
                    } else if (projectThreads.isEmpty()) {
                        item {
                            Text("当前项目暂无会话。", color = AppPalette.TextSecondary)
                        }
                    } else if (filteredThreads.isEmpty()) {
                        item {
                            Text("没有匹配的会话。", color = AppPalette.TextSecondary)
                        }
                    }
                    items(filteredThreads) { thread ->
                        ThreadRow(
                            thread = thread,
                            selected = state.activeThreadId == thread.id,
                            projectLabel = threadProjectLabel(thread, state.projects),
                            onOpen = {
                                viewModel.openThread(thread)
                                onDismiss()
                            },
                            onRename = viewModel::renameThread,
                            onDelete = viewModel::deleteThread,
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("完成")
            }
        },
    )
}

@Composable
private fun ThreadRow(
    thread: ThreadRecord,
    selected: Boolean,
    projectLabel: String = "",
    onOpen: () -> Unit,
    onRename: ((ThreadRecord, String) -> Unit)? = null,
    onDelete: ((ThreadRecord) -> Unit)? = null,
) {
    var menuOpen by remember(thread.id) { mutableStateOf(false) }
    var renameOpen by remember(thread.id) { mutableStateOf(false) }
    var deleteOpen by remember(thread.id) { mutableStateOf(false) }
    var renameDraft by remember(thread.id, thread.title) { mutableStateOf(thread.title) }
    GlassCard(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
        backgroundColor = if (selected) AppPalette.PrimaryContainer else AppPalette.Glass,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    thread.title.ifBlank { thread.id },
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    thread.status.ifBlank { compactTime(thread.updatedAt) },
                    style = MaterialTheme.typography.caption,
                    color = AppPalette.TextSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val resolvedProjectLabel = projectLabel.ifBlank { thread.projectPath }
                if (resolvedProjectLabel.isNotBlank()) {
                    Text(
                        resolvedProjectLabel,
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.TextSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            if (onRename != null || onDelete != null) {
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Filled.MoreVert, "会话操作", tint = AppPalette.TextSecondary)
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        if (onRename != null) {
                            DropdownMenuItem(onClick = {
                                renameDraft = thread.title.ifBlank { thread.id }
                                renameOpen = true
                                menuOpen = false
                            }) {
                                Text("重命名")
                            }
                        }
                        if (onDelete != null) {
                            DropdownMenuItem(onClick = {
                                deleteOpen = true
                                menuOpen = false
                            }) {
                                Text("删除")
                            }
                        }
                    }
                }
            }
        }
    }
    if (renameOpen && onRename != null) {
        androidx.compose.material.AlertDialog(
            onDismissRequest = { renameOpen = false },
            title = { Text("重命名会话") },
            text = {
                OutlinedTextField(
                    value = renameDraft,
                    onValueChange = { renameDraft = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("会话名称") },
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onRename(thread, renameDraft)
                        renameOpen = false
                    },
                    enabled = renameDraft.trim().isNotBlank(),
                ) {
                    Text("保存")
                }
            },
            dismissButton = {
                TextButton(onClick = { renameOpen = false }) {
                    Text("取消")
                }
            },
        )
    }
    if (deleteOpen && onDelete != null) {
        androidx.compose.material.AlertDialog(
            onDismissRequest = { deleteOpen = false },
            title = { Text("删除会话") },
            text = { Text("会从手机控制台的会话列表中移除，并清理这条会话在控制台里的消息记录。") },
            confirmButton = {
                TextButton(onClick = {
                    onDelete(thread)
                    deleteOpen = false
                }) {
                    Text("删除")
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteOpen = false }) {
                    Text("取消")
                }
            },
        )
    }
}

@Composable
private fun ToolBlock(event: ChatEvent) {
    var expanded by remember(event.itemId, event.text) { mutableStateOf(event.text.length < 480) }
    GlassCard(backgroundColor = AppPalette.SurfaceVariant) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(toolBlockTitle(event), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.body2, color = AppPalette.TextPrimary)
            if (event.detail.isNotBlank()) {
                Text(event.detail, style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
            }
            if (event.text.isNotBlank()) {
                if (expanded) {
                    Text(event.text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                } else {
                    Text("输出已折叠 · ${event.text.length} 字符", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                }
                if (event.text.length >= 480) {
                    TextButton(onClick = { expanded = !expanded }) {
                        Text(if (expanded) "收起输出" else "展开输出")
                    }
                }
            }
            if (event.status.isNotBlank()) {
                Text("状态：${event.status}", style = MaterialTheme.typography.caption)
            }
        }
    }
}

private fun toolBlockTitle(event: ChatEvent): String {
    if (event.title.isNotBlank()) return event.title
    return when (event.type) {
        "tool.output" -> "工具输出"
        "tool.started" -> "工具开始"
        "tool.completed" -> "工具完成"
        else -> event.type
    }
}

@Composable
private fun ApprovalBlock(event: ChatEvent, viewModel: MainViewModel) {
    Card(backgroundColor = AppPalette.TertiaryContainer, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("需要审批 · ${approvalTypeLabel(event.approvalType)}", fontWeight = FontWeight.Bold, color = AppPalette.OnTertiaryContainer)
            Text(event.title.ifBlank { "Codex 请求继续操作" })
            Text(approvalHint(event.approvalType), style = MaterialTheme.typography.caption, color = AppPalette.OnTertiaryContainer)
            if (event.detail.isNotBlank()) {
                Text(event.detail, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.caption)
            }
            Row {
                Button(onClick = { viewModel.resolveApproval(event.approvalId, "accept") }) {
                    Text(approvalAcceptLabel(event.approvalType))
                }
                Spacer(Modifier.width(8.dp))
                Button(onClick = { viewModel.resolveApproval(event.approvalId, "decline") }) {
                    Text("拒绝")
                }
            }
        }
    }
}

@Composable
private fun FileChangedBlock(event: ChatEvent, onOpenFiles: () -> Unit) {
    GlassCard(backgroundColor = AppPalette.PrimaryContainer) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(event.summaryOrTitle("文件变更"), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.body2)
            event.files.forEach { file ->
                Text(file, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.caption)
            }
            TextButton(onClick = onOpenFiles) {
                Text("打开文件")
            }
        }
    }
}

@Composable
private fun DiffBlock(event: ChatEvent, onOpenFiles: () -> Unit) {
    GlassCard(backgroundColor = AppPalette.SecondaryContainer) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("Diff 已更新", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.body2)
            Text(event.diff.take(1600), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.caption)
            TextButton(onClick = {
                onOpenFiles()
            }) {
                Text("查看改动")
            }
        }
    }
}

@Composable
private fun WarningBlock(event: ChatEvent) {
    GlassCard(backgroundColor = AppPalette.ErrorContainer) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(event.title.ifBlank { "警告" }, fontWeight = FontWeight.Bold)
            if (event.detail.isNotBlank()) {
                Text(event.detail, style = MaterialTheme.typography.caption)
            }
        }
    }
}

@Composable
private fun UserMessageBlock(event: ChatEvent) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Card(
            backgroundColor = AppPalette.PrimaryContainer,
            elevation = 0.dp,
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier.fillMaxWidth(0.86f),
        ) {
            Row(
                Modifier.padding(start = 13.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    text = event.text,
                    modifier = Modifier.weight(1f).padding(top = 2.dp),
                    style = MaterialTheme.typography.body1,
                    color = AppPalette.OnPrimaryContainer,
                )
                if (isPendingOutgoingUserMessage(event)) {
                    Text(
                        "发送中",
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 10.dp),
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.TextSecondary,
                    )
                } else {
                    MessageActionsMenu(label = "User message", text = event.text)
                }
            }
        }
    }
}

@Composable
private fun MessageBlock(event: ChatEvent, animate: Boolean = false) {
    GlassCard(backgroundColor = AppPalette.GlassStrong) {
        Row(
            Modifier.fillMaxWidth().padding(start = 13.dp, end = 4.dp, top = 9.dp, bottom = 9.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Box(Modifier.weight(1f).padding(top = 2.dp)) {
                TypewriterText(
                    text = event.text,
                    animate = animate,
                )
            }
            MessageActionsMenu(label = "Codex message", text = event.text)
        }
    }
}

@Composable
private fun MessageActionsMenu(label: String, text: String) {
    val context = LocalContext.current
    var expanded by remember(label, text) { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(Icons.Filled.MoreVert, "消息操作", tint = AppPalette.TextSecondary)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(onClick = {
                copyText(context, label, text)
                expanded = false
            }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.ContentCopy, "复制", tint = AppPalette.Primary)
                    Spacer(Modifier.width(10.dp))
                    Text("复制")
                }
            }
        }
    }
}

@Composable
private fun TypewriterText(text: String, animate: Boolean) {
    var visibleCount by remember { mutableStateOf(if (animate) 0 else text.length) }
    LaunchedEffect(text, animate) {
        if (!animate) {
            visibleCount = text.length
            return@LaunchedEffect
        }
        if (visibleCount > text.length) {
            visibleCount = 0
        }
        while (visibleCount < text.length) {
            visibleCount += 1
            delay(8)
        }
    }
    Text(
        text = text.take(visibleCount.coerceAtMost(text.length)),
        style = MaterialTheme.typography.body1,
        color = AppPalette.TextPrimary,
    )
}

@Composable
private fun TerminalBlock(event: ChatEvent) {
    TerminalBlock(DisplayEvent("terminal-${event.threadId}-${event.itemId}", event))
}

@Composable
private fun TerminalCommandBlock(
    record: TerminalCommandRecord,
    viewModel: MainViewModel,
    onResumeInteractive: ((TerminalCommandRecord) -> Unit)? = null,
) {
    val context = LocalContext.current
    var expanded by remember(record.commandId) { mutableStateOf(true) }
    var query by remember(record.commandId) { mutableStateOf("") }
    var actionMenuOpen by remember(record.commandId) { mutableStateOf(false) }
    var searchVisible by remember(record.commandId) { mutableStateOf(false) }
    var wrapLines by remember(record.commandId) { mutableStateOf(false) }
    val visibleText = terminalVisibleRenderedText(record.output, expanded, query)
    val displayText = remember(visibleText, query) {
        if (visibleText.plainText.isBlank() && query.isNotBlank()) renderTerminalDisplayText("没有匹配的输出") else visibleText
    }
    val matches = if (query.isBlank()) 0 else countMatches(record.output, query)
    val running = record.status == "running"
    val hasEarlierOutput = record.outputOffset > 0 || record.outputTruncated
    val outputWindowLabel = terminalOutputWindowLabel(record)

    Card(backgroundColor = AppPalette.Terminal, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = record.command.ifBlank { record.threadId },
                        color = Color(0xFFE4E7EC),
                        fontFamily = FontFamily.Monospace,
                        style = MaterialTheme.typography.body2,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = listOf(
                            terminalStatusLabel(record.status),
                            record.cwd,
                            outputWindowLabel,
                            if (matches > 0) "命中 $matches" else "",
                        ).filter { it.isNotBlank() }.joinToString(" · "),
                        color = AppPalette.TerminalMuted,
                        style = MaterialTheme.typography.caption,
                    )
                }
                if (running) {
                    IconButton(onClick = {
                        if (record.interactive) {
                            viewModel.stopTerminalSession(record.commandId)
                        } else {
                            viewModel.stopTerminalCommand(record.commandId)
                        }
                    }) {
                        Icon(Icons.Filled.Stop, "停止终端记录", tint = Color(0xFFF87171))
                    }
                }
                Box {
                    IconButton(onClick = { actionMenuOpen = true }) {
                        Icon(Icons.Filled.MoreVert, "终端记录操作", tint = AppPalette.TerminalMuted)
                    }
                    DropdownMenu(expanded = actionMenuOpen, onDismissRequest = { actionMenuOpen = false }) {
                        DropdownMenuItem(onClick = {
                            expanded = !expanded
                            actionMenuOpen = false
                        }) {
                            Text(if (expanded) "折叠输出" else "展开输出")
                        }
                        DropdownMenuItem(onClick = {
                            searchVisible = !searchVisible
                            if (!searchVisible) {
                                query = ""
                            }
                            actionMenuOpen = false
                        }) {
                            Text(if (searchVisible) "隐藏搜索" else "搜索输出")
                        }
                        DropdownMenuItem(onClick = {
                            wrapLines = !wrapLines
                            actionMenuOpen = false
                        }) {
                            Text(if (wrapLines) "横向滚动" else "自动换行")
                        }
                        if (record.interactive && running && onResumeInteractive != null) {
                            DropdownMenuItem(onClick = {
                                onResumeInteractive(record)
                                actionMenuOpen = false
                            }) {
                                Text("继续交互")
                            }
                        }
                        if (hasEarlierOutput) {
                            DropdownMenuItem(onClick = {
                                viewModel.loadEarlierTerminalOutput(record)
                                actionMenuOpen = false
                            }) {
                                Text("加载更早")
                            }
                        }
                        DropdownMenuItem(onClick = {
                            copyText(context, "Codex terminal visible", displayText.plainText)
                            actionMenuOpen = false
                        }) {
                            Text("复制可见")
                        }
                        DropdownMenuItem(onClick = {
                            copyText(context, "Codex terminal raw", record.output)
                            actionMenuOpen = false
                        }) {
                            Text("复制原始")
                        }
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            if (expanded && searchVisible) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("搜索终端输出", color = AppPalette.TerminalMuted) },
                    singleLine = true,
                )
                Spacer(Modifier.height(6.dp))
            }
            TerminalOutputSurface(
                rendered = displayText,
                surfaceKey = "command-${record.commandId}",
                autoFollowTail = running && query.isBlank(),
                highlightQuery = query,
                wrapLines = wrapLines,
            )
        }
    }
}

@Composable
private fun TerminalBlock(block: DisplayEvent, viewModel: MainViewModel? = null) {
    val event = block.event
    val context = LocalContext.current
    var expanded by remember(block.key) { mutableStateOf(true) }
    var query by remember(block.key) { mutableStateOf("") }
    var copyMenuOpen by remember(block.key) { mutableStateOf(false) }
    val visibleText = terminalVisibleRenderedText(event.text, expanded, query)
    val displayText = remember(visibleText, query) {
        if (visibleText.plainText.isBlank() && query.isNotBlank()) renderTerminalDisplayText("没有匹配的输出") else visibleText
    }
    val matches = if (query.isBlank()) 0 else countMatches(event.text, query)
    val localTerminalCommandId = localTerminalCommandId(event.threadId)

    Card(backgroundColor = AppPalette.Terminal, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("终端 · ${event.threadId}${if (event.stream.isNotBlank()) " · ${event.stream}" else ""}", color = AppPalette.TerminalMuted, style = MaterialTheme.typography.caption)
                    Text(
                        text = "${event.text.length} 字符 · ${block.parts} 段输出" + if (matches > 0) " · 命中 $matches" else "",
                        color = AppPalette.TerminalMuted,
                        style = MaterialTheme.typography.caption,
                    )
                }
                Button(onClick = { expanded = !expanded }) {
                    Text(if (expanded) "折叠" else "展开")
                }
                Spacer(Modifier.width(8.dp))
                if (localTerminalCommandId.isNotBlank() && viewModel != null) {
                    Button(onClick = { viewModel.stopTerminalCommand(localTerminalCommandId) }) {
                        Text("停止")
                    }
                    Spacer(Modifier.width(8.dp))
                }
                Box {
                    TextButton(onClick = { copyMenuOpen = true }) {
                        Text("复制")
                    }
                    DropdownMenu(expanded = copyMenuOpen, onDismissRequest = { copyMenuOpen = false }) {
                        DropdownMenuItem(onClick = {
                            copyText(context, "Codex terminal visible", displayText.plainText)
                            copyMenuOpen = false
                        }) {
                            Text("复制可见")
                        }
                        DropdownMenuItem(onClick = {
                            copyText(context, "Codex terminal raw", event.text)
                            copyMenuOpen = false
                        }) {
                            Text("复制原始")
                        }
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            if (expanded) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("搜索终端输出", color = AppPalette.TerminalMuted) },
                    singleLine = true,
                )
                Spacer(Modifier.height(6.dp))
            }
            TerminalOutputSurface(
                rendered = displayText,
                surfaceKey = block.key,
                highlightQuery = query,
            )
        }
    }
}

@Composable
private fun TerminalOutputSurface(
    rendered: TerminalRenderedText,
    surfaceKey: String,
    autoFollowTail: Boolean = false,
    highlightQuery: String = "",
    wrapLines: Boolean = false,
) {
    val horizontalScroll = rememberScrollState()
    val verticalScroll = rememberScrollState()
    val scope = rememberCoroutineScope()
    val annotated = remember(rendered, highlightQuery) { terminalAnnotatedString(rendered, highlightQuery) }
    var followTail by rememberSaveable(surfaceKey) { mutableStateOf(autoFollowTail) }
    val atBottom = shouldFollowTerminalTail(verticalScroll.value, verticalScroll.maxValue)
    LaunchedEffect(verticalScroll.value, verticalScroll.maxValue, autoFollowTail) {
        if (!autoFollowTail) {
            followTail = false
        } else {
            followTail = atBottom
        }
    }
    LaunchedEffect(rendered.plainText, autoFollowTail, followTail) {
        if (autoFollowTail && followTail) {
            verticalScroll.scrollTo(verticalScroll.maxValue)
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.fillMaxWidth()) {
            SelectionContainer {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = terminalOutputMaxHeightDp(autoFollowTail).dp)
                        .verticalScroll(verticalScroll),
                ) {
                    Box(modifier = terminalOutputTextContainerModifier(wrapLines, horizontalScroll)) {
                        Text(
                            text = annotated,
                            color = Color(0xFFE4E7EC),
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.caption,
                            softWrap = terminalOutputSoftWrap(wrapLines),
                        )
                    }
                }
            }
        if (autoFollowTail && !atBottom) {
            TextButton(
                onClick = {
                    followTail = true
                    scope.launch { verticalScroll.scrollTo(verticalScroll.maxValue) }
                },
                modifier = Modifier.align(Alignment.TopEnd),
            ) {
                Text("最新")
            }
        }
        }
    }
}

@Composable
private fun StatusBlock(event: ChatEvent) {
    Card(backgroundColor = AppPalette.PrimaryContainer, elevation = 0.dp) {
        Text(
            text = listOf(event.type, event.title, event.status).filter { it.isNotBlank() }.joinToString(" · "),
            modifier = Modifier.padding(12.dp),
        )
    }
}

@Composable
internal fun SettingsPanel(state: UiState, viewModel: MainViewModel) {
    var settings by remember(state.settings) { mutableStateOf(state.settings) }
    var rawConfig by remember(state.rawCodexConfig.content) { mutableStateOf(state.rawCodexConfig.content) }
    var deviceToRevoke by remember { mutableStateOf<DeviceRecord?>(null) }
    var rootToRemove by remember { mutableStateOf<ProjectRoot?>(null) }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Text("Codex 设置", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.h6)
            Text("模型在聊天输入区下方设置；这里管理项目根目录、Gateway、审批、沙盒、隐私、运行状态和完整 config.toml。", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
        }
        item {
            ProjectRootsCard(state, viewModel) { root ->
                rootToRemove = root
            }
        }
        item {
            GatewayHttpsCard(state, viewModel)
        }
        item {
            ApprovalPolicyCard(state, settings) { settings = it }
        }
        item {
            Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("沙盒", fontWeight = FontWeight.Bold)
                    ChoiceField(
                        label = "sandbox_mode",
                        value = settings.sandboxMode,
                        choices = sandboxModeChoices(settings.sandboxMode),
                        onSelect = { settings = settings.copy(sandboxMode = it) },
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = settings.networkAccess,
                            onCheckedChange = { settings = settings.copy(networkAccess = it) },
                        )
                        Text("workspace-write 允许网络访问")
                    }
                }
            }
        }
        item {
            Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("推理", fontWeight = FontWeight.Bold)
                    ChoiceField(
                        label = "model_reasoning_effort",
                        value = settings.reasoningEffort,
                        choices = reasoningEffortChoices(settings.reasoningEffort),
                        onSelect = { settings = settings.copy(reasoningEffort = it) },
                    )
                    Text("不在列表里的特殊值，可以直接在下面编辑原始 config.toml。", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                }
            }
        }
        item {
            PrivacySettingsCard(settings) { settings = it }
        }
        item {
            Card(backgroundColor = AppPalette.SurfaceVariant, elevation = 0.dp) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("运行状态", fontWeight = FontWeight.Bold)
                    Text(
                        listOf(
                            if (state.codexStatus.running) "app-server 运行中" else "app-server 未运行",
                            state.codexStatus.cliVersion.ifBlank { "未找到 CLI" },
                            "pending ${state.codexStatus.pendingRequests}",
                            if (state.codexStatus.autoRestartEnabled) "自动恢复已开" else "自动恢复关闭",
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.TextSecondary,
                    )
                    if (state.codexStatus.nextRestartAt.isNotBlank()) {
                        Text("下次自动重启：${compactTime(state.codexStatus.nextRestartAt)}", style = MaterialTheme.typography.caption, color = AppPalette.OnTertiaryContainer)
                    }
                    Row {
                        Button(onClick = viewModel::refreshCodexStatus, enabled = state.connected && !state.loading) {
                            Text("刷新")
                        }
                        Spacer(Modifier.width(8.dp))
                        Button(onClick = viewModel::restartCodex, enabled = state.connected && !state.loading) {
                            Text("重启")
                        }
                    }
                }
            }
        }
        item {
            AppServerCompatibilityCard(state, viewModel)
        }
        item {
            CodexUpgradeCard(state, viewModel)
        }
        item {
            DeviceManagementCard(state, viewModel) { device ->
                deviceToRevoke = device
            }
        }
        item {
            Button(
                onClick = { viewModel.saveSettings(settings) },
                enabled = state.connected,
                colors = ButtonDefaults.buttonColors(backgroundColor = AppPalette.Primary, contentColor = Color.White),
            ) {
                Text("保存 Codex 设置")
            }
        }
        item {
            Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
                Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("完整 config.toml", fontWeight = FontWeight.Bold)
                    if (state.rawCodexConfig.path.isNotBlank()) {
                        Text(state.rawCodexConfig.path, style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                    }
                    Text("用于编辑桌面端支持但表单暂未覆盖的全部设置，包括 model_provider、base_url、profiles 和高级实验项。保存前服务端会校验 TOML 格式。", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                    OutlinedTextField(
                        value = rawConfig,
                        onValueChange = { rawConfig = it },
                        modifier = Modifier.fillMaxWidth().height(260.dp),
                        label = { Text("config.toml") },
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Button(
                            onClick = { viewModel.saveRawSettings(rawConfig) },
                            enabled = state.connected,
                            colors = ButtonDefaults.buttonColors(backgroundColor = AppPalette.Primary, contentColor = Color.White),
                        ) {
                            Text("保存完整配置")
                        }
                        Spacer(Modifier.width(8.dp))
                        TextButton(onClick = { rawConfig = state.rawCodexConfig.content }) {
                            Text("还原")
                        }
                    }
                }
            }
        }
    }
    val pendingDevice = deviceToRevoke
    if (pendingDevice != null) {
        androidx.compose.material.AlertDialog(
            onDismissRequest = { deviceToRevoke = null },
            title = { Text("撤销设备") },
            text = {
                Text("撤销后，${pendingDevice.name.ifBlank { pendingDevice.id }} 将无法继续连接这个 Gateway。")
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.revokeDevice(pendingDevice)
                    deviceToRevoke = null
                }) {
                    Text("撤销")
                }
            },
            dismissButton = {
                TextButton(onClick = { deviceToRevoke = null }) {
                    Text("取消")
                }
            },
        )
    }
    val pendingRoot = rootToRemove
    if (pendingRoot != null) {
        androidx.compose.material.AlertDialog(
            onDismissRequest = { rootToRemove = null },
            title = { Text("移除项目根目录") },
            text = {
                Text("移除后，${pendingRoot.path} 将不再出现在项目列表，手机端也不能继续访问其中的文件、终端和 diff。")
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.removeProjectRoot(pendingRoot)
                    rootToRemove = null
                }) {
                    Text("移除")
                }
            },
            dismissButton = {
                TextButton(onClick = { rootToRemove = null }) {
                    Text("取消")
                }
            },
        )
    }
}

@Composable
private fun CodexUpgradeCard(state: UiState, viewModel: MainViewModel) {
    val context = LocalContext.current
    val upgrade = state.codexUpgradeCheck
    Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Codex CLI 更新", fontWeight = FontWeight.Bold)
                    Text(
                        listOf(
                            "当前 ${upgrade.installedVersion.ifBlank { state.codexStatus.cliVersion.ifBlank { "未知" } }}",
                            "最新 ${upgrade.latestVersion.ifBlank { "未检查" }}",
                            upgrade.packageName.ifBlank { "@openai/codex" },
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.TextSecondary,
                    )
                }
                if (upgrade.checkedAt.isNotBlank()) {
                    StatusPill(if (upgrade.updateAvailable) "可升级" else "已是最新", !upgrade.updateAvailable)
                }
            }
            if (upgrade.error.isNotBlank()) {
                Text(upgrade.error, style = MaterialTheme.typography.caption, color = AppPalette.OnTertiaryContainer)
            } else if (upgrade.updateAvailable) {
                Text("电脑端 Codex CLI 有新版本。建议升级后重启 app-server。", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
            } else if (upgrade.checkedAt.isNotBlank()) {
                Text("检查时间：${compactTime(upgrade.checkedAt)} · 来源 ${upgrade.source}", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
            } else {
                Text("连接后自动检查；也可以手动刷新。", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
            }
            if (upgrade.command.isNotBlank()) {
                Text(upgrade.command, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.caption, color = AppPalette.TextPrimary)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = viewModel::refreshCodexUpgradeCheck, enabled = state.connected && !state.loading) {
                    Text("检查更新")
                }
                Spacer(Modifier.width(8.dp))
                TextButton(
                    onClick = { copyText(context, "Codex upgrade command", upgrade.command) },
                    enabled = upgrade.command.isNotBlank(),
                ) {
                    Text("复制命令")
                }
            }
        }
    }
}

@Composable
private fun AppServerCompatibilityCard(state: UiState, viewModel: MainViewModel) {
    val compatibility = state.codexCompatibility
    val unknownTotal = compatibility.unknownNotifications.sumOf { it.count } +
        compatibility.unsupportedServerRequests.sumOf { it.count } +
        compatibility.malformedMessages
    var expanded by remember { mutableStateOf(false) }
    Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("app-server schema", fontWeight = FontWeight.Bold)
                    Text(
                        listOf(
                            compatibility.cliVersion.ifBlank { state.codexStatus.cliVersion.ifBlank { "未找到 CLI" } },
                            if (compatibility.appServerRunning) "运行中" else "未运行",
                            if (compatibility.initialized) "握手已确认" else "握手未确认",
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.TextSecondary,
                    )
                }
                StatusPill(schemaStatusLabel(compatibility.status), compatibility.status == "ok")
            }
            Text(
                "已覆盖 ${compatibility.notifications.size} 个通知、${compatibility.serverRequests.size} 个服务端请求、${compatibility.clientRequests.size} 个客户端请求。",
                style = MaterialTheme.typography.body2,
                color = AppPalette.TextPrimary,
            )
            if (unknownTotal > 0) {
                Text(
                    "发现 $unknownTotal 个未完全适配的协议信号。",
                    style = MaterialTheme.typography.caption,
                    color = AppPalette.OnTertiaryContainer,
                )
            }
            compatibility.recommendations.take(2).forEach { recommendation ->
                Text(recommendation, style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = viewModel::refreshCodexCompatibility, enabled = state.connected && !state.loading) {
                    Text("刷新兼容性")
                }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = { expanded = !expanded }) {
                    Text(if (expanded) "收起详情" else "查看详情")
                }
            }
            if (expanded) {
                CompatibilityMethodSection("通知覆盖", compatibility.notifications)
                CompatibilityMethodSection("审批请求覆盖", compatibility.serverRequests)
                CompatibilityMethodSection("客户端请求", compatibility.clientRequests)
                CompatibilityObservationSection("未知通知", compatibility.unknownNotifications)
                CompatibilityObservationSection("不支持请求", compatibility.unsupportedServerRequests)
                if (compatibility.malformedMessages > 0) {
                    Text(
                        "坏 JSON 行 ${compatibility.malformedMessages} · ${compactTime(compatibility.lastMalformedAt)}",
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.OnTertiaryContainer,
                    )
                }
            }
        }
    }
}

@Composable
private fun CompatibilityMethodSection(title: String, methods: List<String>) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text("$title · ${methods.size}", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.caption)
        Text(
            methods.joinToString("\n").ifBlank { "暂无" },
            style = MaterialTheme.typography.caption,
            fontFamily = FontFamily.Monospace,
            color = AppPalette.TextSecondary,
        )
    }
}

@Composable
private fun CompatibilityObservationSection(title: String, observations: List<MethodObservation>) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text("$title · ${observations.sumOf { it.count }}", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.caption)
        if (observations.isEmpty()) {
            Text("暂无", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
        }
        observations.take(8).forEach { observation ->
            Text(
                "${observation.method} ×${observation.count} · ${compactTime(observation.lastSeenAt)}",
                style = MaterialTheme.typography.caption,
                fontFamily = FontFamily.Monospace,
                color = AppPalette.TextSecondary,
            )
        }
    }
}

@Composable
private fun ApprovalPolicyCard(state: UiState, settings: ControlSettings, onSettingsChange: (ControlSettings) -> Unit) {
    val summary = state.approvalSummary
    Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("审批策略", fontWeight = FontWeight.Bold)
                    Text(
                        listOf(summary.approvalLabel.ifBlank { settings.approvalPolicy.ifBlank { "默认" } }, summary.sandboxLabel).filter { it.isNotBlank() }.joinToString(" · "),
                        style = MaterialTheme.typography.caption,
                        color = AppPalette.TextSecondary,
                    )
                }
                StatusPill(approvalRiskLabel(summary.approvalRisk), summary.approvalRisk == "low")
            }
            if (summary.summary.isNotBlank()) {
                Text(summary.summary, style = MaterialTheme.typography.body2, color = AppPalette.TextPrimary)
            }
            if (summary.recommendation.isNotBlank()) {
                Text(summary.recommendation, style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
            }
            ChoiceField(
                label = "approval_policy",
                value = settings.approvalPolicy,
                choices = approvalPolicyChoices(settings.approvalPolicy),
                onSelect = { onSettingsChange(settings.copy(approvalPolicy = it)) },
            )
            Text("常见策略已经做成可点选，想用更特殊的值时再改原始 config.toml。", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
        }
    }
}

@Composable
private fun ProviderSettingsCard(settings: ControlSettings, rawConfigContent: String, onSettingsChange: (ControlSettings) -> Unit) {
    val knownProviders = providerChoices(settings.modelProvider, rawConfigContent)
    Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("模型 Provider", fontWeight = FontWeight.Bold)
            if (knownProviders.isNotEmpty()) {
                ChoiceField(
                    label = "model_provider",
                    value = settings.modelProvider,
                    choices = providerSettingChoices(settings.modelProvider, knownProviders),
                    onSelect = { onSettingsChange(settings.copy(modelProvider = it)) },
                )
            } else {
                OutlinedTextField(
                    value = settings.modelProvider,
                    onValueChange = { onSettingsChange(settings.copy(modelProvider = it)) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("model_provider") },
                    placeholder = { Text("例如 custom / openai") },
                    singleLine = true,
                )
            }
            OutlinedTextField(
                value = settings.providerBaseUrl,
                onValueChange = { onSettingsChange(settings.copy(providerBaseUrl = it)) },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("当前 Provider base_url") },
                placeholder = { Text("http://127.0.0.1:15721/v1") },
                singleLine = true,
            )
            Text("用于切换桌面端当前模型提供方和它的 base_url；更细的鉴权、wire_api 等配置仍可在原始 TOML 里编辑。", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
        }
    }
}

@Composable
private fun PrivacySettingsCard(settings: ControlSettings, onSettingsChange: (ControlSettings) -> Unit) {
    Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("隐私与记录", fontWeight = FontWeight.Bold)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = settings.disableResponseStorage,
                    onCheckedChange = { onSettingsChange(settings.copy(disableResponseStorage = it)) },
                )
                Column {
                    Text("disable_response_storage")
                    Text("开启后，Codex 不再在本地保留响应存储。", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                }
            }
        }
    }
}

@Composable
private fun ChoiceField(label: String, value: String, choices: List<SettingChoice>, onSelect: (String) -> Unit) {
    var expanded by remember(label, value, choices) { mutableStateOf(false) }
    val selected = choices.firstOrNull { it.value == value } ?: choices.firstOrNull()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
        Box {
            Button(
                onClick = { expanded = true },
                modifier = Modifier.fillMaxWidth(),
                elevation = null,
                colors = ButtonDefaults.buttonColors(
                    backgroundColor = AppPalette.SurfaceVariant,
                    contentColor = AppPalette.TextPrimary,
                ),
            ) {
                Text(
                    text = selected?.label ?: value.ifBlank { "默认" },
                    modifier = Modifier.weight(1f),
                    color = AppPalette.TextPrimary,
                )
                Icon(Icons.Filled.KeyboardArrowDown, "展开选项", tint = AppPalette.TextSecondary)
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                choices.forEach { choice ->
                    DropdownMenuItem(onClick = {
                        onSelect(choice.value)
                        expanded = false
                    }) {
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(choice.label)
                            if (choice.description.isNotBlank()) {
                                Text(choice.description, style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                            }
                        }
                    }
                }
            }
        }
    }
}

private data class SettingChoice(
    val value: String,
    val label: String,
    val description: String = "",
)

private fun approvalPolicyChoices(current: String): List<SettingChoice> {
    return mergeChoices(
        current,
        listOf(
            SettingChoice("", "默认", "沿用桌面端默认审批策略。"),
            SettingChoice("on-request", "按请求审批", "需要提权时主动询问。"),
            SettingChoice("on-failure", "失败后再请求", "先尝试，受限后再请求。"),
            SettingChoice("never", "不请求审批", "不弹审批，敏感操作更容易失败或绕过。"),
            SettingChoice("untrusted", "不信任工作区", "按更保守的模式运行。"),
        ),
    )
}

private fun sandboxModeChoices(current: String): List<SettingChoice> {
    return mergeChoices(
        current,
        listOf(
            SettingChoice("", "默认", "沿用桌面端当前默认值。"),
            SettingChoice("read-only", "只读", "禁止修改文件。"),
            SettingChoice("workspace-write", "工作区可写", "允许写当前项目目录。"),
            SettingChoice("danger-full-access", "完全访问", "放开更多本机访问权限。"),
        ),
    )
}

private fun reasoningEffortChoices(current: String): List<SettingChoice> {
    return mergeChoices(
        current,
        listOf(
            SettingChoice("", "默认", "让桌面端按默认推理强度运行。"),
            SettingChoice("minimal", "minimal", "更快，更省。"),
            SettingChoice("low", "low", "轻量推理。"),
            SettingChoice("medium", "medium", "平衡模式。"),
            SettingChoice("high", "high", "更重的推理。"),
        ),
    )
}

private fun providerSettingChoices(current: String, knownProviders: List<String>): List<SettingChoice> {
    return mergeChoices(
        current,
        listOf(SettingChoice("", "默认", "保持当前桌面端 Provider")) +
            knownProviders.map { provider ->
                SettingChoice(provider, provider, "来自当前 config.toml 的已定义 Provider。")
            },
    )
}

private fun mergeChoices(current: String, defaults: List<SettingChoice>): List<SettingChoice> {
    val normalizedCurrent = current.trim()
    val currentChoice = if (normalizedCurrent.isNotBlank() && defaults.none { it.value == normalizedCurrent }) {
        listOf(SettingChoice(normalizedCurrent, normalizedCurrent, "当前值未内置到手机端快捷选项。"))
    } else {
        emptyList()
    }
    return (currentChoice + defaults).distinctBy { it.value }
}

@Composable
private fun GatewayHttpsCard(state: UiState, viewModel: MainViewModel) {
    var enabled by remember(state.gatewayHttps.enabled) { mutableStateOf(state.gatewayHttps.enabled) }
    var generate by remember { mutableStateOf(false) }
    Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Gateway HTTPS", fontWeight = FontWeight.Bold)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = enabled, onCheckedChange = { enabled = it })
                Text("启用 HTTPS 监听")
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = generate, onCheckedChange = { generate = it })
                Text("生成自签名证书")
            }
            Text(
                listOf(
                    "证书 ${if (state.gatewayHttps.certExists) "已存在" else "未生成"}",
                    "私钥 ${if (state.gatewayHttps.keyExists) "已存在" else "未生成"}",
                ).joinToString(" · "),
                style = MaterialTheme.typography.caption,
                color = AppPalette.TextSecondary,
            )
            if (state.gatewayHttps.certPath.isNotBlank()) {
                Text(state.gatewayHttps.certPath, style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
            }
            if (state.gatewayHttps.restartRequired) {
                Text("配置已保存，重启 Gateway 后生效。", style = MaterialTheme.typography.caption, color = AppPalette.OnTertiaryContainer)
            }
            Button(
                onClick = {
                    viewModel.saveGatewayHttps(enabled, generate)
                    generate = false
                },
                enabled = state.connected && !state.loading,
            ) {
                Text("保存 HTTPS")
            }
            Text("手机连接自签名 HTTPS 时，请在连接设置勾选信任证书。", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
        }
    }
}

@Composable
private fun ProjectRootsCard(state: UiState, viewModel: MainViewModel, onRemove: (ProjectRoot) -> Unit) {
    var rootPath by remember { mutableStateOf("") }
    Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("允许项目根目录", fontWeight = FontWeight.Bold)
                    Text("只有这里列出的目录会作为可控制项目开放给手机端。", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                }
                TextButton(onClick = viewModel::refreshProjectRoots, enabled = state.connected) {
                    Text("刷新")
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = rootPath,
                    onValueChange = { rootPath = it },
                    modifier = Modifier.weight(1f),
                    label = { Text("电脑端目录路径") },
                    singleLine = true,
                )
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = {
                        viewModel.addProjectRoot(rootPath)
                        rootPath = ""
                    },
                    enabled = state.connected && rootPath.isNotBlank(),
                ) {
                    Text("添加")
                }
            }
            if (state.projectRoots.isEmpty()) {
                Text("暂无允许根目录。添加后会出现在首页项目列表。", style = MaterialTheme.typography.body2, color = AppPalette.TextSecondary)
            }
            state.projectRoots.forEach { root ->
                Card(
                    backgroundColor = if (root.exists) AppPalette.SurfaceVariant else AppPalette.ErrorContainer,
                    elevation = 0.dp,
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(root.name.ifBlank { "未命名目录" }, fontWeight = FontWeight.Bold)
                            Text(root.path, style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                            Text(
                                if (root.exists) "可访问" else "目录不存在或不可访问",
                                style = MaterialTheme.typography.caption,
                                color = if (root.exists) AppPalette.TextSecondary else AppPalette.OnErrorContainer,
                            )
                        }
                        TextButton(onClick = { onRemove(root) }, enabled = state.connected) {
                            Text("移除")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DeviceManagementCard(state: UiState, viewModel: MainViewModel, onRevoke: (DeviceRecord) -> Unit) {
    Card(backgroundColor = AppPalette.Surface, elevation = 0.dp) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("已授权设备", fontWeight = FontWeight.Bold)
                    Text("管理通过配对码登录过的手机或其他控制入口。", style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                }
                TextButton(onClick = viewModel::refreshDevices, enabled = state.connected) {
                    Text("刷新")
                }
            }
            if (state.devices.isEmpty()) {
                Text("暂无已配对设备。", style = MaterialTheme.typography.body2, color = AppPalette.TextSecondary)
            }
            state.devices.forEach { device ->
                Card(
                    backgroundColor = if (device.revokedAt.isBlank()) AppPalette.SurfaceVariant else AppPalette.ErrorContainer,
                    elevation = 0.dp,
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(device.name.ifBlank { "未命名设备" }, fontWeight = FontWeight.Bold)
                            Text(
                                listOf(
                                    "ID ${device.id}",
                                    if (device.revokedAt.isBlank()) "最近 ${compactTime(device.lastSeenAt)}" else "已撤销 ${compactTime(device.revokedAt)}",
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.caption,
                                color = AppPalette.TextSecondary,
                            )
                            if (device.userAgent.isNotBlank()) {
                                Text(device.userAgent.take(90), style = MaterialTheme.typography.caption, color = AppPalette.TextSecondary)
                            }
                        }
                        TextButton(
                            onClick = { onRevoke(device) },
                            enabled = state.connected && device.revokedAt.isBlank(),
                        ) {
                            Text("撤销")
                        }
                    }
                }
            }
        }
    }
}

private fun ChatEvent.summaryOrTitle(fallback: String): String {
    return detail.ifBlank { title.ifBlank { fallback } }
}

private fun parentPath(path: String): String {
    val index = path.trimEnd('/').lastIndexOf('/')
    return if (index <= 0) "" else path.substring(0, index)
}

private fun diffStatusLabel(status: String): String {
    return when (status) {
        "added" -> "新增"
        "modified" -> "修改"
        "deleted" -> "删除"
        "renamed" -> "重命名"
        "copied" -> "复制"
        "unmerged" -> "冲突"
        "accepted" -> "已接受"
        else -> "未知"
    }
}

private fun diffStatusFilters(): List<String> {
    return listOf("all", "added", "modified", "deleted", "renamed", "copied", "unmerged", "accepted", "unknown")
}

private fun diffStatusFilterLabel(status: String): String {
    return if (status == "all" || status.isBlank()) {
        "全部状态"
    } else {
        diffStatusLabel(status)
    }
}

private fun diffSourceLabel(source: String): String {
    return when (source) {
        "worktree" -> "工作区"
        "staged" -> "已暂存"
        else -> "未知"
    }
}

private fun fileKindFilters(): List<String> {
    return listOf("all", "directory", "file")
}

private fun fileKindFilterLabel(kind: String): String {
    return when (kind) {
        "directory" -> "目录"
        "file" -> "文件"
        else -> "全部"
    }
}

private fun compactTime(value: String): String {
    if (value.length >= 16) {
        return value.substring(0, 16).replace('T', ' ')
    }
    return value.ifBlank { "未知" }
}

private fun localTerminalCommandId(threadId: String): String {
    val prefix = "terminal:"
    return if (threadId.startsWith(prefix)) threadId.removePrefix(prefix) else ""
}

private fun terminalStatusLabel(status: String): String {
    return when (status) {
        "running" -> "运行中"
        "completed" -> "已完成"
        "stopped" -> "已停止"
        "timeout" -> "已超时"
        "error" -> "错误"
        else -> "未知"
    }
}

private fun terminalStatusFilters(): List<String> {
    return listOf("all", "running", "completed", "stopped", "error", "timeout", "unknown")
}

private fun terminalStatusFilterLabel(status: String): String {
    return if (status == "all" || status.isBlank()) {
        "全部状态"
    } else {
        terminalStatusLabel(status)
    }
}

private fun terminalHistoryToolbarLabel(status: String, filteredCount: Int, totalCount: Int, runningCount: Int): String {
    val statusLabel = if (status == "all" || status.isBlank()) "全部" else terminalStatusLabel(status)
    return "$statusLabel · ${terminalHistoryCompactSummary(filteredCount, totalCount, runningCount)}"
}

private fun approvalRiskLabel(risk: String): String {
    return when (risk) {
        "low" -> "低风险"
        "medium" -> "中风险"
        "high" -> "高风险"
        else -> "未知"
    }
}

private fun schemaStatusLabel(status: String): String {
    return when (status) {
        "ok" -> "兼容"
        "warning" -> "需关注"
        "error" -> "不可用"
        else -> "未知"
    }
}

private fun approvalTypeLabel(type: String): String {
    return when (type) {
        "command" -> "命令"
        "file" -> "文件变更"
        "permission" -> "权限配置"
        else -> type.ifBlank { "操作" }
    }
}

private fun approvalHint(type: String): String {
    return when (type) {
        "command" -> "允许后会在电脑端执行该命令；请检查 cwd、命令和可能的网络/文件影响。"
        "file" -> "允许后 Codex 可以写入或修改文件；建议先看清文件路径和变更目的。"
        "permission" -> "允许后可能改变沙盒、网络或文件访问权限；只在信任当前项目和请求理由时允许。"
        else -> "请确认该操作符合当前任务预期。"
    }
}

private fun approvalAcceptLabel(type: String): String {
    return when (type) {
        "permission" -> "允许本次权限"
        "file" -> "允许文件变更"
        "command" -> "允许执行"
        else -> "允许"
    }
}

private fun isTurnRunning(state: UiState): Boolean {
    return state.threads.any { it.id == state.activeThreadId && it.status == "running" }
}

private fun filePreviewKind(path: String): String {
    val lower = path.lowercase()
    return when {
        lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".webp") -> "image"
        lower.endsWith(".svg") || lower.endsWith(".html") || lower.endsWith(".htm") -> "web"
        lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".kt") || lower.endsWith(".ts") || lower.endsWith(".tsx") ||
            lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".json") || lower.endsWith(".xml") || lower.endsWith(".yml") ||
            lower.endsWith(".yaml") || lower.endsWith(".css") || lower.endsWith(".java") || lower.endsWith(".py") || lower.endsWith(".rs") -> "text"
        else -> "binary"
    }
}

private fun aggregateConversationEvents(events: List<ChatEvent>): List<DisplayEvent> {
    val blocks = mutableListOf<DisplayEvent>()
    events.forEachIndexed { index, event ->
        val last = blocks.lastOrNull()
        if (last != null && canMerge(last.event, event)) {
            blocks[blocks.lastIndex] = last.copy(
                event = last.event.copy(text = last.event.text + event.text),
                parts = last.parts + 1,
            )
        } else {
            blocks.add(
                DisplayEvent(
                    key = listOf(index.toString(), event.type, event.threadId, event.itemId, event.approvalId).joinToString(":"),
                    event = event,
                )
            )
        }
    }
    return blocks
}

private data class TerminalCommandDraft(
    val commandId: String,
    val threadId: String,
    var cwd: String = "",
    var command: String = "",
    var status: String = "unknown",
    var startedAt: String = "",
    var endedAt: String = "",
    var stdout: String = "",
    var stderr: String = "",
    var output: String = "",
    var chunks: Int = 0,
    var interactive: Boolean = false,
)

private fun terminalCommandsFromEvents(events: List<ChatEvent>): List<TerminalCommandRecord> {
    val grouped = linkedMapOf<String, TerminalCommandDraft>()
    events.forEach { event ->
        if (event.type != "terminal.output" || !event.threadId.startsWith("terminal:")) {
            return@forEach
        }
        val commandId = event.commandId.ifBlank { localTerminalCommandId(event.threadId) }
        val draft = grouped.getOrPut(commandId) {
            TerminalCommandDraft(
                commandId = commandId,
                threadId = event.threadId,
                startedAt = event.createdAt,
            )
        }
        if (draft.startedAt.isBlank()) {
            draft.startedAt = event.createdAt
        }
        if (event.cwd.isNotBlank()) {
            draft.cwd = event.cwd
        }
        if (event.command.isNotBlank()) {
            draft.command = event.command
            draft.interactive = event.command.contains("交互式会话")
        }
        draft.status = terminalEventStatus(event, draft.status)
        if (isTerminalFinalStatus(draft.status)) {
            draft.endedAt = event.createdAt.ifBlank { draft.endedAt }
        }
        if (event.stream == "stderr") {
            draft.stderr += event.text
        } else {
            draft.stdout += event.text
        }
        draft.output += event.text
        draft.chunks += 1
    }
    return grouped.values.reversed().map { draft ->
        TerminalCommandRecord(
            commandId = draft.commandId,
            threadId = draft.threadId,
            cwd = draft.cwd,
            command = draft.command,
            status = draft.status,
            startedAt = draft.startedAt,
            endedAt = draft.endedAt,
            stdout = draft.stdout,
            stderr = draft.stderr,
            output = draft.output,
            stdoutLength = draft.stdout.length,
            stderrLength = draft.stderr.length,
            outputLength = draft.output.length,
            outputOffset = 0,
            outputEnd = draft.output.length,
            outputTruncated = false,
            chunks = draft.chunks,
            interactive = draft.interactive,
        )
    }
}

private fun mergeTerminalCommands(base: List<TerminalCommandRecord>, live: List<TerminalCommandRecord>): List<TerminalCommandRecord> {
    val merged = linkedMapOf<String, TerminalCommandRecord>()
    (live + base).forEach { record ->
        val existing = merged[record.commandId]
        val recordCoverage = record.outputEnd.coerceAtLeast(record.output.length)
        val existingCoverage = existing?.outputEnd?.coerceAtLeast(existing.output.length) ?: -1
        if (existing == null || recordCoverage >= existingCoverage) {
            merged[record.commandId] = record
        }
    }
    return merged.values.toList()
}

private fun interactiveTerminalSessions(commands: List<TerminalCommandRecord>): List<TerminalCommandRecord> {
    return commands.filter { it.interactive && it.status == "running" }
}

internal data class TerminalShortcut(
    val label: String,
    val sequence: String,
)

@Composable
private fun InputModeToggle(rawInputMode: Boolean, onRawInputModeChange: (Boolean) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        TerminalModeButton(
            label = "回车发送",
            selected = !rawInputMode,
            onClick = { onRawInputModeChange(false) },
        )
        TerminalModeButton(
            label = "原样发送",
            selected = rawInputMode,
            onClick = { onRawInputModeChange(true) },
        )
    }
}

@Composable
private fun TerminalModeButton(label: String, selected: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        elevation = null,
        colors = ButtonDefaults.buttonColors(
            backgroundColor = if (selected) AppPalette.Primary else Color(0xFF1F2937),
            contentColor = Color(0xFFE4E7EC),
        ),
    ) {
        Text(label)
    }
}

@Composable
private fun TerminalShortcutButton(
    shortcut: TerminalShortcut,
    enabled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Button(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        elevation = null,
        colors = ButtonDefaults.buttonColors(
            backgroundColor = Color(0xFF1F2937),
            contentColor = Color(0xFFE4E7EC),
        ),
    ) {
        Text(shortcut.label)
    }
}

internal fun terminalPrimaryShortcuts(): List<TerminalShortcut> {
    return listOf(
        TerminalShortcut("Ctrl+C", "\u0003"),
        TerminalShortcut("Tab", "\t"),
        TerminalShortcut("Enter", "\r"),
        TerminalShortcut("↑", "\u001B[A"),
        TerminalShortcut("⌫", "\b"),
    )
}

internal fun terminalSecondaryShortcutRows(): List<List<TerminalShortcut>> {
    return listOf(
        listOf(
            TerminalShortcut("↓", "\u001B[B"),
            TerminalShortcut("←", "\u001B[D"),
            TerminalShortcut("→", "\u001B[C"),
        ),
        listOf(
            TerminalShortcut("Esc", "\u001B"),
            TerminalShortcut("Home", "\u001B[H"),
            TerminalShortcut("End", "\u001B[F"),
        ),
        listOf(
            TerminalShortcut("Del", "\u001B[3~"),
        ),
    )
}

internal fun canSendTerminalSessionInput(rawInputMode: Boolean, input: String): Boolean {
    return if (rawInputMode) {
        input.isNotEmpty()
    } else {
        input.isNotBlank()
    }
}

private fun defaultInteractiveSessionId(commands: List<TerminalCommandRecord>): String {
    return commands.firstOrNull()?.commandId.orEmpty()
}

internal fun resolveInteractiveSessionSelection(current: String, commands: List<TerminalCommandRecord>): String {
    if (commands.isEmpty()) {
        return ""
    }
    return commands.firstOrNull { it.commandId == current }?.commandId ?: defaultInteractiveSessionId(commands)
}

internal fun terminalSessionChipLabel(session: TerminalCommandRecord, index: Int, total: Int): String {
    val prefix = if (total > 1) "${index + 1} " else ""
    val base = session.command.ifBlank { session.commandId }.trim()
    val text = prefix + base
    return if (text.length <= 18) text else text.take(15) + "..."
}

internal fun terminalSessionImeAction(rawInputMode: Boolean): ImeAction {
    return if (rawInputMode) ImeAction.Default else ImeAction.Send
}

internal fun estimateTerminalViewport(widthPx: Int, heightPx: Int): TerminalViewport? {
    if (widthPx <= 0 || heightPx <= 0) {
        return null
    }
    val cols = (widthPx / 9.2f).toInt().coerceIn(40, 240)
    val rows = (heightPx / 18f).toInt().coerceIn(12, 80)
    return TerminalViewport(cols, rows)
}

internal fun shouldFollowTerminalTail(scrollValue: Int, maxValue: Int, thresholdPx: Int = 24): Boolean {
    if (maxValue <= 0) {
        return true
    }
    return scrollValue >= (maxValue - thresholdPx).coerceAtLeast(0)
}

internal fun shouldFollowConversationTail(lastVisibleIndex: Int, itemCount: Int, thresholdItems: Int = 1): Boolean {
    if (itemCount <= 0) {
        return true
    }
    if (lastVisibleIndex < 0) {
        return true
    }
    return lastVisibleIndex >= itemCount - 1 - thresholdItems
}

internal fun terminalOutputMaxHeightDp(autoFollowTail: Boolean): Int {
    return if (autoFollowTail) 420 else 320
}

internal fun terminalOutputSoftWrap(wrapLines: Boolean): Boolean {
    return wrapLines
}

private fun terminalOutputTextContainerModifier(wrapLines: Boolean, horizontalScroll: androidx.compose.foundation.ScrollState): Modifier {
    return if (wrapLines) Modifier.fillMaxWidth() else Modifier.horizontalScroll(horizontalScroll)
}

private fun terminalAnnotatedString(rendered: TerminalRenderedText, query: String): AnnotatedString {
    val plainText = rendered.plainText
    return buildAnnotatedString {
        var offset = 0
        rendered.segments.forEach { segment ->
            val end = offset + segment.text.length
            pushStyle(segment.style.toSpanStyle())
            append(segment.text)
            pop()
            offset = end
        }
        if (query.isNotBlank() && plainText.isNotEmpty()) {
            var index = plainText.indexOf(query, ignoreCase = true)
            while (index >= 0) {
                addStyle(SpanStyle(background = Color(0xFF665C00)), index, index + query.length)
                index = plainText.indexOf(query, startIndex = index + query.length, ignoreCase = true)
            }
        }
    }
}

private fun TerminalStyle.toSpanStyle(): SpanStyle {
    val resolvedForeground = resolveForegroundColor()
    val resolvedBackground = resolveBackgroundColor()
    return SpanStyle(
        color = resolvedForeground,
        background = resolvedBackground,
        fontWeight = if (bold) FontWeight.Bold else null,
        fontStyle = if (italic) FontStyle.Italic else null,
        textDecoration = if (underline) TextDecoration.Underline else null,
    )
}

private fun TerminalStyle.resolveForegroundColor(): Color {
    val foregroundColor = if (inverse) background ?: defaultTerminalBackgroundColor else foreground ?: defaultTerminalForegroundColor
    return foregroundColor.toComposeColor(dim)
}

private fun TerminalStyle.resolveBackgroundColor(): Color {
    val backgroundColor = if (inverse) foreground ?: defaultTerminalForegroundColor else background ?: defaultTerminalBackgroundColor
    return backgroundColor.toComposeColor(dim = false)
}

private fun TerminalColor.toComposeColor(dim: Boolean): Color {
    if (!dim) {
        return Color(red, green, blue)
    }
    return Color(
        red = ((red * 0.7f).toInt()).coerceIn(0, 255),
        green = ((green * 0.7f).toInt()).coerceIn(0, 255),
        blue = ((blue * 0.7f).toInt()).coerceIn(0, 255),
    )
}

private val defaultTerminalForegroundColor = TerminalColor(228, 232, 240)
private val defaultTerminalBackgroundColor = TerminalColor(15, 23, 42)

private fun terminalEventStatus(event: ChatEvent, current: String): String {
    if (event.status.isNotBlank()) {
        return event.status
    }
    return when {
        event.text.contains("[stopped]") || event.text.contains("已请求停止命令") -> "stopped"
        event.text.contains("已终止") -> "timeout"
        event.text.contains("[启动失败]") || event.text.contains("[signal ") || event.text.contains("[exit 1]") -> "error"
        event.text.contains("[exit 0]") -> "completed"
        current == "unknown" -> "running"
        else -> current
    }
}

private fun isTerminalFinalStatus(status: String): Boolean {
    return status == "completed" || status == "stopped" || status == "error" || status == "timeout"
}

private fun canMerge(previous: ChatEvent, next: ChatEvent): Boolean {
    if (previous.type != next.type || previous.threadId != next.threadId) {
        return false
    }
    return next.type == "message.delta" || next.type == "terminal.output"
}

private fun countMatches(text: String, query: String): Int {
    if (query.isBlank()) {
        return 0
    }
    val normalizedText = normalizeTerminalDisplayText(text)
    var count = 0
    var index = normalizedText.indexOf(query, ignoreCase = true)
    while (index >= 0) {
        count += 1
        index = normalizedText.indexOf(query, startIndex = index + query.length, ignoreCase = true)
    }
    return count
}

private fun copyText(context: Context, label: String, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
}

