@file:OptIn(androidx.compose.animation.ExperimentalAnimationApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
package com.localcodex.control

import android.widget.TextView
import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.material.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import io.noties.markwon.Markwon
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.latex.JLatexMathPlugin
import io.noties.markwon.inlineparser.MarkwonInlineParserPlugin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt

private val Ink:Color @Composable get()=MaterialTheme.colors.onSurface
private val Muted:Color @Composable get()=MaterialTheme.colors.onSurface.copy(alpha=0.64f)
private val Wash:Color @Composable get()=if(MaterialTheme.colors.isLight)Color(0xfff1f2f5) else Color(0xff25272b)
private val Bubble:Color @Composable get()=if(MaterialTheme.colors.isLight)Color(0xffedf2fa) else Color(0xff28313d)
@Composable private fun ChromeButton(icon:ImageVector,label:String,click:()->Unit,emphasized:Boolean=false){
    Box(Modifier.size(44.dp).clip(RoundedCornerShape(16.dp)).background(if(emphasized)Wash else Color.Transparent).clickable(onClick=click),contentAlignment=Alignment.Center){Icon(icon,label,tint=Ink,modifier=Modifier.size(22.dp))}
}
@Composable private fun ModernIcon(icon:Int,label:String?=null,modifier:Modifier=Modifier.size(20.dp),tint:Color=Ink){
    Icon(painterResource(icon),label,modifier=modifier,tint=tint)
}
@Composable private fun ChromeButton(icon:Int,label:String,click:()->Unit,emphasized:Boolean=false){
    Box(Modifier.size(44.dp).clip(RoundedCornerShape(16.dp)).background(if(emphasized)Wash else Color.Transparent).clickable(onClick=click),contentAlignment=Alignment.Center){ModernIcon(icon,label,Modifier.size(21.dp))}
}
@Composable private fun PopupMenuRow(icon:Int,label:String,danger:Boolean=false,action:()->Unit){
    val color=if(danger)Color(0xffb4423c) else Ink
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).clickable(onClick=action).padding(horizontal=13.dp,vertical=11.dp),verticalAlignment=Alignment.CenterVertically){ModernIcon(icon,null,Modifier.size(19.dp),color);Text(label,Modifier.padding(start=13.dp),fontSize=14.sp,color=color)}
}
@Composable private fun ModernToggle(checked:Boolean,enabled:Boolean=true,change:(Boolean)->Unit){
    val color=if(MaterialTheme.colors.isLight)Color(0xff3b82ed) else Color(0xff79a9ff)
    val track by animateColorAsState(if(checked)color else Ink.copy(alpha=0.16f),tween(180),label="toggleTrack")
    val thumb by animateDpAsState(if(checked)21.dp else 3.dp,tween(180),label="toggleThumb")
    Box(Modifier.size(46.dp,28.dp).clip(CircleShape).background(track).semantics{stateDescription=if(checked)"开" else "关"}.clickable(enabled=enabled){change(!checked)}){
        Box(Modifier.offset(x=thumb,y=3.dp).size(22.dp).clip(CircleShape).background(Color.White))
    }
}
@Composable private fun ModernDropdown(expanded:Boolean,dismiss:()->Unit,width:Dp,content:@Composable ColumnScope.()->Unit){
    if(!expanded)return
    BackHandler{dismiss()}
    val margin=with(LocalDensity.current){8.dp.roundToPx()}
    val positioner=remember(margin){object:PopupPositionProvider{
        override fun calculatePosition(anchorBounds:IntRect,windowSize:IntSize,layoutDirection:LayoutDirection,popupContentSize:IntSize):IntOffset{
            val preferredX=if(anchorBounds.left+anchorBounds.right>windowSize.width)anchorBounds.right-popupContentSize.width else anchorBounds.left
            val x=preferredX.coerceIn(margin,(windowSize.width-popupContentSize.width-margin).coerceAtLeast(margin))
            val below=anchorBounds.bottom+margin
            val above=anchorBounds.top-popupContentSize.height-margin
            val y=if(below+popupContentSize.height<=windowSize.height-margin)below else above.coerceAtLeast(margin)
            return IntOffset(x,y)
        }
    }}
    Popup(onDismissRequest=dismiss,popupPositionProvider=positioner,properties=PopupProperties(focusable=false,dismissOnClickOutside=true)){
        Surface(shape=RoundedCornerShape(20.dp),elevation=3.dp,color=MaterialTheme.colors.surface,modifier=Modifier.width(width)){
            Column(content=content)
        }
    }
}
@Composable private fun EffortSlider(efforts:List<String>,current:String,change:(String)->Unit,compact:Boolean=false){
    if(efforts.size<2)return
    var index by remember(efforts,current){mutableIntStateOf(efforts.indexOf(current).coerceAtLeast(0))}
    var width by remember{mutableFloatStateOf(1f)}
    val trackColor=if(MaterialTheme.colors.isLight)Color(0xff3b82ed) else Color(0xff79a9ff)
    val surface=MaterialTheme.colors.surface
    val inactive=Wash
    val muted=Muted
    val edge=with(LocalDensity.current){19.dp.toPx()}
    fun step(x:Float):Int=((x-edge)/(width-2f*edge).coerceAtLeast(1f)*efforts.lastIndex).roundToInt().coerceIn(efforts.indices)
    Text("思考强度 · ${effortName(efforts[index])}",modifier=Modifier.padding(start=if(compact)12.dp else 4.dp,top=if(compact)2.dp else 22.dp,bottom=if(compact)0.dp else 5.dp),fontSize=if(compact)12.sp else 13.sp,color=Muted)
    Canvas(Modifier.fillMaxWidth().padding(horizontal=if(compact)10.dp else 4.dp,vertical=8.dp).height(38.dp).testTag("effortSlider").semantics{stateDescription=effortName(efforts[index])}.onSizeChanged{width=it.width.toFloat()}.pointerInput(efforts){detectTapGestures{index=step(it.x);change(efforts[index])}}.pointerInput(efforts){detectDragGestures(onDragEnd={change(efforts[index])}){pointer,_->index=step(pointer.position.x);pointer.consume()}}){
        val radius=size.height/2f
        val start=radius
        val end=size.width-radius
        val thumbX=start+(end-start)*index/efforts.lastIndex
        drawRoundRect(inactive,cornerRadius=CornerRadius(radius),size=size)
        drawRoundRect(trackColor,cornerRadius=CornerRadius(radius),size=Size((thumbX+radius).coerceAtMost(size.width),size.height))
        for(i in efforts.indices){val x=start+(end-start)*i/efforts.lastIndex;drawCircle(if(i<=index)surface.copy(alpha=0.28f) else muted.copy(alpha=0.28f),radius=3.dp.toPx(),center=Offset(x,radius))}
        drawCircle(surface,radius=radius-3.dp.toPx(),center=Offset(thumbX,radius))
        drawCircle(trackColor,radius=radius-3.dp.toPx(),center=Offset(thumbX,radius),style=androidx.compose.ui.graphics.drawscope.Stroke(2.dp.toPx()))
    }
}
@Composable private fun Glyph(icon:ImageVector,label:String,click:()->Unit){IconButton(onClick=click){Icon(icon,label,tint=Ink,modifier=Modifier.size(22.dp))}}
@Composable private fun ActionRow(icon:ImageVector,label:String,danger:Boolean=false,action:()->Unit){
    val color=if(danger)Color(0xffb4423c) else Ink
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable(onClick=action).padding(vertical=7.dp,horizontal=8.dp),verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(38.dp).clip(RoundedCornerShape(13.dp)).background(Wash),contentAlignment=Alignment.Center){Icon(icon,null,tint=color,modifier=Modifier.size(19.dp))};Text(label,color=color,fontSize=15.sp,modifier=Modifier.padding(start=12.dp))}
}
@Composable private fun Entry(value:String,change:(String)->Unit,hint:String,modifier:Modifier=Modifier,surface:Color=Wash){
    Box(modifier.clip(RoundedCornerShape(14.dp)).background(surface).padding(14.dp)) {
        if(value.isEmpty())Text(hint,color=Muted,fontSize=16.sp)
        BasicTextField(value,change,textStyle=TextStyle(color=Ink,fontSize=16.sp),modifier=Modifier.fillMaxWidth())
    }
}
@Composable private fun Sheet(title:String,close:()->Unit,body:@Composable ColumnScope.()->Unit){
    val height=LocalConfiguration.current.screenHeightDp.dp*0.85f
    var drag by remember{mutableStateOf(0f)}
    var entered by remember{mutableStateOf(false)}
    val entrance by animateFloatAsState(if(entered)1f else 0f,tween(180),label="sheetEntrance")
    LaunchedEffect(Unit){entered=true}
    val dismissDistance=with(LocalDensity.current){64.dp.toPx()}
    Dialog(onDismissRequest=close,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Box(Modifier.fillMaxSize().imePadding().navigationBarsPadding(),contentAlignment=Alignment.BottomCenter){
            Box(Modifier.matchParentSize().clickable(interactionSource=remember{MutableInteractionSource()},indication=null,onClick=close))
            Surface(shape=RoundedCornerShape(topStart=32.dp,topEnd=32.dp),color=MaterialTheme.colors.surface,modifier=Modifier.fillMaxWidth().heightIn(max=height).graphicsLayer{alpha=entrance;translationY=(1f-entrance)*60f}.offset{IntOffset(0,drag.toInt())}){
                Column(Modifier.padding(horizontal=20.dp).padding(top=10.dp,bottom=24.dp).verticalScroll(rememberScrollState())){
                    Box(Modifier.fillMaxWidth().height(20.dp).pointerInput(Unit){detectVerticalDragGestures(onDragEnd={if(drag>dismissDistance)close() else drag=0f},onDragCancel={drag=0f}){change,amount->change.consume();drag=(drag+amount).coerceAtLeast(0f)}},contentAlignment=Alignment.TopCenter){Box(Modifier.size(32.dp,4.dp).clip(RoundedCornerShape(2.dp)).background(Color(0xffd9dcdf)))}
                    Row(Modifier.padding(top=8.dp),verticalAlignment=Alignment.CenterVertically){Text(title,Modifier.weight(1f),fontSize=20.sp,fontWeight=FontWeight.SemiBold);ChromeButton(R.drawable.ic_lucide_x,"关闭",close,true)}
                    Spacer(Modifier.height(10.dp));body()
                }
            }
        }
    }
}
@Composable fun NativeApp(vm:NativeViewModel){
    val s=vm.state
    val home=s.threadId.isEmpty() && s.events.isEmpty() && !s.sending && !s.loadingHistory
    val drawer=rememberDrawerState(DrawerValue.Closed)
    val scope=rememberCoroutineScope()
    val composerFocus=remember{FocusRequester()}
    var settings by remember{mutableStateOf(false)}
    var pairing by remember{mutableStateOf(false)}
    var workPanel by remember{mutableStateOf("")}
    val context=LocalContext.current
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->if(result.resultCode==android.app.Activity.RESULT_OK)vm.uploadMedia(nativePickedUris(result.data))}
    val filePicker=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->if(result.resultCode==android.app.Activity.RESULT_OK)vm.uploadFiles(nativePickedUris(result.data))}
    fun chooseAttachment(kind:NativePickKind){
        val launcher=if(kind==NativePickKind.MEDIA)picker else filePicker
        val target=nativePickerIntent(context,kind)
        runCatching{launcher.launch(target)}.onFailure{
            if(target.`package`!=null)runCatching{launcher.launch(nativePickerIntent(context,kind,manufacturer=""))}.onFailure{vm.error("无法打开文件选择器")}
            else vm.error("无法打开文件选择器")
        }
    }
    val clipboard=LocalClipboardManager.current
    val preferences=remember{context.getSharedPreferences("appearance",0)}
    var appearance by remember{mutableStateOf(preferences.getString("theme","system")?:"system")}
    var appearanceOpen by remember{mutableStateOf(false)}
    var attachmentOpen by remember{mutableStateOf(false)}
    var connectionOpen by remember{mutableStateOf(false)}
    var selectedThread by remember{mutableStateOf<ThreadRecord?>(null)}
    var usageOpen by remember{mutableStateOf(false)}
    var workbenchOpen by remember{mutableStateOf(false)}
    var harnessOpen by remember{mutableStateOf(false)}
    var dismissedApprovalKey by remember(s.threadId){mutableStateOf("")}
    val pendingApproval=(s.pendingApprovals+s.events).lastOrNull{it.type=="approval.requested"&&it.threadId==s.threadId&&it.approvalId.isNotBlank()&&it.approvalId !in s.approvals&&s.pendingApprovals.any{pending->pending.approvalId==it.approvalId}}
    val pendingApprovalKey=pendingApproval?.eventId?.ifBlank{pendingApproval.approvalId}.orEmpty()
    val sidebarPrefs=remember{context.getSharedPreferences("sidebar",0)}
    var projectsOpen by remember{mutableStateOf(sidebarPrefs.getBoolean("projects",true))}
    var recentOpen by remember{mutableStateOf(sidebarPrefs.getBoolean("recent",true))}
    var pinnedOpen by remember{mutableStateOf(sidebarPrefs.getBoolean("pinned",true))}
    var goalsOpen by remember{mutableStateOf(sidebarPrefs.getBoolean("goals",true))}
    val dark=appearance=="dark" || (appearance=="system"&&isSystemInDarkTheme())
    val colors=if(dark)darkColors(primary=Color(0xffeceef1),secondary=Color(0xffeceef1),background=Color(0xff14161a),surface=Color(0xff14161a),onPrimary=Color(0xff14161a),onSurface=Color(0xfff1f2f4)) else lightColors(primary=Color(0xff1e2530),secondary=Color(0xff1e2530),background=Color(0xfffafbfc),surface=Color(0xfffafbfc),onPrimary=Color.White,onSurface=Color(0xff20242b))
    SideEffect{(context as? android.app.Activity)?.window?.let{window->window.statusBarColor=colors.background.toArgb();window.navigationBarColor=colors.background.toArgb();window.decorView.systemUiVisibility=if(dark)0 else android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR}}
    MaterialTheme(colors=colors) { CompositionLocalProvider(LocalContentColor provides colors.onSurface){
        BackHandler(drawer.isOpen||workPanel.isNotEmpty()){if(drawer.isOpen)scope.launch{drawer.close()} else workPanel=""}
        ModalDrawer(drawerState=drawer,drawerBackgroundColor=MaterialTheme.colors.surface,drawerContent={
            Column(Modifier.fillMaxSize().padding(horizontal=16.dp,vertical=8.dp)){
                Row(verticalAlignment=Alignment.CenterVertically){
                    Box(Modifier.weight(1f)){
                        Row(Modifier.clip(RoundedCornerShape(12.dp)).clickable{harnessOpen=true}.padding(horizontal=8.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){NativeHarnessIcon(s.harness,Modifier.size(25.dp));Spacer(Modifier.width(10.dp));Text(nativeAgentName(s.harness),fontSize=19.sp,fontWeight=FontWeight.SemiBold);ModernIcon(R.drawable.ic_lucide_chevron_down,"切换助手",Modifier.padding(start=7.dp).size(17.dp))}
                        ModernDropdown(harnessOpen,{harnessOpen=false},240.dp){
                            Column(Modifier.padding(6.dp)){
                                listOf("codex","claude","antigravity","grok").forEach{key->
                                    val available=s.models.any{nativeAgent(it.id)==key}
                                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).clickable(enabled=available){vm.switchHarness(key);workPanel="";harnessOpen=false;scope.launch{drawer.close()}}.padding(horizontal=10.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically){
                                        NativeHarnessIcon(key,Modifier.size(23.dp),if(available)Ink else Muted)
                                        Text(nativeAgentName(key),Modifier.weight(1f).padding(start=12.dp),fontSize=14.sp,color=if(available)Ink else Muted)
                                        if(key==s.harness)ModernIcon(R.drawable.ic_lucide_check,null,Modifier.size(17.dp)) else if(!available)Text("未检测到",fontSize=10.sp,color=Muted)
                                    }
                                }
                            }
                        }
                    }
                    ChromeButton(R.drawable.ic_lucide_x,"收起侧栏",{scope.launch{drawer.close()}},true)
                }
                Row(Modifier.fillMaxWidth().padding(vertical=10.dp).clip(RoundedCornerShape(17.dp)).background(Wash).clickable{vm.newThread();scope.launch{drawer.close()}}.padding(horizontal=14.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){ModernIcon(R.drawable.ic_lucide_square_pen,"新会话",Modifier.size(20.dp));Text("新会话",Modifier.padding(start=12.dp),fontSize=15.sp,fontWeight=FontWeight.Medium)}
                var query by remember{mutableStateOf("")}
                Entry(query,{query=it},"搜索会话",modifier=Modifier.fillMaxWidth(),surface=Wash)
                LazyColumn(Modifier.weight(1f)){
                    if(s.sidebarProjects.isNotEmpty()||s.projects.isNotEmpty())item{SidebarHeading("项目",projectsOpen){projectsOpen=!projectsOpen;sidebarPrefs.edit().putBoolean("projects",projectsOpen).apply()}}
                    if(projectsOpen&&query.isBlank())items(s.sidebarProjects.ifEmpty{s.projects},key={"project:"+it.id}){p->
                        var expanded by remember(p.id){mutableStateOf(sidebarPrefs.getBoolean("project:${p.id}",false))}
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)),verticalAlignment=Alignment.CenterVertically){Row(Modifier.weight(1f).clickable{expanded=!expanded;sidebarPrefs.edit().putBoolean("project:${p.id}",expanded).apply()}.padding(start=12.dp,top=10.dp,bottom=10.dp),verticalAlignment=Alignment.CenterVertically){ModernIcon(R.drawable.ic_lucide_folder,null,Modifier.size(18.dp),Muted);Text(p.name,Modifier.weight(1f).padding(start=11.dp),fontSize=14.sp,maxLines=1,overflow=TextOverflow.Ellipsis);ModernIcon(if(expanded)R.drawable.ic_lucide_chevron_down else R.drawable.ic_lucide_chevron_right,null,Modifier.size(18.dp),Muted)};ChromeButton(R.drawable.ic_lucide_plus,"在项目中新建",{vm.startInProject(p);scope.launch{drawer.close()}})}
                        AnimatedVisibility(expanded){Column{ s.threads.filter{nativeThreadAgent(it.id)==s.harness&&nativePath(it.projectPath)==nativePath(p.path)&&it.title.contains(query,true)}.forEach{t->NativeThreadRow(t,t.id==s.threadId,{vm.openThread(t);scope.launch{drawer.close()}},{selectedThread=t},{vm.pinThread(t,t.pinnedIndex<0)})} }}
                    }
                    val activeGoals=s.threads.filter{nativeThreadAgent(it.id)==s.harness&&(it.status=="running"||it.goal?.status=="active")&&(it.title.contains(query,true)||it.goal?.objective?.contains(query,true)==true)}
                    if(activeGoals.isNotEmpty())item{SidebarHeading("进行中",goalsOpen){goalsOpen=!goalsOpen;sidebarPrefs.edit().putBoolean("goals",goalsOpen).apply()}}
                    if(goalsOpen||query.isNotBlank())items(activeGoals,key={"goal:"+it.id}){t->NativeGoalRow(t){vm.openThread(t);scope.launch{drawer.close()}}}
                    if(s.threads.any{it.pinnedIndex>=0&&it.title.contains(query,true)})item{SidebarHeading("置顶会话",pinnedOpen){pinnedOpen=!pinnedOpen;sidebarPrefs.edit().putBoolean("pinned",pinnedOpen).apply()}}
                    if(pinnedOpen||query.isNotBlank())items(s.threads.filter{nativeThreadAgent(it.id)==s.harness&&it.pinnedIndex>=0&&it.title.contains(query,true)}.sortedBy{it.pinnedIndex},key={"pinned:"+it.id}){t->NativeThreadRow(t,t.id==s.threadId,{vm.openThread(t);scope.launch{drawer.close()}},{selectedThread=t},{vm.pinThread(t,t.pinnedIndex<0)})}
                    if(query.isNotBlank()&&s.threads.none{it.title.contains(query,true)||it.goal?.objective?.contains(query,true)==true})item{Text("没有找到会话",color=Muted,fontSize=14.sp,modifier=Modifier.padding(16.dp))}
                    item{SidebarHeading("最近会话",recentOpen){recentOpen=!recentOpen;sidebarPrefs.edit().putBoolean("recent",recentOpen).apply()}}
                    if(recentOpen||query.isNotBlank())items(s.threads.filter{nativeThreadAgent(it.id)==s.harness&&it.pinnedIndex<0&&it.title.contains(query,true)},key={it.id}){t->NativeThreadRow(t,t.id==s.threadId,{vm.openThread(t);scope.launch{drawer.close()}},{selectedThread=t},{vm.pinThread(t,t.pinnedIndex<0)})}
                }
                Divider(color=Ink.copy(alpha=0.07f))
                PopupMenuRow(R.drawable.ic_lucide_chart_no_axes_column,"用量与配额"){usageOpen=true;vm.loadUsage()}
                PopupMenuRow(R.drawable.ic_lucide_monitor,if(s.connected)"已连接电脑" else "连接电脑"){pairing=true}
            }
        }) {
            Column(Modifier.fillMaxSize().background(MaterialTheme.colors.surface)){
                Row(Modifier.fillMaxWidth().height(62.dp).padding(horizontal=10.dp),verticalAlignment=Alignment.CenterVertically){
                    ChromeButton(R.drawable.ic_menu_compact,"展开侧栏",{scope.launch{drawer.open()}},true)
                    Spacer(Modifier.width(8.dp))
                    Row(Modifier.weight(1f),verticalAlignment=Alignment.CenterVertically){
                        Text(s.threads.find{it.id==s.threadId}?.title.orEmpty().ifBlank{"新会话"},Modifier.testTag("conversationTitle").weight(1f,false),fontSize=17.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
                        Box(Modifier.padding(start=4.dp).size(24.dp).clip(CircleShape).clickable{connectionOpen=true},contentAlignment=Alignment.Center){
                            if(s.running&&!s.sending)CircularProgressIndicator(Modifier.size(15.dp),strokeWidth=1.5.dp,color=Muted)
                            Box(Modifier.size(6.dp).clip(CircleShape).background(if(s.error.isNotBlank()||(!s.connected&&!s.connecting))Color(0xffc14954) else if(s.connected)Color(0xff429575) else Muted))
                        }
                    }
                    ChromeButton(R.drawable.ic_lucide_square_pen,"新会话",{vm.newThread()})
                    var more by remember{mutableStateOf(false)}
                    Box{
                        ChromeButton(R.drawable.ic_lucide_ellipsis,"会话菜单",{more=true})
                        ModernDropdown(more,{more=false},250.dp){
                            Column(Modifier.padding(6.dp)){
                                PopupMenuRow(R.drawable.ic_lucide_chart_no_axes_column,"数据工作台"){more=false;workbenchOpen=true;vm.loadUsage()}
                                PopupMenuRow(R.drawable.ic_lucide_chart_no_axes_column,"用量与配额"){more=false;usageOpen=true;vm.loadUsage()}
                                PopupMenuRow(R.drawable.ic_lucide_sliders_horizontal,"模型与权限"){more=false;vm.loadRemoteApproval();settings=true}
                                PopupMenuRow(R.drawable.ic_lucide_settings_2,"外观"){more=false;appearanceOpen=true}
                                Divider(Modifier.padding(vertical=5.dp),color=Ink.copy(alpha=0.08f))
                                PopupMenuRow(R.drawable.ic_lucide_folder,"文件"){more=false;vm.files();workPanel="文件"}
                                PopupMenuRow(R.drawable.ic_lucide_file_text,"改动"){more=false;vm.diff();workPanel="改动"}
                                PopupMenuRow(R.drawable.ic_lucide_terminal,"终端"){more=false;workPanel="终端"}
                                PopupMenuRow(R.drawable.ic_lucide_monitor,"连接电脑"){more=false;pairing=true}
                            }
                        }
                    }
                }
                if(home){Box(Modifier.weight(1f),contentAlignment=Alignment.Center){NativeWelcome(s.harness)}} else Box(Modifier.weight(1f)){NativeMessages(vm){dismissedApprovalKey=""}}
                AnimatedVisibility(s.queue.isNotEmpty()) {Column(Modifier.padding(horizontal=16.dp).heightIn(max=104.dp).verticalScroll(rememberScrollState())){s.queue.forEach{q->
                    Row(Modifier.fillMaxWidth().padding(vertical=2.dp).height(42.dp).clip(RoundedCornerShape(15.dp)).background(Wash).padding(start=12.dp,end=2.dp),verticalAlignment=Alignment.CenterVertically){Icon(Icons.Rounded.Schedule,null,tint=Muted,modifier=Modifier.size(16.dp));Text(q.text.ifBlank{"${q.images.size} 张图片 · ${q.uploads.size} 个文件"},Modifier.weight(1f).padding(start=8.dp),maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=13.sp);if(q.status=="sending"||q.error.isNotBlank()||q.status=="failed")Text(if(q.status=="sending")"发送中" else "待处理",fontSize=11.sp,color=Muted,maxLines=1,modifier=Modifier.padding(start=6.dp))
                        var show by remember(q.id){mutableStateOf(false)}
                        if(q.status!="sending")Box{
                            Box(Modifier.size(34.dp).clip(RoundedCornerShape(11.dp)).clickable{show=true},contentAlignment=Alignment.Center){ModernIcon(R.drawable.ic_lucide_ellipsis,"待发消息操作",Modifier.size(18.dp),Muted)}
                            ModernDropdown(show,{show=false},218.dp){Column(Modifier.padding(6.dp)){
                                if(q.error.isNotBlank()){
                                    Text(nativeQueueError(q.error),Modifier.padding(10.dp),fontSize=12.sp,color=Muted,maxLines=3,overflow=TextOverflow.Ellipsis)
                                    PopupMenuRow(R.drawable.ic_lucide_copy,"复制错误详情"){clipboard.setText(AnnotatedString(q.error));show=false}
                                }
                                PopupMenuRow(R.drawable.ic_lucide_square_pen,"编辑消息"){show=false;vm.restoreQueued(q);scope.launch{composerFocus.requestFocus()}}
                                if(q.canSteer)PopupMenuRow(R.drawable.ic_lucide_corner_down_right,"改为引导"){show=false;vm.queueAction(q,"steer")}
                                if(q.status=="failed")PopupMenuRow(R.drawable.ic_lucide_rotate_cw,"重试"){show=false;vm.queueAction(q,"retry")}
                                PopupMenuRow(R.drawable.ic_lucide_x,"取消发送",danger=true){show=false;vm.queueAction(q,"delete")}
                            }}
                        }
                    }
                }}}
                s.threads.find{it.id==s.threadId}?.goal?.let{goal->NativeGoalDock(vm,s.threadId,goal)}
                Surface(Modifier.padding(horizontal=12.dp,vertical=6.dp).fillMaxWidth(),shape=RoundedCornerShape(28.dp),color=Wash){Column(Modifier.padding(horizontal=9.dp,vertical=7.dp)){
                    if(s.images.isNotEmpty())Row(Modifier.horizontalScroll(rememberScrollState())){s.images.forEach{img->Box(Modifier.padding(6.dp)){NativeImageView(vm,"/api/uploads/images/${img.id}",Modifier.size(64.dp));IconButton(onClick={vm.removeImage(img.id)},modifier=Modifier.align(Alignment.TopEnd).size(28.dp).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colors.surface)){ModernIcon(R.drawable.ic_lucide_x,"移除图片",Modifier.size(16.dp))}}}}
                    if(s.uploads.isNotEmpty())Row(Modifier.horizontalScroll(rememberScrollState())){s.uploads.forEach{file->Surface(shape=RoundedCornerShape(12.dp),color=MaterialTheme.colors.surface,modifier=Modifier.padding(4.dp)){Row(verticalAlignment=Alignment.CenterVertically){ModernIcon(if(file.mime.startsWith("video/"))R.drawable.ic_lucide_video else R.drawable.ic_lucide_file_text,null,Modifier.padding(start=9.dp).size(18.dp));Text(file.name,Modifier.widthIn(max=170.dp).padding(8.dp),maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=13.sp);IconButton(onClick={vm.removeUpload(file.id)},modifier=Modifier.size(30.dp)){ModernIcon(R.drawable.ic_lucide_x,"移除文件",Modifier.size(16.dp))}}}}}
                    Box(Modifier.fillMaxWidth().padding(start=12.dp,end=12.dp,top=12.dp,bottom=8.dp)){if(s.draft.isEmpty())Text(if(s.running)"添加下一步任务…" else "描述任务…",color=Muted,fontSize=16.sp);BasicTextField(s.draft,vm::draft,textStyle=TextStyle(fontSize=16.sp,color=Ink),keyboardOptions=KeyboardOptions(capitalization=KeyboardCapitalization.Sentences),modifier=Modifier.testTag("composer").focusRequester(composerFocus).fillMaxWidth().heightIn(min=26.dp,max=120.dp))}
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                        Box{
                            ChromeButton(R.drawable.ic_lucide_plus,"添加附件",{attachmentOpen=true})
                            ModernDropdown(attachmentOpen,{attachmentOpen=false},220.dp){
                                Column(Modifier.padding(6.dp)){
                                    PopupMenuRow(R.drawable.ic_lucide_images,"图片与视频"){attachmentOpen=false;chooseAttachment(NativePickKind.MEDIA)}
                                    PopupMenuRow(R.drawable.ic_lucide_folder_open,"文件"){attachmentOpen=false;chooseAttachment(NativePickKind.FILES)}
                                }
                            }
                        }
                        val model=s.models.find{it.id==s.model}
                        Spacer(Modifier.weight(1f))
                        var modelMenu by remember{mutableStateOf(false)}
                        Box{
                            Row(Modifier.widthIn(max=184.dp).height(40.dp).clip(RoundedCornerShape(20.dp)).clickable{modelMenu=true}.padding(horizontal=10.dp),verticalAlignment=Alignment.CenterVertically){
                                Text((model?.name?.substringAfter(" · ")?:"选择模型")+(if(s.effort.isBlank()||(model?.efforts?.size?:0)<2)"" else " · "+effortName(s.effort)),Modifier.weight(1f,false),fontSize=12.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
                                ModernIcon(R.drawable.ic_lucide_chevron_down,null,Modifier.padding(start=3.dp).size(15.dp),Muted)
                            }
                            ModernDropdown(modelMenu,{modelMenu=false},268.dp){
                                Column(Modifier.padding(7.dp)){
                                    Text("模型",Modifier.padding(start=12.dp,top=7.dp,bottom=4.dp),fontSize=12.sp,color=Muted)
                                    Column(Modifier.heightIn(max=190.dp).verticalScroll(rememberScrollState())){
                                        s.models.filter{nativeAgent(it.id)==s.harness}.forEach{m->
                                            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable{vm.chooseModel(m.id);modelMenu=false}.padding(horizontal=12.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically){
                                                Text(m.name.substringAfter(" · "),Modifier.weight(1f),fontSize=14.sp,fontWeight=if(m.id==s.model)FontWeight.SemiBold else FontWeight.Normal,maxLines=1,overflow=TextOverflow.Ellipsis)
                                                if(m.id==s.model)ModernIcon(R.drawable.ic_lucide_check,null,Modifier.size(17.dp))
                                            }
                                        }
                                    }
                                    if((model?.efforts?.size?:0)>1){
                                        Divider(Modifier.padding(vertical=6.dp),color=Ink.copy(alpha=0.08f))
                                        EffortSlider(model!!.efforts,s.effort,vm::effort,compact=true)
                                    }
                                    Divider(Modifier.padding(top=9.dp,bottom=4.dp),color=Ink.copy(alpha=0.08f))
                                    PopupMenuRow(R.drawable.ic_lucide_sliders_horizontal,"权限与更多设置"){modelMenu=false;vm.loadRemoteApproval();settings=true}
                                }
                            }
                        }
                        val hasInput=s.draft.isNotBlank()||s.images.isNotEmpty()||s.uploads.isNotEmpty()
                        val stop=s.running&&!hasInput&&!s.sending&&!s.uploading
                        val enabled=s.connected&&!s.sending&&!s.uploading&&(hasInput||stop)
                        Box(Modifier.padding(start=4.dp).size(42.dp).semantics{contentDescription=if(stop)"停止任务" else if(s.running)"加入队列" else "发送消息"}.clickable(enabled=enabled){if(stop)vm.stop() else vm.send()},contentAlignment=Alignment.Center){
                            Box(Modifier.size(36.dp).clip(CircleShape).background(if(enabled)Ink else Ink.copy(alpha=0.15f)),contentAlignment=Alignment.Center){
                                if(s.sending||s.uploading)CircularProgressIndicator(Modifier.size(16.dp),color=MaterialTheme.colors.onPrimary,strokeWidth=2.dp)
                                else if(stop)Box(Modifier.size(13.dp).clip(RoundedCornerShape(2.dp)).background(MaterialTheme.colors.onPrimary))
                                else ModernIcon(R.drawable.ic_lucide_arrow_up,null,Modifier.size(18.dp),MaterialTheme.colors.onPrimary)
                            }
                        }
                    }
                }}
                Spacer(Modifier.height(2.dp))
            }
        }
        if(usageOpen)Sheet("用量与配额",{usageOpen=false}){NativeUsage(vm)}
        if(workbenchOpen)Sheet("工作台",{workbenchOpen=false}){NativeWorkbench(vm)}
        selectedThread?.let{thread->
            var name by remember(thread.id){mutableStateOf(thread.title)}
            Sheet("重命名会话",{selectedThread=null}){
                Entry(name,{name=it},"会话名称",modifier=Modifier.fillMaxWidth())
                Button(onClick={vm.renameThread(thread,name);selectedThread=null},enabled=name.isNotBlank()&&!s.workBusy,modifier=Modifier.fillMaxWidth().padding(top=12.dp)){Text("保存")}
            }
        }
        if(connectionOpen)Sheet("连接状态",{connectionOpen=false}){Text(if(s.error.isNotBlank())s.error else if(s.connected)"已连接 ${if(s.activeAddress==s.publicUrl)"公网" else "内网"}" else if(s.connecting)"正在连接电脑" else "尚未连接电脑",fontSize=14.sp,color=if(s.error.isNotBlank())MaterialTheme.colors.error else Ink);if(s.error.isNotBlank())TextButton(onClick={vm.error("");connectionOpen=false}){Text("清除提示")};TextButton(onClick={connectionOpen=false;pairing=true}){Text("连接电脑")}}
        if(appearanceOpen)Sheet("外观",{appearanceOpen=false}){listOf("system" to "跟随系统","light" to "浅色","dark" to "深色").forEach{(value,label)->ActionRow(if(appearance==value)Icons.Outlined.Check else Icons.Outlined.Palette,label){appearance=value;preferences.edit().putString("theme",value).apply();appearanceOpen=false}}}
        if(pairing) NativePairingSheet(vm){pairing=false}
        if(settings)NativeModelSettings(vm){settings=false}
        if(workPanel.isNotEmpty())Sheet(workPanel,{workPanel=""}){NativeWorkspace(vm,workPanel)}
        if(pendingApproval!=null&&pendingApprovalKey!=dismissedApprovalKey&&!settings&&!pairing&&!harnessOpen&&!usageOpen&&!appearanceOpen&&workPanel.isEmpty()&&s.pdf==null&&s.markdown==null)Sheet(if(pendingApproval.approvalType=="question")"需要你的回答" else "需要你的确认",{dismissedApprovalKey=pendingApprovalKey}){
            if(pendingApproval.approvalType=="question")NativeQuestions(vm,pendingApproval)
            else {Text(pendingApproval.title,fontSize=16.sp,fontWeight=FontWeight.Medium);if(pendingApproval.detail.isNotBlank())Text(pendingApproval.detail,Modifier.padding(vertical=10.dp),fontSize=14.sp);Row{TextButton(enabled=!s.workBusy,onClick={vm.approve(pendingApproval.approvalId,false)}){Text("拒绝")};Button(enabled=!s.workBusy,onClick={vm.approve(pendingApproval.approvalId,true)}){Text("允许")}}}
        }
        s.pdf?.let{NativePdfPreview(it,vm::closePdf)}
        s.markdown?.let{NativeMarkdownPreview(vm,it,vm::closeMarkdown)}
    }
}
}
@Composable private fun NativeWelcome(harness:String){
    Column(Modifier.fillMaxWidth().padding(horizontal=24.dp,vertical=24.dp),horizontalAlignment=Alignment.CenterHorizontally){
        NativeHarnessIcon(harness,Modifier.size(36.dp),Color(0xFFA5A5A5))
        Spacer(Modifier.height(18.dp))
        Text("今天想完成什么？",fontSize=24.sp,fontWeight=FontWeight.Medium)
    }
}
@Composable private fun NativeGoalDock(vm:NativeViewModel,threadId:String,goal:NativeGoal){
    var expanded by remember(threadId){mutableStateOf(false)}
    var editing by remember(threadId){mutableStateOf(false)}
    var objective by remember(threadId,goal.objective){mutableStateOf(goal.objective)}
    val status=when(goal.status){"active"->"进行中";"paused"->"已暂停";"blocked"->"受阻";"usage_limited"->"用量限制";"budget_limited"->"预算限制";else->goal.status}
    Column(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=4.dp)){
        Surface(shape=RoundedCornerShape(18.dp),color=Wash,modifier=Modifier.fillMaxWidth().testTag("goalChip")){
            Column {Row(Modifier.fillMaxWidth().clickable{expanded=!expanded}.padding(horizontal=12.dp,vertical=9.dp),verticalAlignment=Alignment.CenterVertically){
                Icon(Icons.Outlined.RadioButtonChecked,null,tint=Muted,modifier=Modifier.size(18.dp))
                Text(if(expanded)"目标" else "目标：${goal.objective}",Modifier.weight(1f).padding(start=8.dp),fontSize=14.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                Text(status,fontSize=12.sp,color=Muted,modifier=Modifier.padding(start=8.dp))
                Icon(if(expanded)Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight,null,tint=Muted,modifier=Modifier.padding(start=2.dp).size(16.dp))
            }
            AnimatedVisibility(expanded){Column(Modifier.padding(start=14.dp,end=14.dp,bottom=8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                SelectionContainer{Text(goal.objective,Modifier.testTag("goalObjective"),fontSize=14.sp,lineHeight=21.sp)}
                if(goal.tokenBudget!=null)Text("已用 ${goal.tokensUsed} / ${goal.tokenBudget} tokens",fontSize=12.sp,color=Muted)
                Row {TextButton(onClick={editing=true}){Text("编辑")};TextButton(onClick={vm.updateGoal(threadId,status=if(goal.status=="active")"paused" else "active")},enabled=!vm.state.workBusy){Text(if(goal.status=="active")"暂停" else "继续")}}
            }} }
        }
    }
    if(editing)Sheet("编辑目标",{editing=false}){Entry(objective,{objective=it},"目标内容",modifier=Modifier.fillMaxWidth());Button(onClick={vm.updateGoal(threadId,objective=objective.trim());editing=false},enabled=objective.isNotBlank()&&!vm.state.workBusy,modifier=Modifier.fillMaxWidth().padding(top=12.dp)){Text("保存")}}
}
@Composable private fun NativeModelSettings(vm:NativeViewModel,close:()->Unit){
    val s=vm.state
    val model=s.models.find{it.id==s.model}
    var expanded by remember{mutableStateOf(false)}
    var search by remember{mutableStateOf("")}
    Sheet("模型与思考强度",close){
        Text("模型",fontSize=13.sp,color=Muted,modifier=Modifier.padding(start=4.dp,bottom=8.dp,top=8.dp))
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Wash).clickable{expanded=!expanded}.padding(horizontal=16.dp,vertical=15.dp),verticalAlignment=Alignment.CenterVertically){
            Text(model?.name?.substringAfter(" · ")?:"选择模型",Modifier.weight(1f),fontSize=16.sp,fontWeight=FontWeight.Medium,maxLines=2,overflow=TextOverflow.Ellipsis)
            Icon(if(expanded)Icons.Rounded.KeyboardArrowUp else Icons.Rounded.KeyboardArrowDown,"选择模型",tint=Muted,modifier=Modifier.size(20.dp))
        }
        AnimatedVisibility(expanded){Column{
            Spacer(Modifier.height(8.dp));Entry(search,{search=it},"搜索模型")
            val matches=s.models.filter{nativeAgent(it.id)==s.harness&&it.name.contains(search,true)}
            if(matches.isEmpty())Text("没有匹配的模型",color=Muted,modifier=Modifier.padding(12.dp))
            Column(Modifier.heightIn(max=220.dp).verticalScroll(rememberScrollState()).padding(top=4.dp)){
                matches.forEach{m->Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable{vm.chooseModel(m.id);expanded=false;search=""}.padding(horizontal=14.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){
                    Text(m.name.substringAfter(" · "),Modifier.weight(1f),fontSize=15.sp);if(m.id==s.model)Icon(Icons.Rounded.Check,null,modifier=Modifier.size(19.dp))
                }}
            }
        }}
        val efforts=model?.efforts.orEmpty()
        EffortSlider(efforts,s.effort,vm::effort)
        Text("执行权限",fontSize=13.sp,color=Muted,modifier=Modifier.padding(start=4.dp,top=22.dp,bottom=8.dp))
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Wash)){
            (listOf("ask" to "询问","auto" to "自动审批","full" to "完全访问")+if(s.harness=="codex")listOf("custom" to "自定义 (config.toml)")else emptyList()).forEach{(value,label)->
                Row(Modifier.fillMaxWidth().clickable{vm.permission(value)}.padding(horizontal=16.dp,vertical=13.dp),verticalAlignment=Alignment.CenterVertically){
                    Text(label,Modifier.weight(1f),fontSize=15.sp)
                    if(s.permission==value)Icon(Icons.Rounded.Check,"已选择",tint=Ink,modifier=Modifier.size(18.dp))
                }
            }
        }
        if(s.harness=="codex"){
            Row(Modifier.fillMaxWidth().padding(top=18.dp,bottom=4.dp).clip(RoundedCornerShape(18.dp)).background(Wash).padding(horizontal=16.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text("自动处理 Codex 审批",fontSize=15.sp);Text(if(s.approvalBridgeConnected)"桌面审批通道已连接" else if(s.approvalBridgeConfigured)"桌面审批通道未连接，重启电脑端 Codex 后生效" else "桌面审批桥接尚未安装",fontSize=12.sp,color=Muted)};ModernToggle(s.desktopAutoApprove,s.connected&&!s.remoteApprovalBusy,vm::setRemoteAutoApproval)}
        }
    }
}
@Composable private fun NativeThreadRow(t:ThreadRecord,selected:Boolean=false,open:()->Unit,rename:()->Unit,pin:()->Unit){
    var menu by remember(t.id){mutableStateOf(false)}
    Box(Modifier.fillMaxWidth()){
        Row(Modifier.fillMaxWidth().testTag("threadRow:${t.id}").clip(RoundedCornerShape(14.dp)).background(if(selected)Wash else Color.Transparent).combinedClickable(onClick=open,onLongClick={menu=true}).padding(vertical=12.dp,horizontal=13.dp),verticalAlignment=Alignment.CenterVertically){
            if(t.pinnedIndex>=0)ModernIcon(R.drawable.ic_lucide_pin,null,Modifier.padding(end=8.dp).size(14.dp),Muted)
            Text(t.title.ifBlank{"新会话"},fontSize=14.sp,fontWeight=if(selected)FontWeight.Medium else FontWeight.Normal,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f))
            if(t.status=="running")CircularProgressIndicator(Modifier.size(12.dp),strokeWidth=2.dp,color=Muted)
        }
        ModernDropdown(menu,{menu=false},190.dp){Column(Modifier.padding(6.dp)){
            if(nativeThreadAgent(t.id)=="codex")PopupMenuRow(R.drawable.ic_lucide_pin,if(t.pinnedIndex>=0)"取消置顶" else "置顶"){menu=false;pin()}
            PopupMenuRow(R.drawable.ic_lucide_square_pen,"重命名"){menu=false;rename()}
        }}
    }
}
@Composable private fun NativeGoalRow(t:ThreadRecord,open:()->Unit){Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick=open).padding(vertical=10.dp,horizontal=12.dp),verticalAlignment=Alignment.CenterVertically){CircularProgressIndicator(Modifier.size(12.dp),strokeWidth=2.dp);Column(Modifier.padding(start=10.dp)){Text(if(t.goal?.status=="active")t.goal.objective else t.title,fontSize=14.sp,maxLines=2,overflow=TextOverflow.Ellipsis);if(t.goal?.status=="active")Text(t.title,fontSize=12.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)}}}
@Composable private fun SidebarHeading(title:String,expanded:Boolean,toggle:()->Unit){Row(Modifier.fillMaxWidth().padding(top=12.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick=toggle).padding(horizontal=12.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically){Text(title,Modifier.weight(1f),fontSize=12.sp,fontWeight=FontWeight.SemiBold,color=Muted);ModernIcon(if(expanded)R.drawable.ic_lucide_chevron_down else R.drawable.ic_lucide_chevron_right,if(expanded)"收起$title" else "展开$title",Modifier.size(18.dp),Muted)}}
private fun effortName(s:String)=mapOf("none" to "无","minimal" to "极低","low" to "低","medium" to "中","high" to "高","xhigh" to "极高","max" to "超高","ultra" to "最高")[s]?:s

@Composable private fun NativeMessages(vm:NativeViewModel,onQuestionOpen:()->Unit){
    val s=vm.state
    val blocks=remember(s.events,s.pendingApprovals,s.approvals,s.running){
        val existing=s.events.map{it.approvalId}.filter{it.isNotBlank()}.toSet()
        nativeTimeline(s.events+s.pendingApprovals.filter{it.approvalId !in existing&&it.approvalId !in s.approvals},s.threadId,running=s.running)
    }
    val list=rememberLazyListState();val scope=rememberCoroutineScope()
    var follow by remember(s.threadId){mutableStateOf(true)}
    val scrollConnection=remember(s.threadId){object:NestedScrollConnection{
        override fun onPreScroll(available:Offset,source:NestedScrollSource):Offset{if(available.y>0)follow=false;return Offset.Zero}
        override fun onPostScroll(consumed:Offset,available:Offset,source:NestedScrollSource):Offset{if(source==NestedScrollSource.Drag&&consumed.y<0){val info=list.layoutInfo;val last=info.visibleItemsInfo.lastOrNull();if(last!=null&&last.index==info.totalItemsCount-1&&last.offset+last.size<=info.viewportEndOffset+8)follow=true};return Offset.Zero}
    }}
    LaunchedEffect(list.firstVisibleItemIndex,list.isScrollInProgress,s.hasMoreHistory){
        if(!follow&&!list.isScrollInProgress&&list.firstVisibleItemIndex==0&&s.hasMoreHistory)vm.loadOlderHistory()
    }
    LaunchedEffect(s.threadId,blocks.lastOrNull(),blocks.size){if(follow&&!list.isScrollInProgress&&blocks.isNotEmpty())list.scrollToItem(blocks.size)}
    Box(Modifier.fillMaxSize()){
        LazyColumn(state=list,modifier=Modifier.testTag("messages").fillMaxSize().nestedScroll(scrollConnection),contentPadding=PaddingValues(horizontal=18.dp,vertical=4.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
            if(s.hasMoreHistory||s.loadingOlderHistory)item(key="older"){if(s.loadingOlderHistory)Box(Modifier.fillMaxWidth().height(38.dp),contentAlignment=Alignment.Center){CircularProgressIndicator(Modifier.size(16.dp),strokeWidth=2.dp,color=Muted)}else TextButton(onClick=vm::loadOlderHistory,modifier=Modifier.fillMaxWidth()){Text("查看更早记录",fontSize=13.sp,color=Muted)}}
            items(blocks,key={it.key}){block->if(block.activities.isNotEmpty())NativeToolGroup(block) else NativeMessage(vm,block.event,onQuestionOpen)}
            item(key="activity") {Column{if(vm.pendingText().isNotBlank())Text(vm.pendingText(),Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Wash).padding(16.dp));if(s.sending||s.loadingHistory)CircularProgressIndicator(Modifier.padding(12.dp).size(16.dp),strokeWidth=2.dp,color=Muted)}}
        }

        if(!follow)SmallFloatingActionButton(onClick={follow=true;scope.launch{list.animateScrollToItem(blocks.size)}},modifier=Modifier.align(Alignment.BottomCenter).padding(8.dp)){Icon(Icons.Outlined.ArrowDownward,"回到最新")}
    }
}
@Composable private fun SmallFloatingActionButton(onClick:()->Unit,modifier:Modifier,content:@Composable ()->Unit){FloatingActionButton(onClick,modifier.size(42.dp),backgroundColor=MaterialTheme.colors.surface,contentColor=Ink,content=content)}
@Composable private fun NativeMessage(vm:NativeViewModel,event:ChatEvent,onQuestionOpen:()->Unit){
    if(event.type=="user.message")NativeUserMessage(vm,event)
    else if(event.type=="approval.requested"&&event.approvalType=="question"){
        val question=runCatching{org.json.JSONObject(event.detail).getJSONArray("questions").getJSONObject(0).getString("question")}.getOrDefault("需要你的回答")
        val pending=event.approvalId !in vm.state.approvals&&vm.state.pendingApprovals.any{it.approvalId==event.approvalId}
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(enabled=pending,onClick=onQuestionOpen).padding(horizontal=8.dp,vertical=9.dp),verticalAlignment=Alignment.CenterVertically){Icon(Icons.Outlined.HelpOutline,null,Modifier.size(17.dp),tint=Muted);Text(if(pending)question else "已回答 · $question",Modifier.weight(1f).padding(start=9.dp),fontSize=13.sp,color=Muted,maxLines=2,overflow=TextOverflow.Ellipsis);if(pending)Icon(Icons.Outlined.ChevronRight,null,Modifier.size(17.dp),tint=Muted)}
    }
    else if(event.type=="message.delta")Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
        NativeRichText(vm,event.text)
        if(event.text.trim().length>160)NativeMessageActions(event.text)
    }
    else {
        var expanded by remember(event.eventId){mutableStateOf(event.type=="error"||event.type=="approval.requested")}
        Column(Modifier.fillMaxWidth()){
            val label=event.title.ifBlank{when(event.type){"reasoning.summary"->"思考摘要";"plan.updated"->"任务计划";"approval.requested"->"需要确认";"file.changed","diff.updated"->"文件改动";"error"->"执行失败";else->"运行提示"}}
            Row(Modifier.fillMaxWidth().heightIn(min=36.dp).clip(RoundedCornerShape(12.dp)).clickable{expanded=!expanded}.padding(horizontal=6.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically){
                Icon(when(event.type){"file.changed","diff.updated"->Icons.Outlined.EditNote;"plan.updated"->Icons.Outlined.Checklist;"error"->Icons.Outlined.ErrorOutline;"approval.requested"->Icons.Outlined.VerifiedUser;else->Icons.Outlined.Info},null,tint=Muted,modifier=Modifier.size(17.dp))
                Text(label,Modifier.weight(1f).padding(start=9.dp),fontSize=13.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
                Icon(if(expanded)Icons.Outlined.ExpandLess else Icons.Outlined.ChevronRight,null,tint=Muted,modifier=Modifier.size(17.dp))
            }
            AnimatedVisibility(expanded){Surface(Modifier.fillMaxWidth().padding(start=26.dp,end=4.dp,top=2.dp,bottom=4.dp),shape=RoundedCornerShape(14.dp),color=Wash){Column(Modifier.padding(12.dp)){NativeMarkdown(event.text.ifBlank{event.detail.ifBlank{event.command.ifBlank{event.diff}}});if(event.type=="approval.requested"&&event.approvalId.isNotBlank()&&event.approvalId !in vm.state.approvals&&vm.state.pendingApprovals.any{it.approvalId==event.approvalId})Row{TextButton(enabled=!vm.state.workBusy,onClick={vm.approve(event.approvalId,false)}){Text("拒绝")};Button(enabled=!vm.state.workBusy,onClick={vm.approve(event.approvalId,true)}){Text("允许")}}}}}
        }
    }
}
@Composable private fun NativeUserMessage(vm:NativeViewModel,event:ChatEvent){
    val imageEndpoints=buildList {
        event.images.forEach{add("/api/uploads/images/${it.id}")}
        event.attachments.forEach{file->
            if(file.path.substringAfterLast('.').lowercase() in listOf("png","jpg","jpeg","gif","webp")){
                (file.url.takeIf{it.startsWith("/api/threads/")}
                    ?:runCatching{nativeFileEndpoint(vm.state,file.path)}.getOrNull())?.let(::add)
            }
        }
    }
    val otherAttachments=event.attachments.filterNot{it.path.substringAfterLast('.').lowercase() in listOf("png","jpg","jpeg","gif","webp")}
    val maxWidth=(LocalConfiguration.current.screenWidthDp*0.82f).dp
    Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.End){
        Surface(Modifier.widthIn(max=maxWidth),shape=RoundedCornerShape(topStart=23.dp,topEnd=23.dp,bottomStart=23.dp,bottomEnd=9.dp),color=Bubble){
            Column(Modifier.padding(10.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                if(imageEndpoints.isNotEmpty()){
                    val tileSize=if(imageEndpoints.size==1)132.dp else 96.dp
                    imageEndpoints.chunked(2).forEach{row->
                        Row(horizontalArrangement=Arrangement.spacedBy(6.dp)){
                            row.forEach{endpoint->NativeImageView(vm,endpoint,Modifier.size(tileSize),thumbnail=true)}
                        }
                    }
                }
                event.uploads.forEach{file->
                    Surface(shape=RoundedCornerShape(12.dp),color=MaterialTheme.colors.surface,modifier=Modifier.clickable{vm.openUpload(file)}){
                        Row(Modifier.padding(8.dp),verticalAlignment=Alignment.CenterVertically){
                            ModernIcon(if(file.mime.startsWith("video/"))R.drawable.ic_lucide_video else R.drawable.ic_lucide_file_text,null,Modifier.size(18.dp))
                            Text(file.name,Modifier.widthIn(max=220.dp).padding(start=8.dp),maxLines=2,overflow=TextOverflow.Ellipsis,fontSize=13.sp)
                        }
                    }
                }
                otherAttachments.forEach{file->TextButton(onClick={vm.openOutput(file.path)}){Text(file.name,maxLines=2,overflow=TextOverflow.Ellipsis)}}
                if(event.text.isNotBlank())SelectionContainer{Text(event.text,Modifier.padding(horizontal=6.dp,vertical=2.dp),fontSize=16.sp,lineHeight=25.sp)}
            }
        }
        if(event.text.trim().length>160)NativeMessageActions(event.text,true)
    }
}
@Composable private fun NativeMessageActions(text:String,user:Boolean=false){
    if(text.trim().length<=160)return
    val clipboard=LocalClipboardManager.current
    var copied by remember(text){mutableStateOf(false)}
    LaunchedEffect(copied){if(copied){delay(1800);copied=false}}
    Row {
        IconButton(onClick={clipboard.setText(AnnotatedString(text));copied=true},modifier=Modifier.size(40.dp)){
            ModernIcon(if(copied)R.drawable.ic_lucide_check else R.drawable.ic_lucide_copy,if(copied)"已复制" else if(user)"复制消息" else "复制回复",Modifier.size(18.dp),Muted)
        }
    }
}
@Composable private fun NativeUsage(vm:NativeViewModel){
    val s=vm.state;val data=s.usage
    Row(Modifier.fillMaxWidth().padding(bottom=14.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        listOf(1 to "今天",7 to "近 7 天",30 to "近 30 天").forEach{(days,label)->
            val selected=s.usageDays==days
            Box(Modifier.clip(RoundedCornerShape(16.dp)).background(if(selected)Ink else Wash).clickable{vm.loadUsage(days)}.padding(horizontal=15.dp,vertical=8.dp)){
                Text(label,fontSize=13.sp,color=if(selected)MaterialTheme.colors.surface else Ink)
            }
        }
    }
    if(s.usageLoading)Row(Modifier.padding(vertical=16.dp),verticalAlignment=Alignment.CenterVertically){CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp);Text("正在读取用量…",Modifier.padding(start=12.dp),color=Muted)}
    if(s.usageError.isNotBlank())Text(s.usageError,color=MaterialTheme.colors.error,fontSize=14.sp)
    if(!s.connected)Text("连接电脑后查看用量",color=Muted,fontSize=14.sp)
    if(data!=null){
        val quota=data.optJSONObject("quota");val windows=quota?.optJSONArray("windows")
        Text("账号额度"+(quota?.optString("plan")?.takeIf{it.isNotBlank()&&it!="null"}?.let{" · "+it.uppercase()}?:""),fontSize=14.sp,fontWeight=FontWeight.Medium)
        if(windows==null||windows.length()==0)Text("暂无账号额度数据",color=Muted,fontSize=14.sp,modifier=Modifier.padding(vertical=12.dp))
        for(i in 0 until (windows?.length()?:0)){
            val w=windows!!.getJSONObject(i);val mins=w.optDouble("durationMins");val remaining=if(w.isNull("remainingPercent"))null else w.optDouble("remainingPercent")
            val label=if(!mins.isFinite())"额度" else if(mins>=1440)"${(mins/1440).toInt()} 天额度" else "${mins/60} 小时额度"
            Column(Modifier.padding(vertical=14.dp)){
                Row(verticalAlignment=Alignment.CenterVertically){Text(w.optString("name","Codex")+" · "+label,Modifier.weight(1f),fontSize=14.sp);Text(remaining?.let{"${it.toInt()}% 剩余"}?:"—",fontSize=14.sp,fontWeight=FontWeight.Medium)}
                if(remaining!=null)LinearProgressIndicator((remaining/100).toFloat().coerceIn(0f,1f),modifier=Modifier.fillMaxWidth().padding(vertical=10.dp).height(5.dp).clip(RoundedCornerShape(4.dp)),color=Ink,backgroundColor=Wash)
                val reset=w.optLong("resetsAt",0);Text(if(reset>0)"重置于 "+java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(java.util.Date(reset*1000)) else "重置时间暂无数据",fontSize=12.sp,color=Muted)
            }
        }
        val trend=data.optJSONArray("quotaTrend")
        val now=System.currentTimeMillis()
        val start=if(s.usageDays==1)java.util.Calendar.getInstance().apply{set(java.util.Calendar.HOUR_OF_DAY,0);set(java.util.Calendar.MINUTE,0);set(java.util.Calendar.SECOND,0);set(java.util.Calendar.MILLISECOND,0)}.timeInMillis else now-s.usageDays*86400000L
        val samples=(0 until (trend?.length()?:0)).mapNotNull{index->
            val item=trend!!.optJSONObject(index)?:return@mapNotNull null
            val at=item.optLong("at");val remaining=item.optDouble("remainingPercent",Double.NaN)
            if(at !in start..now||!remaining.isFinite())null else QuotaPoint(at,item.optInt("durationMins"),remaining.toFloat())
        }
        QuotaTrendChart(samples,start,now,s.usageDays)
        if(quota?.optBoolean("stale")==true){val captured=runCatching{java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(java.util.Date.from(java.time.Instant.parse(quota.optString("updatedAt"))))}.getOrNull();Text("实时额度暂不可用"+(captured?.let{"，显示 $it 的记录"}?:""),color=Muted,fontSize=12.sp)}
        if(s.threadId.isNotBlank()||data.optJSONObject("tokens")!=null){
            Divider(Modifier.padding(vertical=16.dp));Text("当前会话 Token",fontSize=14.sp,fontWeight=FontWeight.Medium)
            val tokens=data.optJSONObject("tokens")
            if(tokens==null)Text("当前会话暂无 Token 记录",color=Muted,fontSize=14.sp,modifier=Modifier.padding(vertical=16.dp))
            else {
                listOf("total" to "总量","input" to "输入","cached" to "缓存输入","output" to "输出","reasoning" to "推理输出","last" to "最近一次请求","contextWindow" to "上下文上限").chunked(2).forEach{row->
                    Row(Modifier.fillMaxWidth().padding(vertical=12.dp)){row.forEach{(key,label)->Column(Modifier.weight(1f)){Text(label,fontSize=12.sp,color=Muted);Text(if(tokens.isNull(key))"—" else java.text.NumberFormat.getIntegerInstance().format(tokens.optLong(key)),fontSize=20.sp,fontWeight=FontWeight.Medium)}}}
                }
                Text("缓存包含在输入中，推理包含在输出中。",fontSize=12.sp,color=Muted)
            }
        }
    }
    TextButton(onClick={vm.loadUsage()},enabled=s.connected&&!s.usageLoading,modifier=Modifier.fillMaxWidth().padding(top=12.dp)){ModernIcon(R.drawable.ic_lucide_rotate_cw,null,Modifier.size(18.dp));Text("刷新",Modifier.padding(start=8.dp))}
}
@Composable private fun NativeWorkbench(vm:NativeViewModel){
    val s=vm.state
    var section by remember{mutableStateOf("概览")}
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom=16.dp),horizontalArrangement=Arrangement.spacedBy(7.dp)){
        listOf("概览","用量与配额","工具","改动").forEach{label->
            val selected=section==label
            Box(Modifier.clip(RoundedCornerShape(17.dp)).background(if(selected)Ink else Wash).clickable{section=label}.padding(horizontal=14.dp,vertical=9.dp)){
                Text(label,fontSize=13.sp,color=if(selected)MaterialTheme.colors.surface else Ink)
            }
        }
    }
    when(section){
        "概览"->{
            Text("当前会话",fontSize=15.sp,fontWeight=FontWeight.SemiBold)
            val tools=s.events.count{it.type=="tool.started"}
            val changes=s.events.count{it.type=="file.changed"||it.type=="diff.updated"}
            val messages=s.events.count{it.type=="user.message"}
            listOf("状态" to if(s.running)"执行中" else "空闲","消息" to "$messages","工具调用" to "$tools","文件改动" to "$changes").forEach{(label,value)->
                Row(Modifier.fillMaxWidth().padding(vertical=10.dp),verticalAlignment=Alignment.CenterVertically){Text(label,Modifier.weight(1f),color=Muted,fontSize=13.sp);Text(value,fontSize=15.sp,fontWeight=FontWeight.Medium)}
            }
            Text("统计范围：当前会话已载入的记录",fontSize=12.sp,color=Muted)
        }
        "用量与配额"->NativeUsage(vm)
        "工具"->{
            val tools=s.events.filter{it.type=="tool.started"}.takeLast(30).asReversed()
            if(tools.isEmpty())Text("当前会话暂无工具调用",fontSize=13.sp,color=Muted)
            else tools.forEach{event->Text(event.title.ifBlank{event.detail.ifBlank{"工具调用"}},Modifier.fillMaxWidth().padding(vertical=8.dp),fontSize=13.sp,maxLines=2,overflow=TextOverflow.Ellipsis)}
        }
        "改动"->{
            val changes=s.events.filter{it.type=="file.changed"||it.type=="diff.updated"}.takeLast(20).asReversed()
            if(changes.isEmpty())Text("当前会话暂无文件改动记录",fontSize=13.sp,color=Muted)
            else changes.forEach{event->Text(event.files.takeIf{it.isNotEmpty()}?.joinToString("、")?:event.detail.ifBlank{"文件改动"},Modifier.fillMaxWidth().padding(vertical=8.dp),fontSize=13.sp,maxLines=3,overflow=TextOverflow.Ellipsis)}
        }
    }
}
private data class QuotaPoint(val at:Long,val durationMins:Int,val remaining:Float)
@Composable private fun QuotaTrendChart(points:List<QuotaPoint>,start:Long,end:Long,days:Int){
    val purple=Color(0xff9382ed);val cyan=Color(0xff55c8e5);val guide=Muted.copy(alpha=0.20f)
    Text("配额剩余趋势",Modifier.padding(top=18.dp,bottom=9.dp),fontSize=15.sp,fontWeight=FontWeight.Medium)
    Row(horizontalArrangement=Arrangement.spacedBy(16.dp)){
        listOf(300 to ("5 小时额度剩余" to purple),10080 to ("1 周额度剩余" to cyan)).forEach{(_,pair)->
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
                Box(Modifier.size(8.dp).clip(CircleShape).background(pair.second));Text(pair.first,fontSize=11.sp,color=Muted)
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(top=14.dp),verticalAlignment=Alignment.CenterVertically){
        Column(Modifier.width(38.dp).height(152.dp),verticalArrangement=Arrangement.SpaceBetween){
            listOf("100%","75%","50%","25%","0%").forEach{Text(it,fontSize=10.sp,color=Muted)}
        }
        Canvas(Modifier.weight(1f).height(152.dp)){
            val width=size.width;val height=size.height;val span=(end-start).coerceAtLeast(1L).toFloat()
            for(percent in listOf(0f,25f,50f,75f,100f)){
                val y=height*(1f-percent/100f)
                drawLine(guide,Offset(0f,y),Offset(width,y),strokeWidth=1.dp.toPx())
            }
            for((duration,color) in listOf(300 to purple,10080 to cyan)){
                val series=points.filter{it.durationMins==duration}.sortedBy{it.at}
                val path=Path();var previous:Long?=null
                for(point in series){
                    val x=((point.at-start)/span).coerceIn(0f,1f)*width
                    val y=(1f-point.remaining.coerceIn(0f,100f)/100f)*height
                    if(previous!=null&&point.at-previous<=30*60000L)path.lineTo(x,y) else path.moveTo(x,y)
                    previous=point.at
                }
                drawPath(path,color,style=Stroke(width=2.5.dp.toPx()))
                series.lastOrNull()?.let{last->drawCircle(color,3.5.dp.toPx(),Offset(((last.at-start)/span).coerceIn(0f,1f)*width,(1f-last.remaining.coerceIn(0f,100f)/100f)*height))}
            }
        }
    }
    val tickFormat=java.text.SimpleDateFormat(if(days==1)"HH:mm" else "M/d",java.util.Locale.getDefault())
    Row(Modifier.fillMaxWidth().padding(start=38.dp,top=5.dp),horizontalArrangement=Arrangement.SpaceBetween){
        (0..3).forEach{tick->Text(tickFormat.format(java.util.Date(start+(end-start)*tick/3)),fontSize=10.sp,color=Muted)}
    }
    val shortCount=points.count{it.durationMins==300};val weekCount=points.count{it.durationMins==10080}
    Text("5 小时 ${if(shortCount==0)"暂无数据" else "$shortCount 个采样"} · 1 周 ${if(weekCount==0)"暂无数据" else "$weekCount 个采样"}",Modifier.padding(top=9.dp),fontSize=11.sp,color=Muted)
}
private data class NativeActivityItem(val key:String,val title:String,val detail:String,val type:String,val status:String)
internal fun nativeActivityLabel(value:String):String = value.trim().lineSequence().firstOrNull().orEmpty().trim()
    .replace(Regex("^#{1,6}\\s+"),"")
    .removeSurrounding("**").removeSurrounding("__").removeSurrounding("`").trim()
private fun nativeActivityItems(events:List<ChatEvent>):List<NativeActivityItem>{
    val result=mutableListOf<NativeActivityItem>()
    val tools=mutableMapOf<String,Int>()
    val summaries=mutableMapOf<String,Int>()
    events.forEachIndexed{index,event->
        if(event.type=="reasoning.summary"){
            val detail=event.text.ifBlank{event.detail}.trim()
            val title=nativeActivityLabel(detail).ifBlank{"思考摘要"}
            val key=title.lowercase()
            val old=summaries[key]
            if(old==null){summaries[key]=result.size;result.add(NativeActivityItem("reasoning:$index",title,detail,event.type,event.status))}
            else if(detail.length>result[old].detail.length)result[old]=result[old].copy(detail=detail,status=event.status)
            return@forEachIndexed
        }
        if(event.type in setOf("file.changed","diff.updated","plan.updated","context.compaction")){
            val title=when(event.type){"file.changed"->"编辑文件";"diff.updated"->"查看改动";"plan.updated"->"更新计划";else->"压缩上下文"}
            val detail=when(event.type){"file.changed"->event.files.joinToString("\n").ifBlank{event.detail};"diff.updated"->event.diff;else->event.text.ifBlank{event.detail}}
            val key="${event.type}:${if(event.type=="plan.updated")"current" else event.itemId.ifBlank{event.eventId.ifBlank{index.toString()}}}"
            val old=result.indexOfLast{it.key==key}
            if(old>=0)result[old]=result[old].copy(detail=detail.ifBlank{result[old].detail},status=event.status)
            else result.add(NativeActivityItem(key,title,detail,event.type,event.status))
            return@forEachIndexed
        }
        val key=event.itemId.ifBlank{event.commandId.ifBlank{event.eventId.ifBlank{"tool:$index"}}}
        val detail=event.command.ifBlank{event.text.ifBlank{event.detail}}
        val title=event.title.takeUnless{it.isBlank()||it in setOf("exec","输出","执行完成")}?:"运行命令"
        val visibleTitle=when{
            title.contains("view_image",true)||title.contains("imageView",true)->"查看图片"
            title.contains("apply_patch",true)||title.contains("edit_file",true)||title.contains("write_file",true)||title=="fileChange"->"编辑文件"
            else->nativeActivityLabel(title)
        }
        val old=tools[key]
        if(old==null){tools[key]=result.size;result.add(NativeActivityItem(key,visibleTitle,detail,event.type,event.status))}
        else {
            val previous=result[old]
            val combined=if(detail.isBlank()||previous.detail.contains(detail))previous.detail else listOf(previous.detail,detail).filter{it.isNotBlank()}.joinToString("\n")
            result[old]=previous.copy(title=if(previous.title=="运行命令")visibleTitle else previous.title,detail=combined,status=if(event.type=="tool.completed")event.status else previous.status)
        }
    }
    return result
}
@Composable private fun NativeToolGroup(block:NativeBlock){
    var expanded by remember(block.key){mutableStateOf(false)}
    val entries=remember(block.activities){nativeActivityItems(block.activities)}
    val count=entries.count{it.type!="reasoning.summary"}
    val failed=entries.any{it.status=="error"}
    val completed=block.activities.lastOrNull{it.type.startsWith("tool.")}?.type=="tool.completed"
    Column(Modifier.fillMaxWidth()){
        Row(Modifier.fillMaxWidth().heightIn(min=36.dp).clip(RoundedCornerShape(12.dp)).clickable{expanded=!expanded}.padding(horizontal=6.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically){
            Icon(if(failed)Icons.Rounded.ErrorOutline else if(completed)Icons.Rounded.CheckCircleOutline else Icons.Rounded.Timelapse,null,tint=Muted,modifier=Modifier.size(17.dp))
            Text("处理过程${if(count>0)" · $count 项" else ""}",Modifier.weight(1f).padding(start=9.dp),fontSize=13.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
            Icon(if(expanded)Icons.Rounded.KeyboardArrowDown else Icons.Rounded.ChevronRight,null,tint=Muted,modifier=Modifier.size(17.dp))
        }
        AnimatedVisibility(expanded){Surface(Modifier.fillMaxWidth().padding(start=26.dp,end=4.dp,top=2.dp,bottom=4.dp),shape=RoundedCornerShape(14.dp),color=Wash){Column(Modifier.padding(10.dp),verticalArrangement=Arrangement.spacedBy(2.dp)){
            entries.forEach{entry->NativeActivityDetail(entry)}
        }}}
    }
}
@Composable private fun NativeActivityDetail(entry:NativeActivityItem){
    var detailOpen by remember(entry.key){mutableStateOf(false)}
    val detail=if(entry.type=="reasoning.summary"&&nativeActivityLabel(entry.detail)==entry.title)entry.detail.lineSequence().drop(1).joinToString("\n").trim() else entry.detail
    Column{
        Row(Modifier.fillMaxWidth().heightIn(min=34.dp).clip(RoundedCornerShape(10.dp)).clickable(enabled=detail.isNotBlank()){detailOpen=!detailOpen}.padding(horizontal=6.dp,vertical=5.dp),verticalAlignment=Alignment.CenterVertically){
            Icon(when(entry.type){"reasoning.summary"->Icons.Outlined.Lightbulb;"file.changed","diff.updated"->Icons.Outlined.EditNote;"context.compaction"->Icons.Outlined.Compress;else->if(entry.status=="error")Icons.Outlined.ErrorOutline else Icons.Outlined.Terminal},null,tint=Muted,modifier=Modifier.size(16.dp))
            Text(entry.title,Modifier.weight(1f).padding(start=8.dp),fontSize=13.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
            if(detail.isNotBlank())Icon(if(detailOpen)Icons.Outlined.ExpandLess else Icons.Outlined.ChevronRight,null,tint=Muted,modifier=Modifier.size(16.dp))
        }
        AnimatedVisibility(detailOpen&&detail.isNotBlank()){Box(Modifier.fillMaxWidth().padding(start=28.dp,end=6.dp,bottom=8.dp).heightIn(max=180.dp).verticalScroll(rememberScrollState())){
            if(entry.type in setOf("reasoning.summary","plan.updated"))NativeMarkdown(detail) else SelectionContainer{Text(detail,fontFamily=FontFamily.Monospace,fontSize=12.sp,lineHeight=18.sp,color=Muted)}
        }}
    }
}
@Composable private fun NativeRichText(vm:NativeViewModel,text:String){
    val matches=remember(text){Regex("!\\[([^]]*)\\]\\(<?([^\\n)]+?)>?\\)").findAll(text).toList()}
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
        var start=0
        matches.forEach{match->
            if(match.range.first>start)NativeDocument(text.substring(start,match.range.first),vm::openOutput)
            val href=match.groupValues[2]
            val endpoint=runCatching{nativeFileEndpoint(vm.state,href)}.getOrNull()
            if(endpoint!=null)NativeImageView(vm,endpoint,Modifier.fillMaxWidth().height(220.dp))
            else TextButton(onClick={vm.openOutput(href)}){Text(match.groupValues[1].ifBlank{"打开图片"})}
            start=match.range.last+1
        }
        if(start<text.length)NativeDocument(text.substring(start),vm::openOutput)
    }
}
@Composable private fun NativeDocument(text:String,open:(String)->Unit){
    val parts=remember(text){nativeDocumentParts(text)}
    val clipboard=LocalClipboardManager.current
    Column(verticalArrangement=Arrangement.spacedBy(14.dp)){
        parts.forEach{part->when(part.kind){
            "code"->Surface(color=Wash,shape=RoundedCornerShape(16.dp),modifier=Modifier.fillMaxWidth()){
                Column{
                    Row(Modifier.padding(start=14.dp,end=4.dp),verticalAlignment=Alignment.CenterVertically){Text(part.language.ifBlank{"代码"},fontSize=12.sp,color=Muted,modifier=Modifier.weight(1f));var copied by remember(part.text){mutableStateOf(false)};IconButton(onClick={clipboard.setText(AnnotatedString(part.text));copied=true}){Icon(if(copied)Icons.Outlined.Check else Icons.Outlined.ContentCopy,"复制代码",tint=Muted,modifier=Modifier.size(17.dp))}}
                    SelectionContainer{Text(part.text,fontSize=13.sp,lineHeight=21.sp,fontFamily=FontFamily.Monospace,color=Ink,softWrap=false,modifier=Modifier.horizontalScroll(rememberScrollState()).padding(start=14.dp,end=14.dp,bottom=16.dp))}
                }
            }
            "math","table"->NativeWideMarkdown(part.text,part.kind=="table",open)
            else->NativeMarkdown(part.text,open)
        }}
    }
}
@Composable private fun NativeWideMarkdown(text:String,table:Boolean,open:(String)->Unit){
    val context=LocalContext.current
    val ink=Ink.toArgb();val wash=Wash.toArgb();val surface=MaterialTheme.colors.surface.toArgb()
    val markwon=remember(ink,wash,surface,open){nativeMarkwon(context,open,ink,wash,surface)}
    AndroidView(factory={android.widget.HorizontalScrollView(it).apply{
        isFillViewport=true;isHorizontalScrollBarEnabled=true
        addView(TextView(it).apply{setTextColor(android.graphics.Color.rgb(32,33,36));textSize=16f;setTextIsSelectable(true);setPadding(0,12,0,16)},android.widget.FrameLayout.LayoutParams(-2,-2))
    }},modifier=Modifier.fillMaxWidth(),update={scroll->val view=scroll.getChildAt(0) as TextView;view.minWidth=if(table)(520*context.resources.displayMetrics.density).toInt() else 0;view.setTextColor(ink);if(view.tag!=Pair(text,ink)){markwon.setMarkdown(view,nativeMathMarkdown(text));view.tag=Pair(text,ink)};view.movementMethod=android.text.method.LinkMovementMethod.getInstance()})
}
private fun nativeMarkwon(context:android.content.Context,open:((String)->Unit)?,ink:Int,wash:Int,surface:Int):Markwon=Markwon.builder(context)
    .usePlugin(object:io.noties.markwon.AbstractMarkwonPlugin(){
        override fun configureConfiguration(builder:io.noties.markwon.MarkwonConfiguration.Builder){if(open!=null)builder.linkResolver { _,link -> open(link) }}
        override fun configureTheme(builder:io.noties.markwon.core.MarkwonTheme.Builder){builder.headingBreakHeight(0).headingTextSizeMultipliers(floatArrayOf(1.5f,1.25f,1.12f,1.05f,1f,1f)).linkColor(android.graphics.Color.rgb(45,96,156)).codeBackgroundColor(wash)}
    })
    .usePlugin(TablePlugin.create{it.tableBorderColor(android.graphics.Color.rgb(224,227,230)).tableBorderWidth(1).tableCellPadding((10*context.resources.displayMetrics.density).toInt()).tableHeaderRowBackgroundColor(wash).tableEvenRowBackgroundColor(surface).tableOddRowBackgroundColor(surface)})
    .usePlugin(MarkwonInlineParserPlugin.create())
    .usePlugin(JLatexMathPlugin.create(16f*context.resources.displayMetrics.scaledDensity){it.inlinesEnabled(true);it.theme().textColor(ink)}).build()
@Composable private fun NativeMarkdown(text:String,open:((String)->Unit)?=null){
    val context=LocalContext.current
    val ink=Ink.toArgb();val wash=Wash.toArgb();val surface=MaterialTheme.colors.surface.toArgb()
    val markwon=remember(ink,wash,surface,open){nativeMarkwon(context,open,ink,wash,surface)}
    AndroidView(factory={TextView(it).apply{setTextColor(android.graphics.Color.rgb(36,36,36));textSize=16f;setLineSpacing(2f,1.12f);setTextIsSelectable(true)}},modifier=Modifier.fillMaxWidth(),update={it.setTextColor(ink);if(it.tag!=Pair(text,ink)){markwon.setMarkdown(it,nativeMathMarkdown(text));it.tag=Pair(text,ink)};it.movementMethod=android.text.method.LinkMovementMethod.getInstance()})
}
@Composable private fun NativeMarkdownPreview(vm:NativeViewModel,document:NativeMarkdownFile,close:()->Unit){
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    var source by remember(document.sourcePath){mutableStateOf(false)}
    var saving by remember{mutableStateOf(false)}
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")){uri->
        if(uri!=null){saving=true;scope.launch{
            val result=runCatching{withContext(Dispatchers.IO){context.contentResolver.openOutputStream(uri)?.use{it.write(document.content.toByteArray(Charsets.UTF_8))}?:error("无法写入文件")}}
            saving=false
            android.widget.Toast.makeText(context,if(result.isSuccess)"Markdown 已保存" else "保存失败，请重试",android.widget.Toast.LENGTH_SHORT).show()
        }}
    }
    Dialog(onDismissRequest=close,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Column(Modifier.fillMaxSize().background(MaterialTheme.colors.background)){
            Row(Modifier.fillMaxWidth().height(58.dp).padding(horizontal=10.dp),verticalAlignment=Alignment.CenterVertically){
                ChromeButton(R.drawable.ic_lucide_x,"关闭阅读器",close)
                Text(document.name,Modifier.weight(1f).padding(start=6.dp),fontSize=16.sp,fontWeight=FontWeight.Medium,maxLines=1,overflow=TextOverflow.Ellipsis)
                TextButton(onClick={source=!source}){Text(if(source)"阅读" else "源码",fontSize=13.sp)}
                TextButton(enabled=!saving,onClick={save.launch(document.name)}){Text(if(saving)"保存中" else "保存",fontSize=13.sp)}
            }
            Divider(color=Ink.copy(alpha=0.08f))
            Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(horizontal=20.dp,vertical=18.dp)){
                if(source)SelectionContainer{Text(document.content,fontFamily=FontFamily.Monospace,fontSize=13.sp,lineHeight=20.sp)}
                else NativeMarkdown(document.content){href->
                    if(href.startsWith("#"))return@NativeMarkdown
                    val base=document.sourcePath.replace('\\','/').substringBeforeLast('/',"")
                    val absolute=href.startsWith("/")||href.startsWith("file://")||Regex("^[A-Za-z]:[/\\\\]").containsMatchIn(href)
                    val target=if(absolute||href.contains("://")||base.isBlank())href else "$base/$href"
                    vm.openOutput(target)
                }
            }
        }
    }
}
@Composable private fun NativeImageView(vm:NativeViewModel,endpoint:String,modifier:Modifier,thumbnail:Boolean=false){
    var bitmap by remember(endpoint){mutableStateOf<android.graphics.Bitmap?>(null)}
    var failure by remember(endpoint){mutableStateOf(false)}
    var preview by remember(endpoint){mutableStateOf(false)}
    var mime by remember(endpoint){mutableStateOf("image/png")}
    LaunchedEffect(endpoint){runCatching{withContext(Dispatchers.IO){vm.client?.nativeBytes(endpoint)?.let{bytes->
        val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true}
        BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
        mime=bounds.outMimeType?:"image/png"
        var sample=1
        while(bounds.outWidth/sample>2048||bounds.outHeight/sample>2048)sample*=2
        BitmapFactory.decodeByteArray(bytes,0,bytes.size,BitmapFactory.Options().apply{inSampleSize=sample})
    }}}.onSuccess{bitmap=it;failure=it==null}.onFailure{failure=true}}
    Box(modifier.clip(RoundedCornerShape(14.dp)).background(Wash).clickable(enabled=bitmap!=null){preview=true},contentAlignment=Alignment.Center){bitmap?.let{Image(it.asImageBitmap(),"图片",modifier=Modifier.fillMaxSize(),contentScale=if(thumbnail)ContentScale.Crop else ContentScale.Fit)}?:if(failure)Text("图片加载失败",fontSize=12.sp) else CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp)}
    if(preview)bitmap?.let{NativeImagePreview(it,vm,endpoint,mime){preview=false}}
}
@Composable private fun NativeImagePreview(bitmap:android.graphics.Bitmap,vm:NativeViewModel,endpoint:String,mime:String,close:()->Unit){
    val context=LocalContext.current;val scope=rememberCoroutineScope()
    var saving by remember{mutableStateOf(false)}
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(mime)){uri->if(uri!=null){saving=true;scope.launch{val result=runCatching{withContext(Dispatchers.IO){val bytes=vm.client?.nativeBytes(endpoint)?:error("连接已断开");context.contentResolver.openOutputStream(uri)?.use{it.write(bytes)}?:error("无法写入图片")}};withContext(Dispatchers.Main){saving=false;android.widget.Toast.makeText(context,if(result.isSuccess)"图片已保存" else "保存失败，请重试",android.widget.Toast.LENGTH_SHORT).show()}}}}
    var scale by remember{mutableStateOf(1f)}
    var pan by remember{mutableStateOf(Offset.Zero)}
    Dialog(onDismissRequest=close,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Box(Modifier.fillMaxSize().background(Color(0xff151617))){
            BoxWithConstraints(Modifier.fillMaxSize().clip(RoundedCornerShape(0.dp))){
                val density=LocalDensity.current
                val width=with(density){maxWidth.toPx()};val height=with(density){maxHeight.toPx()}
                Image(bitmap.asImageBitmap(),"图片预览",modifier=Modifier.fillMaxSize().semantics{stateDescription="${(scale*100).toInt()}%"}.pointerInput(width,height){detectTransformGestures{_,delta,zoom,_->
                    scale=(scale*zoom).coerceIn(1f,5f)
                    val x=width*(scale-1f)/2;val y=height*(scale-1f)/2
                    pan=Offset((pan.x+delta.x).coerceIn(-x,x),(pan.y+delta.y).coerceIn(-y,y))
                }}.graphicsLayer{scaleX=scale;scaleY=scale;translationX=pan.x;translationY=pan.y})
            }
            Row(Modifier.align(Alignment.TopEnd).padding(8.dp).background(Color(0xaa202124),RoundedCornerShape(24.dp))){
                IconButton(enabled=!saving,onClick={val ext=when(mime){"image/jpeg"->"jpg";"image/webp"->"webp";"image/gif"->"gif";else->"png"};save.launch("Codex-image.$ext")}){Icon(Icons.Outlined.Download,if(saving)"正在保存图片" else "保存图片",tint=Color.White)}
                IconButton(onClick={scale=(scale+1f).coerceAtMost(5f)}){Icon(Icons.Outlined.ZoomIn,"放大图片",tint=Color.White)}
                IconButton(onClick={scale=1f;pan=Offset.Zero}){Icon(Icons.Outlined.ZoomOutMap,"复位图片",tint=Color.White)}
                IconButton(onClick=close){Icon(Icons.Outlined.Close,"关闭图片预览",tint=Color.White)}
            }
        }
    }
}
@Composable private fun NativeWorkspace(vm:NativeViewModel,panel:String){
    val s=vm.state
    when(panel){
        "文件"->{if(s.file!=null){var text by remember(s.file?.path){mutableStateOf(s.file!!.content)};Text(s.file!!.path,fontSize=13.sp);Entry(text,{text=it},"");if(s.file!!.editable)Button(onClick={vm.saveFile(text)}){Text("保存")}}else{TextButton(onClick={vm.files(s.filePath.substringBeforeLast('/',""))}){Text("上一级")};s.files.forEach{f->TextButton(onClick={vm.readFile(f)}){ModernIcon(if(f.kind=="directory")R.drawable.ic_lucide_folder else R.drawable.ic_lucide_file_text,null,Modifier.size(19.dp));Text(f.name,Modifier.padding(8.dp))}}}}
        "改动"->NativeMarkdown("```diff\n${s.diff}\n```")
        "终端"->{NativeMarkdown("```\n${s.terminal}\n```");var command by remember{mutableStateOf("")};Entry(command,{command=it},"输入命令");Row{Button(onClick={vm.terminal(command+"\n");command=""}){Text("执行")};TextButton(onClick=vm::stopTerminal){Text("停止终端")}}}
    }
    if(s.workBusy)LinearProgressIndicator(Modifier.fillMaxWidth())
}

@Composable private fun NativeHarnessIcon(key:String,modifier:Modifier=Modifier,tint:Color=Ink){Icon(androidx.compose.ui.res.painterResource(when(key){"claude"->R.drawable.harness_claude;"antigravity"->R.drawable.harness_antigravity;"grok"->R.drawable.harness_grok;else->R.drawable.harness_codex}),null,modifier,tint=tint)}

@Composable private fun NativeQuestions(vm:NativeViewModel,event:ChatEvent){
    val questions=remember(event.detail){runCatching{val a=org.json.JSONObject(event.detail).getJSONArray("questions");(0 until a.length()).map{a.getJSONObject(it)}}.getOrDefault(emptyList())}
    var answers by remember(event.approvalId){mutableStateOf(mapOf<String,String>())}
    val resolved=event.approvalId in vm.state.approvals
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Wash).padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text(if(resolved)"问题已处理" else "需要你的回答",fontWeight=FontWeight.Medium)
        questions.forEach{q->val id=q.getString("id");Text(q.getString("question"),fontSize=16.sp)
            if(!resolved){val options=q.optJSONArray("options");if(options!=null)for(i in 0 until options.length()){val option=options.getJSONObject(i);val label=option.getString("label");OutlinedButton(onClick={answers=answers+(id to label)},modifier=Modifier.fillMaxWidth()){if(answers[id]==label)Icon(Icons.Outlined.Check,null,Modifier.size(18.dp));Column(Modifier.weight(1f)){Text(label);val description=option.optString("description");if(description.isNotBlank())Text(description,fontSize=12.sp,color=Muted)}}}
                BasicTextField(answers[id].orEmpty(),{answers=answers+(id to it)},modifier=Modifier.fillMaxWidth().background(MaterialTheme.colors.surface,RoundedCornerShape(10.dp)).padding(12.dp),textStyle=TextStyle(color=Ink,fontSize=16.sp),visualTransformation=if(q.optBoolean("isSecret"))androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,decorationBox={inner->if(answers[id].isNullOrEmpty())Text("输入你的回答",color=Muted);inner()})
            }
        }
        if(!resolved)Button(onClick={vm.answerQuestions(event.approvalId,answers)},enabled=!vm.state.workBusy&&questions.isNotEmpty()&&questions.all{!answers[it.getString("id")].isNullOrBlank()}){Text("提交回答")}
    }
}

@Composable private fun NativePairingSheet(vm:NativeViewModel,close:()->Unit){
    val context=LocalContext.current
    val state=vm.state
    var address by remember{mutableStateOf(state.address)}
    var publicUrl by remember{mutableStateOf(state.publicUrl)}
    var remotePassword by remember{mutableStateOf(state.remotePassword)}
    var certificate by remember{mutableStateOf(state.certificateSha256)}
    var code by remember{mutableStateOf("")}
    var scanError by remember{mutableStateOf("")}
    Sheet("连接电脑",close){
        OutlinedButton(onClick={
            scanError=""
            val scan=runCatching{
                com.google.mlkit.vision.codescanner.GmsBarcodeScanning.getClient(
                    context,
                    com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions.Builder()
                        .setBarcodeFormats(com.google.mlkit.vision.barcode.common.Barcode.FORMAT_QR_CODE)
                        .build()
                ).startScan()
            }
            scan.onFailure{scanError="无法启动扫码，请检查 Google Play 服务或手动输入配对码"}
            scan.getOrNull()?.addOnSuccessListener{result->
                val link=parseNativePairLink(result.rawValue.orEmpty())
                if(link==null)scanError="这不是有效的电脑配对码"
                else {
                    address=link.address
                    publicUrl=link.publicUrl
                    certificate=link.certificateSha256
                    code=link.code
                }
            }?.addOnFailureListener{scanError="扫码未完成，请重试或手动输入配对码"}
        },modifier=Modifier.fillMaxWidth()){
            Icon(Icons.Outlined.QrCodeScanner,null,Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("扫描电脑二维码")
        }
        if(scanError.isNotBlank())Text(scanError,fontSize=12.sp,color=MaterialTheme.colors.error)
        Spacer(Modifier.height(12.dp))
        Entry(address,{address=it},"内网 HTTPS 地址")
        Spacer(Modifier.height(10.dp))
        Entry(publicUrl,{publicUrl=it},"公网 HTTPS 地址（可选）")
        Spacer(Modifier.height(10.dp))
        Entry(remotePassword,{remotePassword=it},"公网独立密码")
        Spacer(Modifier.height(10.dp))
        Entry(certificate,{certificate=it},"本地证书 SHA-256 指纹")
        Spacer(Modifier.height(10.dp))
        Entry(code,{code=it},"配对码")
        Text("扫描后自动填入地址、证书和配对码；公网密码仍需单独填写。",fontSize=12.sp,color=Muted,modifier=Modifier.padding(vertical=12.dp))
        Button(onClick={
            vm.connect(address,code=code,publicUrl=publicUrl,remotePassword=remotePassword,certificateSha256=certificate)
            close()
        },enabled=address.isNotBlank()&&code.isNotBlank(),modifier=Modifier.fillMaxWidth()){
            Text("连接")
        }
    }
}
