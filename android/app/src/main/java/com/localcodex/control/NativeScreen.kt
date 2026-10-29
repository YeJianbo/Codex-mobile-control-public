@file:OptIn(androidx.compose.animation.ExperimentalAnimationApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
package com.localcodex.control
import com.localcodex.control.NativeThemeSurface as Surface
import com.localcodex.control.NativeInk as Ink
import com.localcodex.control.NativeMuted as Muted
import com.localcodex.control.NativeWash as Wash
import com.localcodex.control.NativeAccent as Accent
import com.localcodex.control.NativeGlassEdge as GlassEdge
import com.localcodex.control.NativeControlEase as ControlEase
import com.localcodex.control.nativeDisclosureEnter as disclosureEnter
import com.localcodex.control.nativeDisclosureExit as disclosureExit
import com.localcodex.control.nativeChevronMotion as chevronMotion
import com.localcodex.control.NativePrimaryButton as Button
import com.localcodex.control.NativeTextEntry as Entry

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.togetherWith
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateColor
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.updateTransition
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
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.FirstBaseline
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.withContext
import kotlin.math.roundToInt
import kotlin.math.min

private val sidebarModuleKeys=listOf("projects","goals","pinned","recent","agents")
@Composable internal fun PopupMenuRow(icon:Int,label:String,danger:Boolean=false,compact:Boolean=false,action:()->Unit){
    val color=if(danger)AppColor.Danger else Ink
    val feedback=rememberHaptics()
    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).clip(Radius.MenuItem).clickable{feedback.keyTap();action()}.padding(horizontal=if(compact)12.dp else 16.dp,vertical=if(compact)8.dp else 12.dp),verticalAlignment=Alignment.CenterVertically){ModernIcon(icon,null,Modifier.size(if(compact)18.dp else 20.dp),color);Text(label,Modifier.padding(start=if(compact)10.dp else 14.dp),fontSize=if(compact)14.sp else 15.sp,color=color)}
}
@Composable internal fun ModernToggle(checked:Boolean,enabled:Boolean=true,change:(Boolean)->Unit){
    val color=Accent
    val transition=updateTransition(checked,label="toggle")
    val track=transition.animateColor(transitionSpec={tween(160,easing=ControlEase)},label="toggleTrack"){if(it)color else Ink.copy(alpha=0.16f)}
    val thumb=transition.animateFloat(transitionSpec={spring(dampingRatio=1f,stiffness=1000f,visibilityThreshold=0.05f)},label="toggleThumb"){if(it)21f else 3f}
    val density=LocalDensity.current
    Box(Modifier.size(48.dp).semantics{stateDescription=if(checked)"开" else "关"}
        .toggleable(value=checked,enabled=enabled,role=Role.Switch,onValueChange=change),contentAlignment=Alignment.Center){
        Box(Modifier.size(46.dp,28.dp).graphicsLayer{alpha=if(enabled)1f else 0.38f}.clip(CircleShape)
            .drawBehind{drawRoundRect(track.value,cornerRadius=CornerRadius(size.height/2))}){
            Box(Modifier.size(22.dp).graphicsLayer{translationX=with(density){thumb.value.dp.toPx()};translationY=with(density){3.dp.toPx()}}.clip(CircleShape).background(Color.White))
        }
    }
}
@Composable internal fun ModernDropdown(expanded:Boolean,dismiss:()->Unit,width:Dp,scrollable:Boolean=true,edgeMargin:Dp=8.dp,placement:NativePopupPlacement=NativePopupPlacement.OVER_ANCHOR,modifier:Modifier=Modifier,content:@Composable ColumnScope.()->Unit){
    var mounted by remember{mutableStateOf(expanded)}
    var layoutReady by remember{mutableStateOf(false)}
    val visibility=remember{Animatable(0f)}
    val backdrop=LocalNativeOverlayBackdrop.current?:LocalNativeGlassBackdrop.current
    val parentMotion=LocalNativeGlassMotion.current
    val samplingMotion=remember(parentMotion){{parentMotion();visibility.value}}
    LaunchedEffect(expanded,backdrop){
        if(expanded){
            if(!mounted){layoutReady=false;mounted=true}
            snapshotFlow{layoutReady}.first{it}
            awaitNativeGlassBackdrop(backdrop)
            withFrameNanos{}
        }
        visibility.animateTo(if(expanded)1f else 0f,spring(dampingRatio=1f,stiffness=if(expanded)1000f else 1400f,visibilityThreshold=0.01f))
        if(!expanded){mounted=false;layoutReady=false}
    }
    if(!mounted)return
    BackHandler(expanded){dismiss()}
    val maxHeight=minOf(420.dp,LocalConfiguration.current.screenHeightDp.dp*0.62f)
    val contentWidth=minOf(width,(LocalConfiguration.current.screenWidthDp.dp-edgeMargin*2-12.dp).coerceAtLeast(1.dp))
    val margin=with(LocalDensity.current){edgeMargin.roundToPx()}
    val origin=remember{mutableStateOf(TransformOrigin.Center)}
    val positioner=remember(margin,placement){object:PopupPositionProvider{
        override fun calculatePosition(anchorBounds:IntRect,windowSize:IntSize,layoutDirection:LayoutDirection,popupContentSize:IntSize):IntOffset{
            val position=nativePopupPlacement(anchorBounds,windowSize,popupContentSize,margin,placement)
            origin.value=position.second
            return position.first
        }
    }}
    // 非聚焦弹窗：打开菜单不再抢走输入框焦点（否则键盘先收、菜单关闭后又弹出）。
    // 键盘事件仍由宿主处理，返回键经 BackHandler(expanded) 关闭菜单。
    Popup(onDismissRequest={if(expanded)dismiss()},popupPositionProvider=positioner,properties=PopupProperties(focusable=false,dismissOnClickOutside=true)){
        CompositionLocalProvider(LocalNativeGlassBackdrop provides backdrop,LocalNativeGlassMotion provides samplingMotion){
        NativeGlassSurface(shape=Radius.Panel,kind=NativeGlassKind.MENU,elevation=0.dp,border=BorderStroke(1.dp,GlassEdge),color=MaterialTheme.colors.surface,modifier=modifier.padding(6.dp).width(contentWidth).graphicsLayer{transformOrigin=origin.value;alpha=visibility.value;scaleX=0.95f+0.05f*visibility.value;scaleY=scaleX}){
            Column(Modifier.testTag("modernDropdown").onSizeChanged{if(it.width>0&&it.height>0)layoutReady=true}.heightIn(max=maxHeight).then(if(scrollable)Modifier.verticalScroll(rememberScrollState()) else Modifier),content=content)
        }
        }
    }
}
@Composable private fun NativeSlashCommandPopup(commands:List<NativeCommand>,select:(String)->Unit){
    if(commands.isEmpty())return
    val backdrop=LocalNativeOverlayBackdrop.current?:LocalNativeGlassBackdrop.current
    val density=LocalDensity.current
    val margin=with(density){6.dp.roundToPx()}
    val width=minOf(LocalConfiguration.current.screenWidthDp.dp-24.dp,480.dp)
    val positioner=remember(margin){object:PopupPositionProvider{
        override fun calculatePosition(anchorBounds:IntRect,windowSize:IntSize,layoutDirection:LayoutDirection,popupContentSize:IntSize):IntOffset{
            val x=(anchorBounds.left+(anchorBounds.width-popupContentSize.width)/2).coerceIn(0,(windowSize.width-popupContentSize.width).coerceAtLeast(0))
            return IntOffset(x,(anchorBounds.top-popupContentSize.height-margin).coerceAtLeast(0))
        }
    }}
    Popup(onDismissRequest={},popupPositionProvider=positioner,properties=PopupProperties(focusable=false,dismissOnClickOutside=false,dismissOnBackPress=false)){
        CompositionLocalProvider(LocalNativeGlassBackdrop provides backdrop){
        NativeGlassSurface(shape=Radius.Panel,kind=NativeGlassKind.MENU,color=MaterialTheme.colors.surface,border=BorderStroke(1.dp,GlassEdge),elevation=0.dp,modifier=Modifier.padding(6.dp).width(width)){
            Column(Modifier.testTag("slashCommands").heightIn(max=220.dp).verticalScroll(rememberScrollState()).padding(4.dp)){
                commands.forEach{command->NativeCommandRow(command){select(command.name)}}
            }
        }
        }
    }
}
private fun nativeCommandIcon(name:String)=when(name){
    "new"->R.drawable.ic_lucide_square_pen
    "help"->R.drawable.ic_lucide_circle_question_mark
    "status"->R.drawable.ic_lucide_gauge
    "usage"->R.drawable.ic_lucide_chart_spline
    "model"->R.drawable.ic_lucide_bot
    "effort"->R.drawable.ic_lucide_brain
    "permissions"->R.drawable.ic_lucide_shield_check
    "goal"->R.drawable.ic_lucide_target
    "plan"->R.drawable.ic_lucide_list_todo
    "pin"->R.drawable.ic_lucide_pin
    "compact"->R.drawable.ic_lucide_minimize_2
    "fast"->R.drawable.ic_lucide_zap
    else->R.drawable.ic_lucide_terminal
}
@Composable private fun NativeCommandRow(command:NativeCommand,onClick:(()->Unit)?=null){
    val row=Modifier.fillMaxWidth().heightIn(min=42.dp).clip(Radius.MenuItem)
    Row(row.then(if(onClick!=null)Modifier.clickable(onClick=onClick) else Modifier).padding(horizontal=10.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically){
        ModernIcon(nativeCommandIcon(command.name),null,Modifier.size(16.dp),Muted)
        Text("/${command.name}",Modifier.padding(start=9.dp),fontSize=13.sp,fontFamily=FontFamily.Monospace,fontWeight=FontWeight.Medium,maxLines=1)
        Text(command.description,Modifier.weight(1f).padding(start=10.dp),fontSize=11.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
    }
}
@Composable internal fun EffortSlider(efforts:List<String>,current:String,change:(String)->Unit,compact:Boolean=false,showLabel:Boolean=true){
    val levels=remember(efforts){nativeOrderedEfforts(efforts)}
    if(levels.size<2)return
    var index by remember(levels){mutableIntStateOf(levels.indexOf(current).coerceAtLeast(0))}
    var position by remember(levels){mutableFloatStateOf(index.toFloat())}
    var dragging by remember{mutableStateOf(false)}
    var pressed by remember{mutableStateOf(false)}
    val onChange by rememberUpdatedState(change)
    val selected by rememberUpdatedState(current)
    LaunchedEffect(current,levels){if(!dragging){index=levels.indexOf(current).coerceAtLeast(0);position=index.toFloat()}}
    val displayed by animateFloatAsState(position,if(dragging)snap() else spring(dampingRatio=0.85f,stiffness=500f),label="effortPosition")
    val thumbScale by animateFloatAsState(if(pressed||dragging)1.12f else 1f,spring(dampingRatio=0.8f,stiffness=600f),label="effortPress")
    var width by remember{mutableFloatStateOf(1f)}
    val haptics=rememberHaptics()
    val trackColor=nativeEffortColor(levels[index],Accent)
    val ultra=levels[index]=="ultra"
    val ultraBrush=remember{Brush.horizontalGradient(AppColor.UltraTrack)}
    val surface=MaterialTheme.colors.surface
    val inactive=Wash
    val muted=Muted
    val edge=with(LocalDensity.current){(if(compact)17.dp else 19.dp).toPx()}
    fun move(x:Float){
        position=((x-edge)/(width-2f*edge).coerceAtLeast(1f)*levels.lastIndex).coerceIn(0f,levels.lastIndex.toFloat())
        val next=position.roundToInt()
        if(next!=index)haptics.clockTick()
        index=next
    }
    Column{
    if(showLabel)Text("思考强度 · ${effortName(levels[index])}",modifier=Modifier.padding(start=if(compact)12.dp else 4.dp,top=if(compact)2.dp else 22.dp,bottom=if(compact)0.dp else 5.dp),fontSize=if(compact)12.sp else 13.sp,color=nativeEffortColor(levels[index],Muted))
    Canvas(Modifier.fillMaxWidth().padding(horizontal=if(compact)10.dp else 4.dp,vertical=8.dp).height(if(compact)34.dp else 38.dp).testTag("effortSlider").semantics{stateDescription=effortName(levels[index])}.onSizeChanged{width=it.width.toFloat()}
        .pointerInput(levels){detectTapGestures(onPress={pressed=true;try{tryAwaitRelease()}finally{pressed=false}},onTap={move(it.x);position=index.toFloat();onChange(levels[index])})}
        .pointerInput(levels){detectHorizontalDragGestures(
            onDragStart={dragging=true;move(it.x)},
            onDragEnd={dragging=false;position=index.toFloat();onChange(levels[index])},
            onDragCancel={dragging=false;index=levels.indexOf(selected).coerceAtLeast(0);position=index.toFloat()}
        ){pointer,_->move(pointer.position.x);pointer.consume()}}){
        val radius=size.height/2f
        val start=radius
        val end=size.width-radius
        val thumbX=start+(end-start)*displayed.coerceIn(0f,levels.lastIndex.toFloat())/levels.lastIndex
        drawRoundRect(inactive,cornerRadius=CornerRadius(radius),size=size)
        val filledSize=Size((thumbX+radius).coerceAtMost(size.width),size.height)
        if(ultra){
            drawRoundRect(ultraBrush,cornerRadius=CornerRadius(radius),size=filledSize)
            // Fixed glints keep the Ultra treatment inexpensive and stable while dragging.
            for(i in 0 until 14){
                val x=start+(end-start)*((i*37+11)%97)/100f
                val y=radius+radius*((i*23%61)-30)/50f
                if(x<thumbX-radius){
                    val glint=Color.White.copy(alpha=if(i%3==0).55f else .3f)
                    drawCircle(glint,radius=(if(i%3==0)1.3.dp else .8.dp).toPx(),center=Offset(x,y))
                    if(i%4==0){
                        val arm=2.dp.toPx()
                        drawLine(glint,Offset(x-arm,y),Offset(x+arm,y),strokeWidth=.7.dp.toPx())
                        drawLine(glint,Offset(x,y-arm),Offset(x,y+arm),strokeWidth=.7.dp.toPx())
                    }
                }
            }
        }else drawRoundRect(trackColor,cornerRadius=CornerRadius(radius),size=filledSize)
        if(!ultra)for(i in levels.indices){val x=start+(end-start)*i/levels.lastIndex;drawCircle(if(i<=index)surface.copy(alpha=0.28f) else muted.copy(alpha=0.28f),radius=(if(compact)2.dp else 3.dp).toPx(),center=Offset(x,radius))}
        val thumbRadius=(radius-3.dp.toPx())*thumbScale
        drawCircle(trackColor.copy(alpha=0.12f),radius=thumbRadius+2.dp.toPx(),center=Offset(thumbX,radius+1.dp.toPx()))
        drawCircle(surface,radius=thumbRadius,center=Offset(thumbX,radius))
        drawCircle(trackColor,radius=thumbRadius,center=Offset(thumbX,radius),style=Stroke(2.dp.toPx()))
    }
}
}
@Composable internal fun NativeModelControls(
    models:List<NativeModel>,model:NativeModel?,effort:String,fast:Boolean?,showFast:Boolean,fastEnabled:Boolean,
    showModels:Boolean,onShowModels:(Boolean)->Unit,onModel:(String)->Unit,onEffort:(String)->Unit,onFast:()->Unit,onSettings:(()->Unit)?
){
    val routeHints=remember(models){nativeModelRouteHints(models)}
    AnimatedContent(showModels,Modifier.padding(8.dp).testTag("modelControls"),transitionSpec={
        (fadeIn(tween(140,easing=ControlEase))+slideInHorizontally(tween(180,easing=ControlEase)){if(targetState)it/12 else -it/12})
            .togetherWith(fadeOut(tween(90,easing=ControlEase))+slideOutHorizontally(tween(140,easing=ControlEase)){if(targetState)-it/12 else it/12})
            .using(SizeTransform(clip=true){_,_->spring(dampingRatio=1f,stiffness=1000f)})
    },contentAlignment=Alignment.TopStart,label="modelMenuPage"){modelsVisible->Column{
        if(modelsVisible){
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                IconButton(onClick={onShowModels(false)},modifier=Modifier.size(48.dp)){ModernIcon(R.drawable.ic_lucide_arrow_left,"返回思考强度",Modifier.size(17.dp),Muted)}
                Text("选择模型",fontSize=13.sp,color=Muted)
            }
            Column(Modifier.heightIn(max=240.dp).verticalScroll(rememberScrollState()).testTag("modelList")){
                nativeModelGroups(models).forEach{group->
                    if(group.name.isNotBlank())Text(group.name,Modifier.fillMaxWidth().padding(horizontal=12.dp,vertical=8.dp).testTag("modelProvider:${group.id}"),fontSize=11.sp,fontWeight=FontWeight.Medium,color=Muted)
                    group.models.forEach{item->
                    Row(Modifier.fillMaxWidth().clip(Radius.MenuItem).background(if(item.id==model?.id)Wash else Color.Transparent).clickable{onModel(item.id)}.padding(horizontal=12.dp,vertical=11.dp),verticalAlignment=Alignment.CenterVertically){
                        Column(Modifier.weight(1f)){
                            Text(nativeModelDisplayName(item),fontSize=14.sp,color=Ink,maxLines=1,overflow=TextOverflow.Ellipsis)
                            routeHints[item.id]?.let{Text(it,Modifier.padding(top=3.dp),fontSize=11.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)}
                        }
                        if(item.id==model?.id)ModernIcon(R.drawable.ic_lucide_check,null,Modifier.size(16.dp),Accent)
                    }
                    }
                }
            }
        }else{
            Row(Modifier.fillMaxWidth().heightIn(min=44.dp),verticalAlignment=Alignment.CenterVertically){
                Box(Modifier.width(48.dp),contentAlignment=Alignment.Center){
                    if(showFast){
                        val enabledFast=fast==true
                        IconToggleButton(checked=enabledFast,onCheckedChange={onFast()},enabled=fastEnabled,
                            modifier=Modifier.size(40.dp).semantics{contentDescription=if(enabledFast)"Fast 已开启" else "Fast 已关闭"}.testTag("fastToggle")){
                            Box(Modifier.size(28.dp).clip(Radius.MenuItem).background(if(enabledFast)Accent else Wash),contentAlignment=Alignment.Center){
                                ModernIcon(R.drawable.ic_lucide_zap,null,Modifier.size(16.dp),if(enabledFast)Color.White else Muted)
                            }
                        }
                    }
                }
                Column(Modifier.weight(1f).clip(Radius.Button).clickable{onShowModels(true)}.padding(vertical=4.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(1.dp)){
                    if(effort=="max"||effort=="ultra")NativeEffortBadge(effort,Modifier.testTag("selectedEffort"))
                    else Text(effortName(effort).ifBlank{"思考强度"},Modifier.testTag("selectedEffort"),fontSize=13.sp,lineHeight=15.sp,style=TextStyle(platformStyle=PlatformTextStyle(includeFontPadding=false)),fontWeight=FontWeight.SemiBold,color=Accent)
                    Row(Modifier.padding(horizontal=3.dp),verticalAlignment=Alignment.CenterVertically){
                        Text(model?.let(::nativeModelDisplayName)?:"选择模型",Modifier.weight(1f,false),fontSize=11.sp,lineHeight=13.sp,style=TextStyle(platformStyle=PlatformTextStyle(includeFontPadding=false)),color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
                        ModernIcon(R.drawable.ic_lucide_chevron_right,null,Modifier.size(12.dp),Muted)
                    }
                }
                Box(Modifier.width(48.dp),contentAlignment=Alignment.Center){
                    IconButton(onClick={model?.defaultEffort?.let(onEffort)},enabled=model!=null&&effort!=model.defaultEffort,modifier=Modifier.size(48.dp)){
                        ModernIcon(R.drawable.ic_lucide_rotate_cw,"恢复默认思考强度",Modifier.size(14.dp),Muted)
                    }
                }
            }
            EffortSlider(model?.efforts.orEmpty(),effort,onEffort,compact=true,showLabel=false)
            if(onSettings!=null){
            Divider(Modifier.padding(top=3.dp,bottom=2.dp),color=Ink.copy(alpha=0.06f))
            Row(Modifier.fillMaxWidth().height(34.dp).clip(Radius.Button).clickable(onClick=onSettings).padding(horizontal=10.dp),verticalAlignment=Alignment.CenterVertically){
                ModernIcon(R.drawable.ic_lucide_sliders_horizontal,null,Modifier.size(15.dp),Muted)
                Text("权限与更多设置",Modifier.padding(start=7.dp),fontSize=12.sp,color=Muted)
            }
            }
        }
    }}
}
@Composable internal fun NativeSubmissionNotice(message:String,check:()->Unit,dismiss:()->Unit,clear:()->Unit){
    NativeNoticeSurface(AppColor.StatusWarning,Modifier.fillMaxWidth().padding(horizontal=12.dp).testTag("submissionNotice")){
    Row(Modifier.fillMaxWidth().padding(start=12.dp),verticalAlignment=Alignment.CenterVertically){
        Text(message,Modifier.weight(1f),fontSize=12.sp,color=Muted,maxLines=2,overflow=TextOverflow.Ellipsis)
        TextButton(onClick=check,contentPadding=PaddingValues(horizontal=7.dp)){Text("检查",fontSize=12.sp)}
        TextButton(onClick=clear,contentPadding=PaddingValues(horizontal=7.dp)){Text("清除待发",fontSize=12.sp)}
        IconButton(onClick=dismiss,modifier=Modifier.size(48.dp)){ModernIcon(R.drawable.ic_lucide_x,"关闭提交提示",Modifier.size(16.dp),Muted)}
    }
    }
}
@Composable private fun ActionRow(icon:Int,label:String,danger:Boolean=false,modifier:Modifier=Modifier,action:()->Unit){
    val color=if(danger)AppColor.Danger else Ink
    Row(modifier.fillMaxWidth().clip(Radius.Button).clickable(onClick=action).padding(vertical=7.dp,horizontal=8.dp),verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(38.dp).clip(Radius.MenuItem).background(Wash),contentAlignment=Alignment.Center){ModernIcon(icon,null,Modifier.size(19.dp),color)};Text(label,color=color,fontSize=15.sp,modifier=Modifier.padding(start=12.dp))}
}
@Composable internal fun Sheet(title:String,close:()->Unit,stableHeight:Boolean=false,inPlace:Boolean=false,dismissEnabled:Boolean=true,bodyScrollState:ScrollState?=rememberScrollState(),onBack:(()->Boolean)?=null,onEntered:()->Unit={},contentHorizontalPadding:androidx.compose.ui.unit.Dp=20.dp,titleContent:(@Composable ()->Unit)?=null,bodyPadding:PaddingValues=PaddingValues(top=8.dp,bottom=24.dp),body:@Composable ColumnScope.()->Unit){
    val height=LocalConfiguration.current.screenHeightDp.dp*0.85f
    val density=LocalDensity.current
    val bottomGap=with(density){16.dp.toPx()}
    val scope=rememberCoroutineScope()
    val onClose by rememberUpdatedState(close)
    val readyAction by rememberUpdatedState(onEntered)
    val backAction by rememberUpdatedState(onBack)
    val canDismiss by rememberUpdatedState(dismissEnabled)
    var panelHeight by remember{mutableIntStateOf(0)}
    var offset by remember{mutableFloatStateOf(with(density){height.toPx()}+bottomGap)}
    val backdrop=LocalNativeOverlayBackdrop.current?:LocalNativeGlassBackdrop.current
    val overlayScene=rememberNativeGlassBackdrop(LocalNativeGlassMode.current)
    val parentMotion=LocalNativeGlassMotion.current
    val samplingMotion=remember(parentMotion){{parentMotion();offset}}
    var entered by remember{mutableStateOf(false)}
    var closing by remember{mutableStateOf(false)}
    var motionJob by remember{mutableStateOf<kotlinx.coroutines.Job?>(null)}
    var animating by remember{mutableStateOf(false)}
    var motionVelocity by remember{mutableFloatStateOf(0f)}
    var entranceReady by remember{mutableStateOf(false)}
    fun revealContent(){if(!entranceReady&&!closing){entranceReady=true;readyAction()}}
    fun moveTo(target:Float,velocity:Float=motionVelocity,entering:Boolean=false,finished:()->Unit={}){
        motionJob?.cancel()
        val animation=scope.launch(start=kotlinx.coroutines.CoroutineStart.LAZY){
            try{
                animate(offset,target,initialVelocity=velocity,animationSpec=if(entering)tween(240,easing=ControlEase)else spring(dampingRatio=1f,stiffness=if(closing)1200f else 900f,visibilityThreshold=1f)){value,speed->offset=value.coerceAtLeast(0f);motionVelocity=speed}
                finished()
            }finally{if(motionJob===kotlinx.coroutines.currentCoroutineContext()[kotlinx.coroutines.Job]){motionJob=null;animating=false;motionVelocity=0f}}
        }
        motionJob=animation;animating=true;animation.start()
    }
    LaunchedEffect(backdrop){
        // Initial dialog measurement and async content can change height before
        // the first frame. They must not cancel entry and leave a hidden modal.
        snapshotFlow{panelHeight}.first{it>0}
        awaitNativeGlassBackdrop(backdrop)
        if(!closing){
            offset=panelHeight+bottomGap;entered=true
            withFrameNanos{}
            if(!closing)moveTo(0f,entering=true){revealContent()}
        }
    }
    fun dismiss(velocity:Float=0f){
        if(closing||!canDismiss)return
        closing=true
        moveTo(panelHeight+bottomGap,if(velocity!=0f)velocity else motionVelocity){onClose()}
    }
    fun settle(velocity:Float=0f){
        moveTo(0f,velocity){revealContent()}
    }
    val drag=rememberDraggableState{amount->if(!closing&&canDismiss)offset=(offset+amount).coerceAtLeast(0f)}
    val dragHandle=Modifier.draggable(drag,Orientation.Vertical,enabled=canDismiss&&!closing,startDragImmediately=animating,
        onDragStarted={motionJob?.cancel();motionJob=null;animating=false;motionVelocity=0f},
        onDragStopped={velocity->if(!closing){
            val distance=minOf(with(density){64.dp.toPx()},panelHeight*0.35f)
            val fling=velocity>with(density){900.dp.toPx()}&&offset>with(density){12.dp.toPx()}
            if(canDismiss&&(offset>distance||fling))dismiss(velocity) else settle(velocity)
        }})
    NativeSheetLayer(inPlace,title,{if(canDismiss&&!closing&&backAction?.invoke()!=true)dismiss()}){
        Box(Modifier.fillMaxSize().nativeGlassSource(overlayScene,underlay=backdrop)){
            Box(Modifier.matchParentSize().testTag("sheetScrim").drawBehind{drawRect(Color.Black.copy(alpha=0.32f*(1f-offset/(panelHeight+bottomGap)).coerceIn(0f,1f)))}.clickable(enabled=canDismiss,interactionSource=remember{MutableInteractionSource()},indication=null,onClick={dismiss()}))
            Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.ime.union(WindowInsets.systemBars)),contentAlignment=Alignment.BottomCenter){
            CompositionLocalProvider(LocalNativeGlassBackdrop provides backdrop,LocalNativeOverlayBackdrop provides overlayScene,LocalNativeGlassMotion provides samplingMotion){
            NativeGlassSurface(shape=Radius.Sheet,color=MaterialTheme.colors.surface,kind=NativeGlassKind.SHEET,border=BorderStroke(1.dp,GlassEdge),modifier=Modifier.padding(horizontal=8.dp,vertical=8.dp).widthIn(max=720.dp).fillMaxWidth().then(if(stableHeight)Modifier.height(height) else Modifier.heightIn(max=height)).onSizeChanged{panelHeight=it.height}.testTag("sheetPanel").graphicsLayer{alpha=if(entered)1f else 0f;translationY=offset}){
                Column(Modifier.padding(horizontal=contentHorizontalPadding).padding(top=10.dp)){
                    Column(Modifier.fillMaxWidth().testTag("sheetDragHeader")){
                        Box(Modifier.fillMaxWidth().height(14.dp).then(dragHandle),contentAlignment=Alignment.TopCenter){Box(Modifier.size(32.dp,4.dp).clip(Radius.Tiny).background(Ink.copy(alpha=0.14f)))}
                        // Keep the close button outside the immediate drag region during entry.
                        Row(Modifier.padding(bottom=8.dp),verticalAlignment=Alignment.CenterVertically){
                            Box(Modifier.weight(1f).heightIn(min=48.dp).wrapContentHeight().then(dragHandle)){
                                if(titleContent!=null)titleContent() else Text(title,fontSize=20.sp,fontWeight=FontWeight.SemiBold)
                            }
                            NativeOverlayClose({dismiss()},enabled=canDismiss)
                        }
                    }
                    Column(Modifier.weight(1f,fill=bodyScrollState==null).then(bodyScrollState?.let{Modifier.verticalScroll(it)}?:Modifier).padding(bodyPadding),content=body)
                }
            }
            }
            }
        }
    }
}
@Composable private fun NativeSheetLayer(inPlace:Boolean,title:String,back:()->Unit,content:@Composable ()->Unit){
    val host=LocalNativeSheetHost.current
    if(host!=null){NativeSheetRegistration(host){NativeInlineSheetLayer(title,back,content)};return}
    if(inPlace)NativeInlineSheetLayer(title,back,content) else{
        // Compose 1.7's custom-width path caps height to screenHeightDp and
        // resets the window on layout. Use the native full-window constraints.
        Dialog(onDismissRequest=back,properties=DialogProperties(usePlatformDefaultWidth=true,decorFitsSystemWindows=false)){
        NativeDialogSystemBars(Color.Transparent,edgeToEdge=true)
        val window=(LocalView.current.parent as? DialogWindowProvider)?.window
        DisposableEffect(window){window?.let{
            it.setWindowAnimations(0)
            it.setDimAmount(0f)
            // The sheet draws its own scrim; an Android dimming window changes
            // status-bar appearance even when its dim amount is zero.
            it.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            if(android.os.Build.VERSION.SDK_INT>=30)it.attributes=it.attributes.apply{setFitInsetsTypes(0)}
            androidx.core.view.WindowCompat.setDecorFitsSystemWindows(it,false)
        };onDispose{}}
        content()
    }
    }
}
@Composable private fun NativeInlineSheetLayer(title:String,back:()->Unit,content:@Composable ()->Unit){
    val focus=androidx.compose.ui.platform.LocalFocusManager.current
    if(LocalNativeSheetHost.current==null)NativeSheetWindowPolicy(true)
    LaunchedEffect(Unit){focus.clearFocus()}
    BackHandler(onBack=back)
    Box(Modifier.fillMaxSize().semantics{paneTitle=title}){content()}
}
@OptIn(ExperimentalMaterialApi::class)
@Composable fun NativeApp(vm:NativeViewModel){
    val s=vm.state
    val wideLayout=LocalConfiguration.current.screenWidthDp>=840
    var wideSidebarOpen by rememberSaveable{mutableStateOf(true)}
    val readOnly=vm.isReadOnly()
    val home=s.threadId.isEmpty() && s.events.isEmpty() && !s.sending && !s.loadingHistory
    val drawer=rememberNativeDrawerState()
    val sidebarIsVisible=if(wideLayout)wideSidebarOpen else drawer.isOpen
    LaunchedEffect(wideLayout){if(wideLayout)drawer.close()}
    LaunchedEffect(wideLayout,s.connected){if(wideLayout&&s.connected)vm.refreshSidebar()}
    LaunchedEffect(drawer.currentValue,s.connected){if(drawer.currentValue==DrawerValue.Open&&s.connected)vm.refreshSidebar()}
    val scope=rememberCoroutineScope()
    val composerFocus=remember{FocusRequester()}
    var settings by remember{mutableStateOf(false)}
    var pairing by remember{mutableStateOf(false)}
    var workPanel by remember{mutableStateOf("")}
    fun backInWorkspace():Boolean {
        if(workPanel!="文件")return false
        if(s.fileBusy)return s.file!=null
        if(s.file!=null){vm.backToFiles();return true}
        val parent=nativeWorkspaceParentPath(s.filePath,s.fileRootPath)?:return false
        vm.files(parent);return true
    }
    val context=LocalContext.current
    val storagePermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission(),vm::storagePermissionResult)
    LaunchedEffect(s.storagePermissionRequired){if(s.storagePermissionRequired)storagePermission.launch(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)}
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->if(result.resultCode==android.app.Activity.RESULT_OK)vm.uploadMedia(nativePickedUris(result.data))}
    val filePicker=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->if(result.resultCode==android.app.Activity.RESULT_OK)vm.uploadFiles(nativePickedUris(result.data))}
    fun supportsCameraImage():Boolean {
        // Antigravity takes text blocks only, but the gateway hands uploaded images
        // over as local files its read_file tool can open, so camera and gallery
        // stay available there.
        if(vm.state.harness!="antigravity"&&vm.state.backends.find{it.agent==vm.state.harness}?.supportsImages==false){vm.error("当前助手不支持图片消息；可作为文件附件发送");return false}
        return true
    }
    val takePhoto=rememberNativeCamera(listOf(s.address,s.harness,s.threadId,s.projectId).joinToString("\n"),
        {uri,cleanup->vm.uploadMedia(listOf(uri),cleanup)},vm::error)
    fun chooseAttachment(kind:NativePickKind){
        if(kind==NativePickKind.MEDIA&&!supportsCameraImage())return
        val launcher=if(kind==NativePickKind.MEDIA)picker else filePicker
        val target=nativePickerIntent(context,kind)
        runCatching{launcher.launch(target)}.onFailure{
            if(target.`package`!=null)runCatching{launcher.launch(nativePickerIntent(context,kind,manufacturer=""))}.onFailure{vm.error("无法打开文件选择器")}
            else vm.error("无法打开文件选择器")
        }
    }
    val clipboard=LocalClipboardManager.current
    val haptics=rememberHaptics()
    val preferences=remember{context.getSharedPreferences("appearance",0)}
    var appearance by remember{mutableStateOf(preferences.getString("theme","system")?:"system")}
    fun changeAppearance(value:String){appearance=value;preferences.edit().putString("theme",value).apply()}
    val themeStore=remember(context){NativeThemeStore(context)}
    LaunchedEffect(themeStore){themeStore.load()}
    val themeDefinition=themeStore.state.selected
    val glassMode=themeDefinition.mode
    val effectiveGlass=nativeGlassPolicy(glassMode)
    val themePicker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)scope.launch{themeStore.importTheme(uri)}}
    var themeToExport by remember{mutableStateOf<NativeThemeDefinition?>(null)}
    val themeExporter=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")){uri->
        val theme=themeToExport;themeToExport=null
        if(uri!=null&&theme!=null)scope.launch{themeStore.exportTheme(uri,theme)}
    }
    var attachmentOpen by remember{mutableStateOf(false)}
    var attachmentDismissedAt by remember{mutableLongStateOf(0L)}
    var projectMenu by remember{mutableStateOf(false)}
    var createProjectOpen by remember{mutableStateOf(false)}
    var newProjectPath by remember{mutableStateOf("")}
    var newProjectName by remember{mutableStateOf("")}
    var parentMenu by remember{mutableStateOf(false)}
    var connectionOpen by remember{mutableStateOf(false)}
    var connectionReady by remember(connectionOpen){mutableStateOf(false)}
    var sessionTab by remember{mutableStateOf("connection")}
    var instructionThread by remember{mutableStateOf("")}
    var instructionAgent by remember{mutableStateOf("codex")}
    var quotaOpen by remember{mutableStateOf(false)}
    var automationSheetThread by remember{mutableStateOf<String?>(null)}
    fun openAutomationSheet(threadId:String){automationSheetThread=threadId}
    var networkOpen by remember{mutableStateOf(false)}
    var selectedThread by remember{mutableStateOf<ThreadRecord?>(null)}
    var movingThread by remember{mutableStateOf<ThreadRecord?>(null)}
    val manageThread:(ThreadRecord,String)->Unit={thread,action->when(action){
        "move"->{movingThread=thread;vm.loadThreadSections()}
        "unread"->vm.markThreadUnread(thread)
        "read"->vm.markThreadRead(thread)
        "archive"->vm.archiveThread(thread)
    }}
    var managementPage by rememberSaveable{mutableStateOf("")}
    var quotaUsageSource by rememberSaveable{mutableStateOf("all")}
    fun openManagement(page:String){
        managementPage=page
        if(page=="quota")vm.loadUsage()
        if(page=="automations")vm.loadAutomations() else if(s.automationsVisible)vm.closeAutomations()
        scope.launch{drawer.close()}
    }
    LaunchedEffect(s.automationsVisible){if(s.automationsVisible)managementPage="automations"}
    var modelMenu by remember{mutableStateOf(false)}
    var showModelList by remember{mutableStateOf(false)}
    var commandPanel by remember(s.threadId){mutableStateOf("")}
    var commandGoal by remember(s.threadId){mutableStateOf("")}
    var goalCommandSaving by remember(s.threadId,commandPanel){mutableStateOf(false)}
    var goalCommandError by remember(s.threadId,commandPanel){mutableStateOf("")}
    var goalEditor by remember(s.threadId){mutableStateOf<String?>(null)}
    var goalSaving by remember(s.threadId){mutableStateOf(false)}
    var goalError by remember(s.threadId){mutableStateOf("")}
    var sendScrollRequest by remember(s.threadId){mutableIntStateOf(0)}
    fun executeCommand(name:String,consumeDraft:Boolean=false){
        if(consumeDraft)vm.draft("")
        when(name){
            "plan"->vm.togglePlan()
            "fast"->vm.toggleFast()
            "compact"->{sessionTab="context";connectionOpen=true;vm.compactContext()}
            "status"->{sessionTab=if(s.threadId.isBlank())"connection" else "context";connectionOpen=true}
            "usage"->{sessionTab="context";connectionOpen=true}
            "model"->{showModelList=true;modelMenu=true}
            "effort"->{showModelList=false;modelMenu=true}
            "permissions"->{vm.loadRemoteApproval();settings=true}
            "new"->{
                val currentPath=s.threads.find{it.id==s.threadId}?.projectPath.orEmpty()
                val currentProject=s.projects.find{it.id==s.projectId}?:s.projects.find{currentPath.isNotBlank()&&nativePath(it.path)==nativePath(currentPath)}
                vm.newThread(currentProject)
            }
            "goal"->{commandGoal=s.threads.find{it.id==s.threadId}?.goal?.objective.orEmpty();commandPanel=name}
            "pin"->{
                if(s.threadId.isBlank())commandPanel=name
                else {
                    val thread=s.threads.find{it.id==s.threadId}?:ThreadRecord(id=s.threadId)
                    vm.pinThread(thread,thread.pinnedIndex<0)
                }
            }
            else->commandPanel=name
        }
    }
    var projectToolsOpen by remember{mutableStateOf(false)}
    var harnessOpen by remember{mutableStateOf(false)}
    var dismissedApprovalKey by remember(s.address,s.certificateSha256,s.threadId){mutableStateOf("")}
    val pendingApproval=remember(s.pendingApprovals,s.events,s.approvals,s.approvalResults,s.threadId){
        val pendingIds=s.pendingApprovals.filter{s.approvalResults[nativeApprovalKey(it.threadId,it.approvalId)].isNullOrEmpty()}.map{it.approvalId}.toSet()
        (s.pendingApprovals+s.events).lastOrNull{it.type=="approval.requested"&&it.threadId==s.threadId&&it.approvalId.isNotBlank()&&it.approvalId !in s.approvals&&it.approvalId in pendingIds}
    }
    val pendingApprovalKey=pendingApproval?.let{nativeApprovalKey(it.threadId,it.approvalId)}.orEmpty()
    val approvalSheetVisible=pendingApproval!=null&&pendingApprovalKey!=dismissedApprovalKey&&goalEditor==null&&!settings&&!pairing&&!harnessOpen&&managementPage.isEmpty()&&!networkOpen&&!s.automationsVisible&&workPanel.isEmpty()&&s.pdf==null&&s.markdown==null&&s.openedImage==null
    val questionSheetVisible=approvalSheetVisible&&pendingApproval?.approvalType=="question"
    val sidebarPrefs=remember{context.getSharedPreferences("sidebar",0)}
    var sidebarModuleOrder by remember{mutableStateOf((sidebarPrefs.getString("moduleOrder","").orEmpty().split(',').filter{it in sidebarModuleKeys}+sidebarModuleKeys).distinct())}
    var projectsOpen by remember{mutableStateOf(sidebarPrefs.getBoolean("projects",true))}
    var recentOpen by remember{mutableStateOf(sidebarPrefs.getBoolean("recent",true))}
    var pinnedOpen by remember{mutableStateOf(sidebarPrefs.getBoolean("pinned",true))}
    var goalsOpen by remember{mutableStateOf(sidebarPrefs.getBoolean("goals",true))}
    var agentsOpen by remember{mutableStateOf(sidebarPrefs.getBoolean("agents",false))}
    val agentRows=remember(s.threads,s.projectThreads){(s.threads+s.projectThreads.values.flatMap{it.rows}).distinctBy{it.id}}
    val parentThread=remember(agentRows,s.threadId){conversationParent(agentRows,s.threadId)}
    val expandedProjects=remember{mutableStateMapOf<String,Boolean>()}
    val dark=appearance=="dark" || (appearance=="system"&&isSystemInDarkTheme())
    val activeTheme=remember(themeDefinition,dark){themeDefinition.resolve(dark)}
    val colors=remember(activeTheme){activeTheme.palette.material(dark)}
    SideEffect{(context as? android.app.Activity)?.window?.let{window->
        val controller=androidx.core.view.WindowCompat.getInsetsController(window,window.decorView)
        controller.isAppearanceLightStatusBars=!dark
        controller.isAppearanceLightNavigationBars=!dark
        window.statusBarColor=android.graphics.Color.TRANSPARENT
        window.navigationBarColor=android.graphics.Color.TRANSPARENT
        if(android.os.Build.VERSION.SDK_INT>=29){window.isStatusBarContrastEnforced=false;window.isNavigationBarContrastEnforced=false}
    }}
    NativeThemeProvider(activeTheme,colors) {
        val chatInk=Ink.toArgb();val chatWash=Wash.toArgb();val chatSurface=colors.surface.toArgb()
        val chatRenderer=remember(context,chatInk,chatWash,chatSurface,vm){nativeMarkwon(context,vm::openOutput,chatInk,chatWash,chatSurface)}
        val chatMarkdownCache=remember(chatRenderer){NativeMarkdownRenderCache(chatRenderer,background={nativeMarkwon(context,vm::openOutput,chatInk,chatWash,chatSurface)})}
        val glassBackdrop=rememberNativeGlassBackdrop(effectiveGlass)
        val sheetHost=remember{NativeSheetHost()}
        CompositionLocalProvider(LocalNativeSheetHost provides sheetHost,LocalNativeGlassMode provides effectiveGlass,LocalNativeGlassBackdrop provides glassBackdrop,LocalNativeOverlayBackdrop provides glassBackdrop,LocalContentColor provides colors.onSurface,LocalChatMarkwon provides chatRenderer,LocalChatMarkdownCache provides chatMarkdownCache){
        Box(Modifier.fillMaxSize().background(activeTheme.palette.chat)){
        val focusManager=androidx.compose.ui.platform.LocalFocusManager.current
        val keyboardController=LocalSoftwareKeyboardController.current
        val hostView=LocalView.current
        val density=LocalDensity.current
        val imeInsets=WindowInsets.ime
        val imeVisible=imeInsets.getBottom(density)>0
        BackHandler(drawer.isOpen||workPanel.isNotEmpty()||(parentThread!=null&&!imeVisible)){
            when{
                drawer.isOpen->scope.launch{drawer.close()}
                workPanel.isNotEmpty()->if(!backInWorkspace())workPanel=""
                else->parentThread?.let(vm::openThread)
            }
        }
        var openingDrawer by remember{mutableStateOf(false)}
        fun dismissDrawerIme(){
            focusManager.clearFocus(force=true)
            keyboardController?.hide()
            (context.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager)?.hideSoftInputFromWindow(hostView.windowToken,0)
        }
        fun openDrawer(){
            if(wideLayout){wideSidebarOpen=!wideSidebarOpen;return}
            if(openingDrawer||drawer.isOpen)return
            openingDrawer=true
            dismissDrawerIme()
            scope.launch{try{
                drawer.open()
            }finally{openingDrawer=false}}
        }
        LaunchedEffect(drawer.targetValue){if(drawer.targetValue==DrawerValue.Open)dismissDrawerIme()}
        var drawerTopRadius by remember{mutableStateOf(32.dp)}
        Box(Modifier.fillMaxSize().focusProperties{canFocus=!sheetHost.visible}.semantics{if(sheetHost.visible)invisibleToUser()}){
        NativeAdaptiveDrawer(expanded=wideLayout,sidebarVisible=wideSidebarOpen,modifier=Modifier.nativeGlassSource(glassBackdrop).focusProperties{canFocus=!(questionSheetVisible||managementPage.isNotEmpty())}.semantics{if(questionSheetVisible||managementPage.isNotEmpty())invisibleToUser()}.onGloballyPositioned{
            if(android.os.Build.VERSION.SDK_INT>=31){
                val insets=hostView.rootWindowInsets
                // Match the device/window edge instead of assuming every phone has a 32dp corner.
                // Some devices (S23/One UI) report a much smaller top radius than bottom, which
                // read as a lopsided drawer; use the larger of the two for both corners.
                val topPx=insets?.getRoundedCorner(android.view.RoundedCorner.POSITION_TOP_RIGHT)?.radius?.takeIf{it>0}?:0
                val bottomPx=insets?.getRoundedCorner(android.view.RoundedCorner.POSITION_BOTTOM_RIGHT)?.radius?.takeIf{it>0}?:0
                val fallbackPx=with(density){32.dp.toPx()}
                val radius=with(density){maxOf(topPx.toFloat(),bottomPx.toFloat()).coerceAtLeast(fallbackPx).toDp()}
                drawerTopRadius=radius
            }
        },drawerState=drawer,gesturesEnabled=!imeVisible,drawerBackgroundColor=colors.background,contentBackgroundColor=activeTheme.palette.chat,contentCornerRadius=drawerTopRadius,scrimColor=Color.Black.copy(alpha=0.06f),drawerContent={
            Column(Modifier.fillMaxSize().systemBarsPadding().padding(horizontal=12.dp,vertical=8.dp)){
                var query by remember{mutableStateOf("")}
                var searchOpen by remember{mutableStateOf(false)}
                var searchFocused by remember{mutableStateOf(false)}
                val searchFocus=remember{FocusRequester()}
                val searchAvailable=sidebarIsVisible&&(wideLayout||drawer.targetValue==DrawerValue.Open)
                NativeSidebarReachability(enabled=sidebarIsVisible&&!imeVisible&&!searchOpen,modifier=Modifier.weight(1f)){
                Row(Modifier.fillMaxWidth().padding(bottom=6.dp),verticalAlignment=Alignment.CenterVertically){
                    Box(Modifier.weight(1f)){
                        Row(Modifier.heightIn(min=48.dp).clip(Radius.Field).clickable{harnessOpen=true}.padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){NativeHarnessIcon(s.harness,Modifier.padding(end=10.dp).size(22.dp),Ink);Text(nativeAgentName(s.harness),Modifier.weight(1f,fill=false),fontSize=17.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis);ModernIcon(R.drawable.ic_lucide_chevron_down,"切换助手",Modifier.padding(start=8.dp).size(16.dp),Muted)}
                        ModernDropdown(harnessOpen,{harnessOpen=false},240.dp){
                            Column(Modifier.padding(6.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                                nativeHarnesses.filter{it !in vm.hiddenHarnesses}.forEach{key->
                                        val available=nativeBackendAvailable(key,s.models,s.backends)
                                        val selected=key==s.harness
                                        Row(Modifier.fillMaxWidth().heightIn(min=48.dp).clip(Radius.MenuItem).background(if(selected)Ink.copy(alpha=.07f) else Color.Transparent).clickable(enabled=available){if(vm.switchHarness(key)){workPanel="";harnessOpen=false}}.padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
                                            NativeHarnessIcon(key,Modifier.size(22.dp),if(available)Ink else Muted)
                                            Column(Modifier.weight(1f).padding(start=8.dp)){
                                                Text(nativeAgentName(key),fontSize=16.sp,color=if(available)Ink else Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
                                                if(!available)Text(nativeBackendStatusLabel(nativeBackendReason(key,s.models,s.backends)),fontSize=10.sp,color=Muted,maxLines=1)
                                            }
                                            if(selected)ModernIcon(R.drawable.ic_lucide_check,null,Modifier.size(14.dp),Muted)
                                        }
                                }
                            }
                        }
                    }
                    IconButton(onClick={if(wideLayout)wideSidebarOpen=false else scope.launch{drawer.close()}}){ModernIcon(R.drawable.ic_lucide_arrow_left,"收起侧栏",Modifier.size(20.dp),Muted)}
                }
                Row(Modifier.fillMaxWidth().heightIn(min=48.dp).padding(bottom=6.dp),verticalAlignment=Alignment.CenterVertically){
                    if(searchOpen){
                        Entry(query,{query=it},"搜索会话",modifier=Modifier.weight(1f).focusProperties{canFocus=searchAvailable}
                            .onFocusChanged{searchFocused=it.isFocused}.focusRequester(searchFocus).testTag("threadSearchInput"),surface=Wash)
                        IconButton(onClick={if(searchFocused)dismissDrawerIme();query="";searchOpen=false}){ModernIcon(R.drawable.ic_lucide_x,"关闭搜索",Modifier.size(20.dp),Muted)}
                    }else{
                        Row(Modifier.weight(1f).heightIn(min=48.dp).clip(Radius.Field).background(Ink.copy(alpha=.055f)).clickable{
                            val currentPath=s.threads.find{it.id==s.threadId}?.projectPath.orEmpty()
                            val workspace=s.projects.find{it.id==s.projectId}?:s.projects.find{currentPath.isNotBlank()&&nativePath(it.path)==nativePath(currentPath)}
                            vm.newThread(workspace);scope.launch{drawer.close()}
                        }.padding(horizontal=12.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){
                            ModernIcon(R.drawable.ic_lucide_square_pen,null,Modifier.size(18.dp))
                            Text("新会话",Modifier.padding(start=10.dp),fontSize=14.sp,fontWeight=FontWeight.Medium)
                        }
                        IconButton(onClick={searchOpen=true}){ModernIcon(R.drawable.ic_lucide_search,"搜索会话",Modifier.size(20.dp),Muted)}
                    }
                    if("thread-sidebar-filters" in s.capabilities)NativeSidebarFilterMenu(s.threadFilter,sidebarIsVisible,vm::setThreadFilter)
                }
                LaunchedEffect(searchOpen,searchAvailable){
                    if(searchOpen&&searchAvailable){delay(100);searchFocus.requestFocus()}
                    else if(searchFocused)dismissDrawerIme()
                }
                LaunchedEffect(query,s.harness,s.connected,s.activeAddress,s.threadFilter,sidebarIsVisible){vm.searchRemote(if(s.threadFilter==NativeThreadFilter.ALL&&sidebarIsVisible)query else "",s.harness)}
                DisposableEffect(vm){onDispose{vm.searchRemote("",vm.state.harness)}}
                val searchQuery=query.trim()
                val remoteEnabled=s.threadFilter==NativeThreadFilter.ALL&&searchQuery.length>=2
                val remoteSearch=s.remoteSearch.takeIf{it.query==searchQuery&&it.agent==s.harness}
                    ?:NativeThreadSearch(searchQuery,s.harness,loading=remoteEnabled&&s.connected&&sidebarIsVisible)
                val remoteMatches=if(remoteEnabled)remoteSearch.matches else emptyList()
                val harnessThreads=s.threads.filter{nativeThreadAgent(it.id)==s.harness}
                val roots=remember(harnessThreads,query,s.threadFilter){sidebarThreadRoots(harnessThreads,query,s.threadFilter)}
                val inactiveAgents=remember(agentRows,s.harness,query,s.threadFilter){sidebarInactiveAgents(agentRows.filter{nativeThreadAgent(it.id)==s.harness},query,s.threadFilter)}
                val runningPulse=rememberNativeRunningPulse(sidebarIsVisible&&agentRows.any{nativeThreadAgent(it.id)==s.harness&&it.status=="running"})
                val agentChildren=remember(agentRows){agentRows.filter{it.subagent?.parentThreadId?.isNotBlank()==true}.groupBy{it.subagent!!.parentThreadId}}
                val activeGoals=remember(roots,agentChildren){roots.filter{threadFamilyRunning(it,agentChildren)}}
                val visibleModules=sidebarModuleOrder.filter{module->when(module){
                    "projects"->s.sidebarProjects.isNotEmpty()||s.projects.isNotEmpty()
                    "goals"->s.threadFilter==NativeThreadFilter.ALL&&activeGoals.isNotEmpty()
                    "pinned"->s.threadFilter==NativeThreadFilter.ALL&&roots.any{it.pinnedIndex>=0}
                    "agents"->inactiveAgents.isNotEmpty()
                    else->true
                }}
                fun moveSidebarModule(module:String,direction:Int){
                    val target=visibleModules.getOrNull(visibleModules.indexOf(module)+direction)?:return
                    val from=sidebarModuleOrder.indexOf(module);val to=sidebarModuleOrder.indexOf(target)
                    sidebarModuleOrder=sidebarModuleOrder.toMutableList().apply{removeAt(from);add(to,module)}.toList()
                    sidebarPrefs.edit().putString("moduleOrder",sidebarModuleOrder.joinToString(",")).apply()
                }
                val threadRow: @Composable LazyItemScope.(ThreadRecord)->Unit={t->Box(Modifier.animateItem(fadeInSpec=null,fadeOutSpec=null,placementSpec=tween(180,easing=ControlEase))){NativeSidebarThread(t,s.threadId,{scope.launch{drawer.close();vm.openThread(it)}},{selectedThread=it},{vm.pinThread(it,it.pinnedIndex<0)},pulse=runningPulse,manage=manageThread)}}
                val sidebarList=rememberLazyListState()
                LazyColumn(Modifier.weight(1f).nativeSidebarEdgeFade(sidebarList).testTag("sidebarList"),state=sidebarList,
                    contentPadding=PaddingValues(bottom=activeTheme.material.sidebarFadeDp.dp)){
                    if(s.cloudListError.isNotBlank())item(key="cloudListError"){Text("云端任务：${s.cloudListError}",Modifier.padding(12.dp),fontSize=12.sp,color=Muted)}
                    visibleModules.forEachIndexed{position,module->
                    val moveUp:(()->Unit)?=if(position>0)({moveSidebarModule(module,-1)}) else null
                    val moveDown:(()->Unit)?=if(position<visibleModules.lastIndex)({moveSidebarModule(module,1)}) else null
                    when(module){
                    "agents"->{
                        item(key="agentsHeading"){SidebarHeading("子代理 · ${inactiveAgents.size}",agentsOpen,moveUp,moveDown){agentsOpen=!agentsOpen;sidebarPrefs.edit().putBoolean("agents",agentsOpen).apply()}}
                        if(agentsOpen||query.isNotBlank())items(inactiveAgents,key={"agent:"+it.id}){thread->
                            NativeSidebarAgent(thread,agentRows.find{it.id==thread.subagent?.parentThreadId},{vm.openThread(thread);scope.launch{drawer.close()}},{vm.closeSubagent(thread)})
                        }
                    }
                    "projects"->{
                    item(key="projectsHeading"){SidebarHeading("项目",projectsOpen,moveUp,moveDown){projectsOpen=!projectsOpen;sidebarPrefs.edit().putBoolean("projects",projectsOpen).apply();if(projectsOpen)vm.refreshSidebar()}}
                    if(projectsOpen&&query.isBlank())(s.sidebarProjects.ifEmpty{s.projects}).forEach{p->
                        val expanded=expandedProjects[p.id]?:sidebarPrefs.getBoolean("project:${p.id}",false)
                        item(key="project:${p.id}"){
                            val chevronAngle=animateFloatAsState(if(expanded)90f else 0f,chevronMotion(),label="projectChevron")
                            Row(Modifier.fillMaxWidth().clip(Radius.Field),verticalAlignment=Alignment.CenterVertically){Row(Modifier.weight(1f).clickable{expandedProjects[p.id]=!expanded;sidebarPrefs.edit().putBoolean("project:${p.id}",!expanded).apply()}.padding(start=12.dp,top=10.dp,bottom=10.dp),verticalAlignment=Alignment.CenterVertically){ModernIcon(R.drawable.ic_lucide_folder,null,Modifier.size(18.dp),Muted);Text(p.name,Modifier.weight(1f).padding(start=11.dp),fontSize=14.sp,maxLines=1,overflow=TextOverflow.Ellipsis);ModernIcon(R.drawable.ic_lucide_chevron_right,null,Modifier.size(18.dp).graphicsLayer{rotationZ=chevronAngle.value},Muted)};ChromeButton(R.drawable.ic_lucide_plus,"在项目中新建",{vm.startInProject(p);scope.launch{drawer.close()}})}
                            LaunchedEffect(expanded,s.harness,p.path,sidebarIsVisible,s.connected,s.threadFilter){if(expanded&&sidebarIsVisible&&s.connected){vm.loadProjectThreads(p,force=true);vm.refreshSidebar()}}
                        }
                        if(expanded){
                            val projectPage=s.projectThreads[s.harness+":"+nativePath(p.path)]
                            items(sidebarThreadRoots(projectPage?.rows?:emptyList(),filter=s.threadFilter),key={"projectThread:${p.id}:${it.id}"}){t->NativeSidebarThread(t,s.threadId,{scope.launch{drawer.close();vm.openThread(it)}},{selectedThread=it},{vm.pinThread(it,it.pinnedIndex<0)},pulse=runningPulse,manage=manageThread)}
                            if(projectPage?.loading==true)item(key="projectLoading:${p.id}"){Text("加载中…",Modifier.padding(12.dp),fontSize=13.sp,color=Muted)}
                            else if(projectPage?.hasMore==true)item(key="projectMore:${p.id}"){TextButton(onClick={vm.loadProjectThreads(p,true)}){Text("加载更多会话",fontSize=13.sp)}}
                            else if(projectPage?.loaded!=true)item(key="projectLoad:${p.id}"){TextButton(onClick={vm.loadProjectThreads(p)}){Text("加载会话",fontSize=13.sp)}}
                        }
                    }
                    if(projectsOpen&&query.isBlank()&&s.moreProjects)item(key="moreProjects"){TextButton(onClick={vm.loadMoreProjects()},enabled=!s.loadingSidebar,modifier=Modifier.fillMaxWidth()){Text(if(s.loadingSidebar)"加载中…" else "加载更多项目",fontSize=13.sp)}}
                    }
                    "goals"->{
                        item(key="goalsHeading"){SidebarHeading("进行中",goalsOpen,moveUp,moveDown){goalsOpen=!goalsOpen;sidebarPrefs.edit().putBoolean("goals",goalsOpen).apply()}}
                        if(goalsOpen||query.isNotBlank())items(activeGoals,key={"goal:"+it.id}){t->NativeSidebarThread(t,s.threadId,{scope.launch{drawer.close();vm.openThread(it)}},{selectedThread=it},{vm.pinThread(it,it.pinnedIndex<0)},goal=true,pulse=runningPulse,manage=manageThread)}
                    }
                    "pinned"->{
                        item(key="pinnedHeading"){SidebarHeading("置顶会话",pinnedOpen,moveUp,moveDown){pinnedOpen=!pinnedOpen;sidebarPrefs.edit().putBoolean("pinned",pinnedOpen).apply()}}
                        if(pinnedOpen||query.isNotBlank())items(roots.filter{it.pinnedIndex>=0}.sortedBy{it.pinnedIndex},key={"thread:"+it.id},itemContent=threadRow)
                    }
                    "recent"->{
                    if(s.threadFilter!=NativeThreadFilter.ALL){
                        item(key="filteredHeading"){SidebarHeading(if(s.threadFilter==NativeThreadFilter.UNREAD)"未读会话" else "进行中的会话",true,moveUp,moveDown,toggle=null)}
                        items(roots,key={"thread:"+it.id},itemContent=threadRow)
                        if(roots.isEmpty())item(key="noFilteredThreads"){Text(if(s.loadingSidebar)"加载中…" else if(query.isNotBlank())"没有找到会话" else if(s.threadFilter==NativeThreadFilter.UNREAD)"没有未读会话" else "没有运行中的会话",color=Muted,fontSize=14.sp,modifier=Modifier.padding(16.dp))}
                        if(s.moreThreads)item(key="moreThreads"){TextButton(onClick={vm.loadMoreThreads()},enabled=!s.loadingSidebar,modifier=Modifier.fillMaxWidth()){Text(if(s.loadingSidebar)"加载中…" else "加载更多会话",fontSize=13.sp)}}
                    }else{
                    item(key="recentHeading"){SidebarHeading("最近会话",recentOpen,moveUp,moveDown){recentOpen=!recentOpen;sidebarPrefs.edit().putBoolean("recent",recentOpen).apply();if(recentOpen)vm.refreshSidebar()}}
                    if(recentOpen||query.isNotBlank())items(roots.filter{it.pinnedIndex<0},key={"thread:"+it.id},itemContent=threadRow)
                    if(recentOpen&&query.isBlank()&&s.moreThreads)item(key="moreThreads"){TextButton(onClick={vm.loadMoreThreads()},enabled=!s.loadingSidebar,modifier=Modifier.fillMaxWidth()){Text(if(s.loadingSidebar)"加载中…" else "加载更多会话",fontSize=13.sp)}}
                    }
                    }
                    }
                    }
                    if(remoteEnabled&&s.connected){
                        item(key="remoteMatchesHeading"){NativeThreadSearchFeedback(remoteSearch,{vm.searchRemote(query,s.harness)})}
                        items(remoteMatches,key={"remote:"+it.threadId}){match->
                            NativeRemoteMatchRow(match){
                                vm.openThread(s.threads.find{it.id==match.threadId}?:ThreadRecord(id=match.threadId,title=match.title,updatedAt=match.updatedAt))
                                scope.launch{drawer.close()}
                            }
                        }
                    }
                    if(query.isNotBlank()&&s.threadFilter==NativeThreadFilter.ALL&&roots.isEmpty()&&inactiveAgents.isEmpty()&&remoteMatches.isEmpty()&&(!s.connected||!remoteSearch.loading)&&remoteSearch.error.isBlank())item(key="noSidebarResults"){
                        Text(when{!s.connected->"连接电脑后搜索正文";!remoteEnabled->"输入至少 2 个字符搜索正文";else->"没有找到会话"},color=Muted,fontSize=14.sp,modifier=Modifier.padding(16.dp))
                    }
                }
                }
                Spacer(Modifier.height(8.dp))
                NativeSidebarAction(R.drawable.ic_lucide_gauge,"账号额度"){quotaOpen=true}
                if(!s.connected||"automations" in s.capabilities)NativeSidebarAction(R.drawable.ic_lucide_clock_3,"定时任务"){openAutomationSheet("")}
                NativeSidebarAction(R.drawable.ic_lucide_settings,"设置"){openManagement("home")}
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    Box(Modifier.weight(1f)){
                        NativeSidebarAction(R.drawable.ic_lucide_monitor,if(s.connected)"已连接电脑" else "连接电脑",status=if(s.connected)AppColor.StatusOk else AppColor.StatusError){pairing=true}
                    }
                    NativeSidebarThemeToggle(appearance,dark,::changeAppearance)
                }
            }
        }) {
            val sideVisible by remember(vm.sideChat){derivedStateOf{vm.sideChat.state.visible}}
            val sideController=vm.sideChat.current
            val splitSide=wideLayout&&!wideSidebarOpen&&sideVisible
            Row(Modifier.fillMaxSize()){
            Column(Modifier.weight(1f).fillMaxHeight().background(activeTheme.palette.chat).nativeGlassBackdrop()){
                NativeConversationBody(effectiveGlass.floatingChrome,header={
                val floating=LocalNativeFloatingChrome.current
                Row(Modifier.fillMaxWidth().statusBarsPadding().heightIn(min=56.dp).padding(horizontal=if(floating)12.dp else 8.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(if(floating)6.dp else 0.dp)){
                    ChromeButton(R.drawable.ic_menu_compact,if(wideLayout&&wideSidebarOpen)"收起侧栏" else "展开侧栏",::openDrawer)
                    parentThread?.let{parent->Box(Modifier.testTag("conversationParentBack")){ChromeButton(R.drawable.ic_lucide_arrow_left,"返回上级会话",{vm.openThread(parent)})}}
                    if(!floating)Spacer(Modifier.width(8.dp))
                    if(!home)NativeConversationTitleFrame(Modifier.weight(1f)){
                    Column(Modifier.heightIn(min=if(floating)48.dp else 0.dp).padding(horizontal=if(floating)14.dp else 0.dp,vertical=if(floating)5.dp else 0.dp),verticalArrangement=Arrangement.spacedBy(1.dp,Alignment.CenterVertically)){
                        val thread=s.threads.find{it.id==s.threadId}
                        val workspace=s.projects.find{it.id==s.projectId}?.name?:thread?.projectPath?.replace('\\','/')?.trimEnd('/')?.substringAfterLast('/').orEmpty()
                        if(!home)NativeToolbarText(nativeDisplayThreadTitle(thread?.title.orEmpty(),"新会话"),16.sp,20.sp,FontWeight.Medium,Ink,Modifier.testTag("conversationTitle"))
                        if(!home&&workspace.isNotBlank())NativeToolbarText(workspace,12.sp,16.sp,FontWeight.Normal,Muted,Modifier.testTag("conversationWorkspace"))
                    }}else Spacer(Modifier.weight(1f))
                    val connectionLabel=if(s.connected)"已连接电脑" else if(s.connecting)"正在连接电脑" else "未连接电脑"
                    val connectionColor=if(s.connected)AppColor.StatusOk else AppColor.StatusError
                    val tokens=s.usage?.optJSONObject("tokens")
                    val used=tokens?.takeUnless{it.isNull("context")}?.optLong("context")?:tokens?.takeUnless{it.isNull("last")}?.optLong("last")
                    val capacity=tokens?.takeUnless{it.isNull("contextWindow")}?.optLong("contextWindow")
                    val contextReady=s.connected&&s.threadId.isNotBlank()&&used!=null&&capacity!=null&&capacity>0
                    val fraction=if(contextReady)(used!!.toFloat()/capacity!!).coerceIn(0f,1f) else 0f
                    val progress=animateFloatAsState(fraction,tween(240,easing=ControlEase),label="contextRing")
                    ChromeControl({sessionTab=if(contextReady)"context" else "connection";connectionOpen=true},false,Modifier.testTag("connectionStatus").semantics{contentDescription="连接状态：$connectionLabel"+if(contextReady)"，上下文已用 ${(fraction*100).roundToInt()}%，查看会话状态" else "，查看连接信息"}){
                        Crossfade(contextReady,animationSpec=tween(150,easing=ControlEase),label="sessionStatusIcon"){showContext->
                            if(showContext){
                                val ringProgress=if(MaterialTheme.colors.isLight)Color.Black else Color.White
                                val ringTrack=ringProgress.copy(alpha=if(MaterialTheme.colors.isLight)0.16f else 0.28f)
                                Box(Modifier.size(21.dp),contentAlignment=Alignment.Center){
                                    Canvas(Modifier.size(14.dp).testTag("statusContextRing")){
                                        val width=1.8.dp.toPx()
                                        drawArc(ringTrack,0f,360f,false,style=Stroke(width))
                                        if(progress.value>0f)drawArc(ringProgress,-90f,progress.value*360f,false,style=Stroke(width))
                                    }
                                }
                            }else ModernIcon(R.drawable.ic_lucide_monitor,null,Modifier.size(21.dp).testTag("statusComputer"),connectionColor)
                        }
                    }
                    if(!home)NativeConversationAgents(agentRows,s.threadId,vm::openThread,onClose=vm::closeSubagent)
                    var more by remember{mutableStateOf(false)}
                    var moreDismissedAt by remember{mutableLongStateOf(0L)}
                    Box{
                        ChromeControl({val now=android.os.SystemClock.uptimeMillis();if(more){more=false;moreDismissedAt=now}else if(now-moreDismissedAt>300)more=true},false){Crossfade(more,animationSpec=tween(150,easing=ControlEase),label="menuIcon"){open->ModernIcon(if(open)R.drawable.ic_lucide_x else R.drawable.ic_lucide_ellipsis,if(open)"关闭会话菜单" else "会话菜单",Modifier.size(21.dp))}}
                        ModernDropdown(more,{more=false;moreDismissedAt=android.os.SystemClock.uptimeMillis()},250.dp,placement=NativePopupPlacement.ADJACENT){
                            Column(Modifier.padding(6.dp)){
                                if(s.connected&&s.harness=="codex"&&s.threadId.isNotBlank()&&!readOnly){
                                    if("thread-side-chat" in s.capabilities)PopupMenuRow(R.drawable.ic_lucide_messages_square,"侧聊"){more=false;vm.sideChat.open(s.threadId,s.model,s.effort,s.permission)}
                                    if("thread-fork" in s.capabilities)PopupMenuRow(R.drawable.ic_lucide_git_branch,"创建会话分支"){more=false;vm.forkConversation()}
                                    if("codex-background-terminals" in s.capabilities)PopupMenuRow(R.drawable.ic_lucide_terminal,"后台终端"){more=false;workPanel="后台终端"}
                                    if("codex-review" in s.capabilities&&!s.running)PopupMenuRow(R.drawable.ic_lucide_file_diff,"审阅改动"){more=false;workPanel="审阅改动"}
                                    if("desktop-browser" in s.capabilities)PopupMenuRow(R.drawable.ic_lucide_globe,"电脑浏览器"){more=false;workPanel="电脑浏览器"}
                                }
                                if(s.threadId.isNotBlank()&&s.harness=="codex"&&"automations" in s.capabilities&&!readOnly)PopupMenuRow(R.drawable.ic_lucide_clock_3,"本会话定时任务"){more=false;openAutomationSheet(s.threadId)}
                                PopupMenuRow(R.drawable.ic_lucide_gauge,"上下文与连接"){more=false;sessionTab=if(s.threadId.isBlank())"connection" else "context";connectionOpen=true}
                                if(s.harness=="codex"&&s.threadId.isNotBlank()&&!readOnly)PopupMenuRow(R.drawable.ic_lucide_target,"会话目标"){more=false;executeCommand("goal")}
                                if(s.connected&&s.threadId.isNotBlank()&&!readOnly)PopupMenuRow(R.drawable.ic_lucide_file_text,"工作区指令"){more=false;instructionThread=s.threadId;instructionAgent=s.harness;openManagement("session-instructions")}
                                if(!readOnly)PopupMenuRow(R.drawable.ic_lucide_sliders_horizontal,"模型与权限"){more=false;if(s.connected)vm.loadRemoteApproval();settings=true}
                                if(!readOnly&&s.harness!="codex"&&nativePlanAvailable(s.harness,s.backends))PopupMenuRow(R.drawable.ic_lucide_list_todo,if(s.nextMode=="plan")"退出计划模式" else "计划模式"){more=false;vm.togglePlan()}
                                if(s.connected&&"files" in s.capabilities&&!readOnly)PopupMenuRow(R.drawable.ic_lucide_folder,"工作区文件"){more=false;vm.files();workPanel="文件"}
                                if(s.connected&&s.projectId.isNotBlank()&&!readOnly&&s.capabilities.any{it in listOf("diff","terminal-pty")})PopupMenuRow(R.drawable.ic_lucide_wrench,"项目工具"){more=false;projectToolsOpen=true}
                                Divider(Modifier.padding(vertical=5.dp),color=Ink.copy(alpha=0.08f))
                                PopupMenuRow(R.drawable.ic_lucide_settings,"设置"){more=false;openManagement("home")}
                            }
                        }
                    }
                }
                },messages={topInset,bottomInset->
                    if(home){Box(Modifier.fillMaxSize().padding(top=topInset,bottom=bottomInset),contentAlignment=Alignment.Center){NativeWelcome(s.harness)}} else key(s.address,s.harness,s.threadId){NativeMessages(vm,sendScrollRequest,drawer.currentValue==DrawerValue.Closed&&drawer.targetValue==DrawerValue.Closed,bottomInset,topInset){dismissedApprovalKey=""}}
                }){
                NativeQueuedDraftRecovery(s.queueDrafts){q->vm.restoreQueued(q);scope.launch{composerFocus.requestFocus()}}
                if(vm.threadToolBusy)Text("正在创建分支…",Modifier.padding(horizontal=16.dp),fontSize=12.sp,color=Muted)
                if(vm.threadToolError.isNotBlank())Text(vm.threadToolError,Modifier.padding(horizontal=16.dp),fontSize=12.sp,color=MaterialTheme.colors.error)
                NativeQueueDock(vm,s.queue,s.running){q->vm.restoreQueued(q);scope.launch{composerFocus.requestFocus()}}
                if(readOnly&&s.threadId.startsWith("cloud:"))Text("云端会话 · 自动刷新 · 在桌面继续",Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=8.dp).testTag("cloudThreadNotice"),fontSize=12.sp,color=Muted)
                if(readOnly&&!s.threadId.startsWith("cloud:"))s.threads.find{it.id==s.threadId}?.let{snapshot->
                    Surface(Modifier.fillMaxWidth().padding(horizontal=12.dp,vertical=6.dp).testTag("cloudSnapshotNotice"),shape=Radius.Field,color=Wash){
                        Column(Modifier.padding(12.dp)){
                            Text("云端会话 · 只读快照",fontWeight=FontWeight.Medium,fontSize=14.sp)
                            Text("采集于 ${snapshot.snapshotUpdatedAt} · ${if(snapshot.snapshotStale)"已过期 · " else ""}非实时状态（${nativeSnapshotStatus(snapshot.snapshotStatus)}）",fontSize=12.sp,color=Muted)
                            Text(if(snapshot.snapshotContentKind=="messages")"已导入的消息" else "已导入的会话摘要",fontSize=12.sp,color=Muted)
                        }
                    }
                }
                if(s.submissionNotice.isNotBlank())NativeSubmissionNotice(s.submissionNotice,vm::checkSubmission,vm::dismissSubmissionNotice,vm::clearFailedMessages)
                val activeGoal=s.threads.find{it.id==s.threadId}?.goal?.takeUnless{it.status=="complete"}
                var retainedGoal by remember(s.threadId){mutableStateOf<NativeGoal?>(null)}
                SideEffect{if(activeGoal!=null)retainedGoal=activeGoal}
                AnimatedVisibility(activeGoal!=null,
                    enter=expandVertically(expandFrom=Alignment.Bottom,animationSpec=tween(180,easing=ControlEase))+fadeIn(tween(150)),
                    exit=shrinkVertically(shrinkTowards=Alignment.Bottom,animationSpec=tween(180,easing=ControlEase))+fadeOut(tween(150))){
                    (activeGoal?:retainedGoal)?.let{NativeGoalDock(vm,s.threadId,it,onEdit={objective->goalEditor=objective;goalError=""})}
                }
                    val commands=if(s.harness=="codex")nativeCommandMatches(s.draft) else emptyList()
                if(!readOnly)Box(Modifier.windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)).fillMaxWidth()){
                Column{
                val bannerDismissed=remember(s.connected){mutableStateOf(false)}
                androidx.compose.animation.AnimatedVisibility(!s.connected&&!s.connecting&&s.threadId.isNotBlank()&&!bannerDismissed.value,
                    enter=expandVertically(expandFrom=Alignment.Bottom,animationSpec=tween(150,easing=ControlEase))+fadeIn(tween(120)),
                    exit=shrinkVertically(shrinkTowards=Alignment.Bottom,animationSpec=tween(150,easing=ControlEase))+fadeOut(tween(120))){
                    NativeNoticeSurface(AppColor.StatusError,Modifier.fillMaxWidth().padding(horizontal=12.dp).testTag("connectionNotice")){
                        Row(Modifier.fillMaxWidth().padding(start=12.dp,end=4.dp,top=6.dp,bottom=6.dp),verticalAlignment=Alignment.CenterVertically){
                            ModernIcon(R.drawable.ic_lucide_rotate_cw,null,Modifier.size(15.dp),AppColor.StatusError)
                            Text(if(s.error.isNotBlank())s.error else "与电脑的连接已断开",Modifier.weight(1f).padding(horizontal=8.dp),fontSize=12.sp,lineHeight=17.sp,color=Ink,maxLines=2,overflow=TextOverflow.Ellipsis)
                            TextButton(onClick={vm.retryConnect()},enabled=!s.sending){Text("重连",fontSize=12.sp)}
                            IconButton(onClick={bannerDismissed.value=true},modifier=Modifier.size(48.dp)){ModernIcon(R.drawable.ic_lucide_x,"关闭提醒",Modifier.size(14.dp))}
                        }
                    }
                }
                s.modelServiceNotice?.let{ModelServiceNoticeBanner(it,vm::dismissModelServiceNotice)}
                NativeComposerSurface(Modifier.padding(horizontal=12.dp,vertical=8.dp).fillMaxWidth(),kind=if(effectiveGlass.floatingChrome)NativeGlassKind.DOCK else NativeGlassKind.CHROME){
                    val composerIntoView=remember{BringIntoViewRequester()}
                    var composerFocused by remember{mutableStateOf(false)}
                    LaunchedEffect(s.threadId,imeVisible,composerFocused){
                        if(imeVisible&&composerFocused){withFrameNanos{};composerIntoView.bringIntoView()}
                    }
                    Column(Modifier.weight(1f,fill=false).heightIn(max=if(imeVisible)180.dp else 250.dp).testTag("composerBody")){
                    // Reserve the editor before measuring scrollable attachment/status content.
                    Column(Modifier.weight(1f,fill=false).verticalScroll(rememberScrollState()).testTag("composerAttachments")){
                    if(s.threadId.isBlank())NativeWorkspaceControl(s.projects.find{it.id==s.projectId},s.connected&&!s.sending,{projectMenu=true},Modifier.padding(horizontal=3.dp))
                    if(s.stopping||s.stopError.isNotBlank())Text(if(s.stopping)"正在停止，等待电脑确认…" else s.stopError,Modifier.padding(horizontal=6.dp,vertical=4.dp),fontSize=12.sp,color=if(s.stopping)Muted else MaterialTheme.colors.error)
                    nativeModelSelectionError(s.harness,s.model,s.models).takeIf{it.isNotBlank()}?.let{Text(it,Modifier.padding(horizontal=6.dp,vertical=4.dp).testTag("modelSelectionUnavailable"),fontSize=12.sp,color=MaterialTheme.colors.error)}
                    if(s.uploading)NativeUploadStatus(s.uploadMessage,s.uploadProgress,vm::cancelUpload)
                    if(s.uploadError.isNotBlank())NativeUploadError(s.uploadError,vm::dismissUploadError)
                    if(s.nextMode=="plan")Row{
                        if(s.nextMode=="plan")TextButton(onClick={vm.togglePlan()}){Text("计划模式 ×",fontSize=12.sp)}
                    }
                    if(s.images.isNotEmpty())NativeImageGallery(vm,s.images.map{"/api/uploads/images/${it.id}"}){endpoint->vm.removeImage(endpoint.substringAfterLast('/'))}
                    if(s.uploads.isNotEmpty())Row(Modifier.horizontalScroll(rememberScrollState())){s.uploads.forEach{file->Surface(shape=Radius.Card,color=MaterialTheme.colors.surface,modifier=Modifier.padding(4.dp).heightIn(min=44.dp).clickable(enabled=!s.fileBusy){vm.openUpload(file)}){Row(verticalAlignment=Alignment.CenterVertically){ModernIcon(if(file.mime.startsWith("video/"))R.drawable.ic_lucide_video else R.drawable.ic_lucide_file_text,null,Modifier.padding(start=9.dp).size(18.dp));Text(file.name,Modifier.widthIn(max=170.dp).padding(8.dp),maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=13.sp);IconButton(onClick={vm.removeUpload(file.id)},modifier=Modifier.size(48.dp)){ModernIcon(R.drawable.ic_lucide_x,"移除文件",Modifier.size(16.dp))}}}}}
                    val backendNotice=if(s.backends.isEmpty()&&s.modelsFallback)"" else nativeBackendReason(s.harness,s.models,s.backends)
                    if(backendNotice.isNotBlank())NativeBackendNotice(backendNotice,Modifier.padding(horizontal=12.dp,vertical=4.dp).testTag("backend-availability-notice"))
                    }
                    NativeComposerTextField(
                        s.draft,vm::draft,if(s.running)"添加下一步任务…" else "描述任务…",
                        maxLines=if(imeVisible)4 else 6,
                        modifier=Modifier.fillMaxWidth().padding(start=12.dp,end=12.dp,top=10.dp,bottom=6.dp).testTag("composer").semantics{contentDescription="消息输入框"}.focusProperties{canFocus=!openingDrawer&&drawer.currentValue==DrawerValue.Closed&&drawer.targetValue==DrawerValue.Closed}.focusRequester(composerFocus).onFocusChanged{composerFocused=it.isFocused}.bringIntoViewRequester(composerIntoView).heightIn(min=26.dp,max=if(imeVisible)80.dp else 120.dp),
                    )
                    }
                    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("composerActions"),verticalAlignment=Alignment.CenterVertically){
                        Box{
                            ChromeButton(R.drawable.ic_lucide_plus,"添加附件",{val now=android.os.SystemClock.uptimeMillis();if(attachmentOpen){attachmentOpen=false;attachmentDismissedAt=now}else if(now-attachmentDismissedAt>300)attachmentOpen=true})
                            ModernDropdown(attachmentOpen,{attachmentOpen=false;attachmentDismissedAt=android.os.SystemClock.uptimeMillis()},220.dp){
                                Column(Modifier.padding(6.dp)){
                                    PopupMenuRow(R.drawable.ic_lucide_camera,"拍照"){attachmentOpen=false;if(supportsCameraImage())takePhoto()}
                                    PopupMenuRow(R.drawable.ic_lucide_images,"图片与视频"){attachmentOpen=false;chooseAttachment(NativePickKind.MEDIA)}
                                    PopupMenuRow(R.drawable.ic_lucide_folder_open,"文件"){attachmentOpen=false;chooseAttachment(NativePickKind.FILES)}
                                }
                            }
                        }
                        val hasInput=s.draft.isNotBlank()||s.images.isNotEmpty()||s.uploads.isNotEmpty()
                        val model=s.models.find{it.id==s.model}
                        Spacer(Modifier.weight(1f))
                        Box{
                            Row(Modifier.widthIn(max=184.dp).heightIn(min=48.dp).clip(Radius.Button).clickable{showModelList=false;modelMenu=true;vm.refreshBackends();if(!s.fastBusy)vm.loadFast(force=true)}.padding(horizontal=10.dp),verticalAlignment=Alignment.CenterVertically){
                                if(s.harness=="codex"&&(s.fastMode?:s.sessionFast)==true)ModernIcon(R.drawable.ic_lucide_zap,"Fast 已开启",Modifier.padding(end=4.dp).size(14.dp),Accent)
                                val showEffort=s.effort.isNotBlank()&&(model?.efforts?.size?:0)>=2
                                val effortBadge=showEffort&&(s.effort=="max"||s.effort=="ultra")
                                Text((model?.let(::nativeModelDisplayName)?:"选择模型")+(if(showEffort&&!effortBadge)" · "+effortName(s.effort) else ""),Modifier.weight(1f,false),fontSize=13.sp,color=Ink,maxLines=1,overflow=TextOverflow.Ellipsis)
                                if(effortBadge)NativeEffortBadge(s.effort,Modifier.padding(start=5.dp))
                                ModernIcon(R.drawable.ic_lucide_chevron_down,null,Modifier.padding(start=3.dp).size(15.dp),Muted)
                            }
                            ModernDropdown(modelMenu,{modelMenu=false;showModelList=false},280.dp,scrollable=false){
                                if(s.backendStatusError.isNotBlank()){
                                    Text(s.backendStatusError,Modifier.padding(horizontal=12.dp,vertical=8.dp),fontSize=12.sp,color=MaterialTheme.colors.error)
                                    TextButton(onClick={vm.refreshBackends(force=true)},enabled=!s.backendStatusLoading){Text("重新读取模型")}
                                }
                                NativeModelControls(
                                    models=s.models.filter{it.available&&it.harness==s.harness},model=model,effort=s.effort,
                                    fast=s.fastMode?:s.sessionFast,showFast=s.harness=="codex",fastEnabled=s.connected&&!s.fastBusy,
                                    showModels=showModelList,onShowModels={showModelList=it},
                                    onModel={vm.chooseModel(it);showModelList=false},onEffort=vm::effort,onFast=vm::toggleFast,
                                    onSettings={modelMenu=false;vm.loadRemoteApproval();settings=true}
                                )
                            }
                        }
                        val stop=s.running&&!hasInput
                        val composerGate=nativeComposerGate(s.connected,s.sending,s.uploading,s.stopping,hasInput,stop){
                            nativeModelSelectionError(s.harness,s.model,s.models).isBlank()
                        }
                        val enabled=composerGate.enabled
                        RecordNativeComposerState(composerGate,vm.uiForeground)
                        val action=when {s.stopping->ComposerAction.Progress;stop->ComposerAction.Stop;s.sending||s.uploading->ComposerAction.Progress;else->ComposerAction.Send}
                        NativeComposerAction(action,if(s.stopping)"正在停止任务" else if(stop)"停止任务" else if(s.running)"加入队列" else "发送消息",enabled,
                            {if(stop)vm.stop() else{haptics.virtualKey();val command=if(s.harness=="codex")nativeExactCommand(s.draft) else null;if(command!=null)executeCommand(command.name,true) else {val jumpToLatest=!s.running;vm.send();if(jumpToLatest)sendScrollRequest++}}},Modifier.padding(start=4.dp))
                    }
                }}
                NativeSlashCommandPopup(commands){executeCommand(it,true)}
                }
                Spacer(Modifier.height(2.dp))
                }
            }
            if(splitSide&&sideController!=null)key(sideController){NativeManagementPage("侧聊","",vm::returnFromSideChat,modifier=Modifier.width(360.dp).fillMaxHeight(),actions={NativeSideChatMenu(sideController)}){
                NativeSideChatContent(sideController,Modifier.weight(1f).padding(top=LocalNativeManagementTopInset.current),vm,s.models)
            }
            }
            }
            if(sideVisible&&!splitSide&&sideController!=null)key(sideController){Sheet("侧聊",vm::returnFromSideChat,stableHeight=true,bodyScrollState=null,contentHorizontalPadding=16.dp,
                titleContent={NativeSideChatTitle(sideController)},
                bodyPadding=PaddingValues(0.dp)){NativeSideChatContent(sideController,Modifier.weight(1f),vm,s.models)}}
        }
        if(commandPanel.isNotEmpty())Sheet(when(commandPanel){"help"->"命令";"goal"->"会话目标";"pin"->"置顶会话";else->"会话状态"},{commandPanel=""},inPlace=commandPanel=="goal",dismissEnabled=!goalCommandSaving){
            when(commandPanel){
                "help"->nativeCommands.forEach{command->NativeCommandRow(command)}
                "pin"->Text("发送第一条消息建立会话后，即可置顶。",color=Muted)
                "goal"->{
                    if(s.threadId.isBlank())Text("新会话可在输入框直接使用 /goal 目标内容 创建目标。",color=Muted)
                    else {
                        NativeGoalEditContent(commandGoal,{if(!goalCommandSaving){commandGoal=it;goalCommandError=""}},goalCommandSaving,vm.goalWorkBusy(s.threadId),goalCommandError,"希望持续完成的目标","保存目标"){
                            if(!goalCommandSaving){goalCommandSaving=true;goalCommandError="";vm.updateGoal(s.threadId,objective=commandGoal.trim(),onSaved={goalCommandSaving=false;commandPanel=""},onFailed={goalCommandSaving=false;goalCommandError=it})}
                        }
                        if(s.threads.any{it.id==s.threadId&&it.goal!=null})TextButton(onClick={vm.updateGoal(s.threadId,status="complete");commandPanel=""},enabled=s.connected&&!goalCommandSaving&&!vm.goalWorkBusy(s.threadId)){Text("结束目标")}
                    }
                }

            }
        }
        NativeSettingsNavigation(managementPage){page->
            val back={openManagement("home")}
            when(page){
                "home"->NativeSettingsHome(s.connected,s.capabilities,{managementPage=""},::openManagement,
                    vm.appUpdates.state.release?.takeIf{it.code>vm.appUpdates.currentCode}?.version.orEmpty())
                "accounts"->NativeAccountsRoute(vm,back)
                "all-quotas"->NativeAllQuotas(vm,back){source->quotaUsageSource=source;openManagement("quota-usage")}
                "quota-usage"->NativeStatisticsManagement(vm,{openManagement("all-quotas")},initialSource=quotaUsageSource)
                "agents"->NativeAgentManagement(vm,back)
                "assistant"->NativeAssistantManagement(vm,back)
                "extensions"->NativeExtensionsManagement(vm,back)
                "diagnostics"->NativeDiagnosticsManagement(vm,back)
                "sessions"->NativeSessionManagement(vm,back)
                "channels"->NativeChannelManagement(vm,back)
                "harnesses"->NativeHarnessManagement(vm,back)
                "agent-instructions"->NativeAgentInstructions(vm,s.harness,""){openManagement("home")}
                "session-instructions"->NativeAgentInstructions(vm,instructionAgent,instructionThread){managementPage=""}
                "statistics"->NativeStatisticsManagement(vm,back)
                "archives"->{
                    val active=LocalManagementPageActive.current
                    LaunchedEffect(s.connected,s.harness,active){if(s.connected&&active)vm.loadArchivedThreads()}
                    NativeArchivedThreads(vm.archivedThreads,vm.archivedThreadsLoading,vm.archivedThreadsError,s.connected,
                        vm::loadArchivedThreads,vm::restoreArchivedThread,back)
                }
                "quota"->if("local-console-management" in s.capabilities)LocalConsoleRoute(vm,back){NativeUsage(vm)} else NativeManagementPage("用量与额度","",back){Column(Modifier.weight(1f).clipToBounds().nativeManagementScroll(rememberScrollState()).padding(16.dp)){NativeUsage(vm)}}
                "automations"->NativeAutomations(vm,back)
                "quota-warmup"->NativeQuotaWarmupPage(vm,back)
                "console"->LocalConsoleRoute(vm,back)
                "app-update"->NativeAppUpdatePage(vm.appUpdates,back)
                "harness-visibility"->NativeHarnessVisibilityPage(vm.hiddenHarnesses,vm::setHarnessVisible,back)
                "appearance"->NativeAppearancePage(appearance,themeStore.state,
                    onAppearance=::changeAppearance,onTheme=themeStore::select,
                    onImport={themePicker.launch(arrayOf("application/json","text/plain","application/octet-stream"))},
                    onExport={themeToExport=themeDefinition;themeExporter.launch(themeDefinition.id.removePrefix("custom:")+".json")},
                    onRemove={scope.launch{themeStore.removeSelected()}},onBack=back)
                "storage"->NativeManagementPage("存储与缓存","",back){
                    LaunchedEffect(vm,s.connected,s.address){vm.refreshStorage();vm.refreshUploadStorage()}
                    Column(Modifier.weight(1f).nativeManagementScroll(rememberScrollState()).padding(16.dp)){
                        key(s.address,s.certificateSha256){NativeStorageContent(vm.storageState.copy(busy=vm.storageState.busy||s.fileBusy),vm::setCacheLimit,vm::clearStorage,
                            vm.uploadStorageState.copy(busy=vm.uploadStorageState.busy||s.uploading),{vm.refreshUploadStorage()},{vm.refreshUploadStorage(it)})}
                    }
                }
            }
        }
        val closing=vm.subagentClose
        if(closing.thread!=null)NativeAlertDialog(onDismissRequest=vm::dismissSubagentClose,
            title={Text(if(closing.confirmStop)"停止并关闭子代理" else "关闭子代理")},
            text={Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
                Text(subagentLabel(closing.thread))
                if(closing.confirmStop)Text("该子代理仍在运行。停止后从列表移除，会话历史保留。")
                if(closing.busy){CircularProgressIndicator(Modifier.size(24.dp),strokeWidth=2.dp);Text(closing.message)}
                if(closing.error.isNotBlank())Text(closing.error,color=MaterialTheme.colors.error)
            }},
            confirmButton={if(closing.confirmStop)TextButton(onClick={vm.completeSubagentClose(true)}){Text("停止该子代理并关闭")}
                else if(closing.error.isNotBlank())TextButton(onClick={vm.closeSubagent(closing.thread)}){Text("重试")}},
            dismissButton={if(!closing.busy)TextButton(onClick=vm::dismissSubagentClose){Text("取消")}})
        if(projectMenu)NativeWorkspacePicker((s.sidebarProjects+s.projects).distinctBy{nativePath(it.path)},s.projects.find{it.id==s.projectId}?.path.orEmpty(),s.moreProjects,s.loadingSidebar,
            {projectMenu=false},{project->projectMenu=false;vm.selectNewProject(project)},
            {projectMenu=false;newProjectPath="";createProjectOpen=true},vm::loadMoreProjects)
        if(createProjectOpen)CompactForm("新建工作区",{createProjectOpen=false}){
            Box{TextButton(onClick={parentMenu=true}){Text("选择父目录")};ModernDropdown(parentMenu,{parentMenu=false},280.dp){Column(Modifier.heightIn(max=260.dp).verticalScroll(rememberScrollState())){(s.sidebarProjects+s.projects).map{it.path.replace('\\','/').substringBeforeLast('/')}.distinct().filter{it.isNotBlank()}.forEach{p->PopupMenuRow(R.drawable.ic_lucide_folder,p){newProjectPath=p;parentMenu=false}}}}}
            Entry(newProjectPath,{newProjectPath=it},"父目录，也可手动输入",modifier=Modifier.fillMaxWidth())
            Entry(newProjectName,{newProjectName=it},"工作区名称",modifier=Modifier.fillMaxWidth().padding(top=10.dp))
            val validName=newProjectName.trim().let{it.isNotBlank()&&it!="."&&it!=".."&&it.none{c->c in "\\/:*?\"<>|"}}
            Button(onClick={vm.createNewProject(newProjectPath.trimEnd('/','\\')+"/"+newProjectName.trim()){createProjectOpen=false;newProjectName=""}},enabled=newProjectPath.isNotBlank()&&validName&&!vm.currentWorkBusy(),modifier=Modifier.fillMaxWidth().padding(top=12.dp)){Text(if(vm.currentWorkBusy())"正在创建…" else "创建并选择")}
            if(s.error.isNotBlank())Text(s.error,color=MaterialTheme.colors.error,fontSize=12.sp)
        }
        if(projectToolsOpen)Sheet("项目工具",{projectToolsOpen=false}){
            if(s.connected&&s.projectId.isNotBlank()&&!readOnly){
                if("diff" in s.capabilities)ActionRow(R.drawable.ic_lucide_file_diff,"查看改动"){projectToolsOpen=false;vm.diff();workPanel="改动"}
                if("terminal-pty" in s.capabilities)ActionRow(R.drawable.ic_lucide_terminal,"项目终端"){projectToolsOpen=false;vm.openTerminal();workPanel="终端"}
            }else Text("连接电脑并选择项目后使用",fontSize=14.sp,color=Muted)
        }
        selectedThread?.let{thread->
            var name by remember(thread.id){mutableStateOf(thread.title)}
            CompactForm("重命名会话",{selectedThread=null}){
                Entry(name,{name=it},"会话名称",modifier=Modifier.fillMaxWidth())
                Button(onClick={vm.renameThread(thread,name);selectedThread=null},enabled=name.isNotBlank()&&!vm.currentWorkBusy(),modifier=Modifier.fillMaxWidth().padding(top=12.dp)){Text("保存")}
            }
        }
        movingThread?.let{thread->Sheet("移动到项目或分区",{movingThread=null}){
            Text(nativeDisplayThreadTitle(thread.title,"会话"),fontSize=13.sp,color=Muted,maxLines=2,overflow=TextOverflow.Ellipsis,modifier=Modifier.padding(bottom=8.dp))
            Text("项目",fontSize=12.sp,color=Muted,modifier=Modifier.padding(vertical=6.dp))
            (s.sidebarProjects+s.projects).distinctBy{nativePath(it.path)}.forEach{project->
                ActionRow(R.drawable.ic_lucide_folder,project.name+if(nativePath(project.path)==nativePath(thread.projectPath))" · 当前项目" else ""){
                    vm.moveThreadToProject(thread,project);movingThread=null
                }
            }
            if(s.sidebarProjects.isEmpty()&&s.projects.isEmpty())Text("尚未添加项目，请先新建工作区。",fontSize=14.sp,color=Muted)
            if(s.moreProjects)TextButton(onClick=vm::loadMoreProjects,enabled=!s.loadingSidebar){Text("加载更多项目")}
            Divider(Modifier.padding(vertical=8.dp),color=GlassEdge)
            Text("分区",fontSize=12.sp,color=Muted,modifier=Modifier.padding(vertical=6.dp))
            ActionRow(R.drawable.ic_lucide_list_todo,"不分区"){vm.moveThreadToSection(thread,null);movingThread=null}
            vm.threadSections.forEach{section->ActionRow(R.drawable.ic_lucide_list_todo,section.name){vm.moveThreadToSection(thread,section.id);movingThread=null}}
        }}
        LaunchedEffect(s.threadId,s.connected,s.harness){vm.loadFast()}
        LaunchedEffect(harnessOpen,s.connected){if(harnessOpen&&s.connected)vm.refreshBackends()}
        if(networkOpen)Sheet("Clash 节点",{networkOpen=false},stableHeight=true){NativeNetworkPanel(vm.networkState,s.connected,{vm.loadNetwork()},vm::loadNetwork,vm::selectNetworkNode,vm::testNetworkNode)}
        LaunchedEffect(s.threadId,s.connected,s.harness,s.running){if(s.connected&&s.threadId.isNotBlank()&&(!s.running||s.usage==null))vm.loadUsage(changed=!s.running)}
        LaunchedEffect(connectionReady,s.connected,s.harness){if(connectionReady&&connectionOpen&&s.connected){
            if(s.harness=="codex")vm.refreshCodex() else vm.refreshBackends()
            if(s.threadId.isNotBlank()&&!s.usageLoading)vm.loadUsage()
        }}
        LaunchedEffect(s.connected,s.address,s.capabilities){if(s.connected&&"capacity-auto-retry" in s.capabilities){vm.loadCapacityRetry();vm.loadRemoteApproval()}}
        if(quotaOpen)Sheet("账号额度",{quotaOpen=false},stableHeight=true,onEntered={vm.loadUsage()}){NativeUsage(vm)}
        automationSheetThread?.let{threadId->key(threadId){NativeAutomationsSheet(vm,threadId){automationSheetThread=null}}}
        if(connectionOpen)Sheet(if(s.threadId.isBlank())"连接状态" else "会话状态",{connectionOpen=false},stableHeight=true,onEntered={connectionReady=true}){
            if(s.threadId.isNotBlank()){
                DashboardTabs(listOf("connection" to "连接","context" to "上下文"),sessionTab,{sessionTab=it},Modifier.testTag("sessionTabs"))
                Spacer(Modifier.height(16.dp))
            }
            if(s.threadId.isNotBlank()&&sessionTab=="context"){
                NativeSessionOverview(s,s.connected&&!s.running&&!vm.currentWorkBusy(),vm::compactContext)
                Spacer(Modifier.height(12.dp))
            }
            if(s.threadId.isBlank()||sessionTab=="connection")NativeLiquidSurface(shape=Radius.Section,color=Wash,kind=NativeGlassKind.INSET,modifier=Modifier.fillMaxWidth().testTag("sessionConnectionSection")){
            Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
            Text("电脑连接",fontSize=15.sp,fontWeight=FontWeight.Medium)
            Text(if(s.connected)"网关在线 · ${if(s.activeAddress==s.publicUrl)"公网" else "内网"}" else if(s.connecting)"正在连接${if(s.activeAddress==s.publicUrl&&s.publicUrl.isNotBlank())"公网" else "内网"}网关" else "网关未连接",fontSize=14.sp,color=Ink)
            if(s.connected&&s.harness=="codex"){
                Text(when{ s.codexStarting->"正在启动 Codex…";s.codexStatusLoading->"正在检查 Codex…";s.codexStatusError.isNotBlank()->s.codexStatusError;s.codexReady->"Codex 已连接";else->"Codex 未连接，待发消息已保留"},fontSize=14.sp,color=if(s.codexStatusError.isNotBlank())MaterialTheme.colors.error else Muted,modifier=Modifier.testTag("codexConnectionStatus"))
                if(s.codexStatusError.isNotBlank())TextButton(onClick={vm.refreshCodex()},enabled=!s.codexStarting&&!s.codexStatusLoading){Text("重新检查")}
                TextButton(onClick={vm.startDesktopCodex()},enabled=!s.codexStarting){Text(if(s.codexStarting)"正在启动 Codex…" else if(s.codexReady)"刷新 Codex 连接" else "远程启动 Codex")}
                if("shared-backend-restart" in s.capabilities){
                    TextButton(onClick={vm.sharedBackendRestart()},enabled=!s.backendRestart.busy&&!s.codexStarting,modifier=Modifier.testTag("sharedBackendRestart")){Text(if(s.backendRestart.busy)"正在检查…" else "重启 Codex")}
                    if(s.backendRestart.error.isNotBlank())Text(s.backendRestart.error,color=MaterialTheme.colors.error,fontSize=12.sp)
                    if(s.backendRestart.done)Text("共享后端已重启",color=Muted,fontSize=12.sp)
                }
            }
            if(s.connected&&s.harness!="codex"){
                val ready=nativeBackendAvailable(s.harness,s.models,s.backends)
                Text(when{ s.backendStatusLoading->"正在检查 ${nativeAgentName(s.harness)}…";s.backendStatusError.isNotBlank()->s.backendStatusError;ready->"${nativeAgentName(s.harness)} 已就绪";else->"${nativeAgentName(s.harness)} 不可用"},fontSize=14.sp,color=if(s.backendStatusError.isNotBlank())MaterialTheme.colors.error else Muted,modifier=Modifier.testTag("harnessConnectionStatus"))
                if(!ready)NativeBackendNotice(nativeBackendReason(s.harness,s.models,s.backends))
                TextButton(onClick={vm.refreshBackends(force=true)},enabled=!s.backendStatusLoading){Text("重新检查 ${nativeAgentName(s.harness)}")}
            }
            if(s.error.isNotBlank())Text(s.error,fontSize=12.sp,color=MaterialTheme.colors.error)
            if("capacity-auto-retry" in s.capabilities){
                Divider(Modifier.padding(vertical=8.dp),color=Muted.copy(alpha=.12f))
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    Column(Modifier.weight(1f).padding(end=12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                        Text("模型繁忙自动重试",fontSize=14.sp,fontWeight=FontWeight.Medium)
                        Text("持续等待容量恢复，可随时停止",fontSize=11.sp,color=Muted)
                    }
                    DashboardSwitch(s.capacityAutoRetry,vm::setCapacityAutoRetry,enabled=s.connected&&!s.capacityRetryBusy,modifier=Modifier.testTag("capacityAutoRetry"))
                }
                if(s.capacityRetryError.isNotBlank())Text(s.capacityRetryError,color=MaterialTheme.colors.error,fontSize=12.sp)
            }
            NativeConnectionRoutes(s.route,s.connecting,s.publicUrl.isNotBlank()&&s.remotePassword.isNotBlank(),vm::connectRoute)
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                TextButton(onClick={connectionOpen=false;networkOpen=true;vm.loadNetwork("openai")},enabled=s.connected){Text("OpenAI 节点")}
                TextButton(onClick={connectionOpen=false;networkOpen=true;vm.loadNetwork("google")},enabled=s.connected){Text("Google 节点")}
            }
            PublicConnectionTest(vm,s.publicUrl,s.remotePassword,connect={connectionOpen=false;pairing=true})
            if(s.error.isNotBlank())TextButton(onClick={vm.error("")}){Text("清除提示")}
            }}
        }

        if(s.connected&&s.backendRestart.planId.isNotBlank())CompactForm("重启 Codex",vm::dismissBackendRestart){
            Text(if(!s.backendRestart.canRestart)"仍有 ${s.backendRestart.blockingCount} 个会话正在运行或状态异常，结束后再重试。" else if(s.backendRestart.desktopRunning)"将重启桌面端与共享 CLI，完成后恢复桌面窗口。会话记录保留，连接会短暂断开。" else "将重启共享 CLI。桌面端当前未运行，重启后保持关闭。会话记录保留，连接会短暂断开。",fontSize=14.sp,color=Muted)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){
                TextButton(onClick=vm::dismissBackendRestart,enabled=!s.backendRestart.busy){Text("取消")}
                Button(onClick={vm.sharedBackendRestart(confirm=true)},enabled=s.backendRestart.canRestart&&!s.backendRestart.busy,modifier=Modifier.testTag("confirmSharedBackendRestart")){Text(if(s.backendRestart.busy)"正在重启…" else "重启")}
            }
        }
        val openTaskNotice:(TaskNotification)->Unit={notice->
            vm.dismissTaskNotice(notice.key)
            if(notice.questionId.isNotBlank()){
                dismissedApprovalKey="";managementPage="";settings=false;workPanel=""
                connectionOpen=false;quotaOpen=false;harnessOpen=false;networkOpen=false;pairing=false
                vm.closeAutomations();scope.launch{drawer.close()}
            }
            vm.openNotificationThread(notice.threadId)
        }
        val taskNoticeOverlay:@Composable ()->Unit={NativeTaskNotice(s.taskNotice,vm::dismissTaskNotice,openTaskNotice)}
        if(s.markdown==null&&s.pdf==null&&s.openedImage==null)taskNoticeOverlay()
        s.editingMessage?.takeIf{it.threadId==s.threadId}?.let{event->Sheet("编辑消息",vm::cancelMessageEdit,inPlace=true){
            Text("保存后替换最后一条消息并重新回复",color=Muted,fontSize=13.sp)
            Entry(s.messageEditText,vm::messageEditText,"消息内容",Modifier.fillMaxWidth().heightIn(max=240.dp).verticalScroll(rememberScrollState()).testTag("messageEditText"))
            if(s.messageEditImages.isNotEmpty())NativeImageGallery(vm,s.messageEditImages.map{"/api/uploads/images/${it.id}"}){endpoint->vm.removeImage(endpoint.substringAfterLast('/'))}
            (s.messageEditUploads.map{it.id to it.name}+s.messageEditAttachments.map{it.path to it.name}).forEach{(id,name)->
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    ModernIcon(R.drawable.ic_lucide_file_text,null,Modifier.size(18.dp))
                    Text(name,Modifier.weight(1f).padding(horizontal=10.dp),fontSize=13.sp,maxLines=2,overflow=TextOverflow.Ellipsis)
                    IconButton(onClick={if(s.messageEditUploads.any{it.id==id})vm.removeUpload(id)else vm.removeMessageEditAttachment(id)},enabled=!s.uploading){ModernIcon(R.drawable.ic_lucide_x,"移除附件",Modifier.size(18.dp))}
                }
            }
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                ChromeButton(R.drawable.ic_lucide_images,"添加照片",{chooseAttachment(NativePickKind.MEDIA)},enabled=!s.uploading)
                ChromeButton(R.drawable.ic_lucide_file_text,"添加文件",{chooseAttachment(NativePickKind.FILES)},enabled=!s.uploading)
                ChromeButton(R.drawable.ic_lucide_camera,"拍照",{if(supportsCameraImage())takePhoto()},enabled=!s.uploading)
            }
            if(s.uploading)Text(s.uploadMessage,color=Muted,fontSize=12.sp)
            if(s.uploadError.isNotBlank())Text(s.uploadError,color=MaterialTheme.colors.error,fontSize=12.sp)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){
                TextButton(onClick=vm::cancelMessageEdit){Text("取消")}
                Button(onClick=vm::saveMessageEdit,enabled=s.connected&&!s.sending&&!s.running&&!s.uploading&&(s.messageEditText.isNotBlank()||s.messageEditImages.isNotEmpty()||s.messageEditUploads.isNotEmpty()||s.messageEditAttachments.isNotEmpty()),modifier=Modifier.testTag("messageEditSave")){Text("保存并发送")}
            }
        }}
        if(pairing) NativePairingSheet(vm){pairing=false}
        if(settings)NativeModelSettings(vm){settings=false}
        if(workPanel.isNotEmpty()){
            val workspaceScroll=rememberScrollState()
            val fileList=workPanel=="文件"&&s.file==null
            Sheet(workPanel,{workPanel=""},stableHeight=true,bodyScrollState=if(fileList)null else workspaceScroll,onBack=::backInWorkspace){
                Crossfade(targetState=workPanel,animationSpec=tween(180),label="workPanel"){panel->
                    NativeWorkspace(vm,panel,if(fileList)Modifier.fillMaxSize() else Modifier.fillMaxWidth())
                }
            }
        }
        if(approvalSheetVisible&&pendingApproval!=null)Sheet(if(pendingApproval.approvalType=="question")"需要你的回答" else "需要你的确认",{dismissedApprovalKey=pendingApprovalKey},inPlace=questionSheetVisible){
            if(pendingApproval.approvalType=="question")NativeQuestions(vm,pendingApproval)
            else {Text(pendingApproval.title,fontSize=16.sp,fontWeight=FontWeight.Medium);if(pendingApproval.detail.isNotBlank())Text(pendingApproval.detail,Modifier.padding(vertical=10.dp),fontSize=14.sp);Row{TextButton(enabled=!vm.currentWorkBusy(),onClick={haptics.longPress();vm.approve(pendingApproval.approvalId,false)}){Text("拒绝")};ApprovalButton(enabled=!vm.currentWorkBusy(),onClick={haptics.longPress();vm.approve(pendingApproval.approvalId,true)}){Text("允许")}}}
        }
        goalEditor?.let{objective->Sheet("编辑目标",{goalEditor=null},inPlace=true,dismissEnabled=!goalSaving){
            NativeGoalEditContent(objective,{if(!goalSaving){goalEditor=it;goalError=""}},goalSaving,vm.goalWorkBusy(s.threadId),goalError,"目标内容","保存"){
                if(!goalSaving){goalSaving=true;goalError="";vm.updateGoal(s.threadId,objective=objective.trim(),onSaved={goalSaving=false;goalEditor=null},onFailed={goalSaving=false;goalError=it})}
            }
        }}
        s.outputDirectory?.let{directory->NativeOutputDirectoryPreview(directory,s.fileBusy,s.fileMessage,s.fileError,
            vm::openOutputDirectoryEntry,vm::outputDirectory,vm::retryFile,vm::closeOutputDirectory)}
        s.markdown?.let{NativeDocumentPreview(vm,it,vm::closeMarkdown,overlay=taskNoticeOverlay.takeIf{s.pdf==null&&s.openedImage==null})}
        s.pdf?.let{pdf->key(pdf){NativePdfPreview(pdf,vm::closePdf,overlay=taskNoticeOverlay.takeIf{s.openedImage==null})}}
        s.openedImage?.let{image->key(image.endpoint){NativeImagePreview(image.bitmap,vm,image.endpoint,vm::closeImage,image.endpoints,image.endpoints.indexOf(image.endpoint).coerceAtLeast(0),image.thumbnails,overlay=taskNoticeOverlay)}}
        LaunchedEffect(s.fileFeedbackVisible,s.fileBusy,s.fileError,s.markdown){
            if(s.fileFeedbackVisible&&!s.fileBusy&&s.markdown==null){delay(5000);vm.hideFileFeedback()}
        }
        if(s.fileFeedbackVisible&&s.markdown==null&&s.outputDirectory==null&&workPanel!="文件"){
        val feedbackBackdrop=LocalNativeOverlayBackdrop.current?:LocalNativeGlassBackdrop.current
        androidx.compose.ui.window.Popup(alignment=Alignment.BottomCenter){
            CompositionLocalProvider(LocalNativeGlassBackdrop provides feedbackBackdrop){
            NativeFileFeedback(s.fileBusy,s.fileMessage,s.fileError,vm::retryFile,vm::hideFileFeedback,
                Modifier.padding(horizontal=16.dp,vertical=16.dp).navigationBarsPadding().imePadding())
            }
        }
        }
        }
        NativeSheetPortal(sheetHost,suspended=s.markdown!=null||s.pdf!=null||s.openedImage!=null)
    }
}
}
}
@Composable internal fun NativeFileFeedback(busy:Boolean,message:String,error:String,onRetry:()->Unit,onDismiss:()->Unit,modifier:Modifier=Modifier,kind:NativeGlassKind=NativeGlassKind.MENU){
    NativeLiquidSurface(modifier.fillMaxWidth().testTag("fileFeedback"),shape=Radius.Notice,kind=kind){
        Row(Modifier.padding(start=16.dp,end=4.dp,top=4.dp,bottom=4.dp),verticalAlignment=Alignment.CenterVertically){
            if(busy)CircularProgressIndicator(Modifier.padding(end=8.dp).size(16.dp),strokeWidth=2.dp,color=Muted)
            Text(if(busy)message else "文件操作失败：$error",Modifier.weight(1f).padding(vertical=10.dp),fontSize=13.sp,color=Ink,maxLines=3,overflow=TextOverflow.Ellipsis)
            if(!busy){
                TextButton(onClick=onRetry){Text("重试")}
                IconButton(onClick=onDismiss,modifier=Modifier.size(48.dp)){ModernIcon(R.drawable.ic_lucide_x,"关闭文件提示",Modifier.size(16.dp),Muted)}
            }
        }
    }
}
@Composable internal fun NativeUploadError(message:String,onDismiss:()->Unit){
    var details by remember(message){mutableStateOf(false)}
    Row(Modifier.fillMaxWidth().padding(vertical=4.dp).clip(Radius.Field).background(MaterialTheme.colors.error.copy(alpha=0.07f)).padding(start=8.dp).testTag("uploadError"),verticalAlignment=Alignment.CenterVertically){
        ModernIcon(R.drawable.ic_lucide_circle_alert,null,Modifier.size(16.dp),MaterialTheme.colors.error)
        Text(message.substringBefore("\n\n"),Modifier.weight(1f).padding(horizontal=8.dp,vertical=6.dp),fontSize=12.sp,color=Ink,maxLines=2,overflow=TextOverflow.Ellipsis)
        TextButton(onClick={details=true}){Text("详情",fontSize=12.sp)}
        IconButton(onClick=onDismiss,modifier=Modifier.size(48.dp)){ModernIcon(R.drawable.ic_lucide_x,"关闭上传提示",Modifier.size(16.dp),Muted)}
    }
    if(details)Sheet("附件上传失败",{details=false}){NativeErrorDetail(ChatEvent(type="error",threadId="",detail=message))}
}
@Composable internal fun NativeUploadStatus(message:String,progress:NativeUploadProgress?,onCancel:()->Unit){
    val fraction=progress?.totalBytes?.takeIf{it>0}?.let{(progress.sentBytes.toDouble()/it).toFloat().coerceIn(0f,1f)}
    val detail=when{
        progress?.waitingForResponse==true->"等待电脑确认"
        fraction!=null->"${(fraction*100).toInt()}%"
        progress!=null->"已传输 ${android.text.format.Formatter.formatShortFileSize(LocalContext.current,progress.sentBytes)}"
        else->""
    }
    Row(Modifier.fillMaxWidth().padding(start=6.dp).testTag("uploadStatus"),verticalAlignment=Alignment.CenterVertically){
        if(fraction!=null&&progress?.waitingForResponse!=true)CircularProgressIndicator(fraction,Modifier.size(14.dp),strokeWidth=2.dp,color=Muted)
        else CircularProgressIndicator(Modifier.size(14.dp),strokeWidth=2.dp,color=Muted)
        Text(listOf(message,detail).filter{it.isNotBlank()}.joinToString(" · "),Modifier.weight(1f).padding(horizontal=8.dp),fontSize=12.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
        TextButton(onClick=onCancel,modifier=Modifier.testTag("cancelUpload")){Text("取消",fontSize=12.sp)}
    }
}
@Composable private fun NativeWelcome(harness:String){
    Column(Modifier.fillMaxWidth().padding(horizontal=24.dp,vertical=24.dp),horizontalAlignment=Alignment.CenterHorizontally){
        NativeHarnessIcon(harness,Modifier.size(40.dp),AppColor.PlaceholderIcon)
        Spacer(Modifier.height(16.dp))
        Text(if(harness=="codex")"开始构建" else "开始新任务",fontSize=25.sp,fontWeight=FontWeight.Medium)
    }
}
@Composable private fun NativeWorkspaceControl(project:Project?,enabled:Boolean,choose:()->Unit,modifier:Modifier=Modifier){
    Row(modifier.fillMaxWidth().heightIn(min=40.dp).clip(Radius.Control).clickable(enabled=enabled,onClick=choose).padding(horizontal=9.dp,vertical=8.dp).testTag("workspaceControl"),verticalAlignment=Alignment.CenterVertically){
        ModernIcon(R.drawable.ic_lucide_folder,null,Modifier.size(16.dp),Muted)
        Text(project?.name?:"选择工作区",Modifier.weight(1f).padding(horizontal=8.dp),fontSize=13.sp,color=if(project==null)Muted else Ink,maxLines=1,overflow=TextOverflow.Ellipsis)
        ModernIcon(R.drawable.ic_lucide_chevron_down,"选择工作区",Modifier.size(14.dp),Muted)
    }
}
@Composable private fun NativeWorkspacePicker(projects:List<Project>,selectedPath:String,hasMore:Boolean,loading:Boolean,close:()->Unit,select:(Project?)->Unit,create:()->Unit,loadMore:()->Unit){
    var query by remember{mutableStateOf("")}
    val matching=projects.filter{query.isBlank()||it.name.contains(query,true)||it.path.contains(query,true)}
    Sheet("工作区",close){
        Entry(query,{query=it},"搜索名称或路径",modifier=Modifier.fillMaxWidth().padding(bottom=12.dp),label="搜索工作区")
        if(query.isBlank())ActionRow(if(selectedPath.isBlank())R.drawable.ic_lucide_check else R.drawable.ic_lucide_folder,"不选择工作区"){select(null)}
        matching.forEach{project->
            val selected=selectedPath.isNotBlank()&&nativePath(project.path)==nativePath(selectedPath)
            Row(Modifier.fillMaxWidth().testTag("workspace:${project.id}").clip(Radius.Control).clickable{select(project)}.padding(horizontal=10.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){
                ModernIcon(R.drawable.ic_lucide_folder,null,Modifier.size(19.dp),Muted)
                Column(Modifier.weight(1f).padding(horizontal=12.dp)){
                    Text(project.name,fontSize=15.sp,fontWeight=if(selected)FontWeight.Medium else FontWeight.Normal,maxLines=1,overflow=TextOverflow.Ellipsis)
                    Text(nativeDisplayPath(project.path),Modifier.padding(top=3.dp),fontSize=12.sp,color=Muted,maxLines=2,overflow=TextOverflow.Ellipsis)
                }
                if(selected)ModernIcon(R.drawable.ic_lucide_check,"已选择",Modifier.size(18.dp))
            }
        }
        if(matching.isEmpty())Text(if(query.isBlank())"尚未添加工作区" else "没有匹配的工作区",Modifier.padding(horizontal=10.dp,vertical=16.dp),fontSize=14.sp,color=Muted)
        if(hasMore)TextButton(onClick=loadMore,enabled=!loading,modifier=Modifier.fillMaxWidth()){Text(if(loading)"加载中…" else "加载更多工作区")}
        Divider(Modifier.padding(vertical=8.dp),color=GlassEdge)
        ActionRow(R.drawable.ic_lucide_plus,"新建工作区"){create()}
    }
}
@Composable private fun NativeQueueDock(vm:NativeViewModel,queue:List<NativeQueued>,running:Boolean,onEdit:(NativeQueued)->Unit){
    val clipboard=LocalClipboardManager.current
    val operationId=vm.queuedOperationId()
    vm.queuedRestoreNotice().takeIf{it.isNotBlank()}?.let{notice->Text(notice,Modifier.padding(horizontal=18.dp,vertical=4.dp).testTag("queuedRestoreNotice"),fontSize=12.sp,color=Muted)}
    AnimatedVisibility(queue.isNotEmpty(),enter=fadeIn(tween(120)),exit=androidx.compose.animation.ExitTransition.None) {Column(Modifier.padding(horizontal=16.dp).heightIn(max=104.dp).verticalScroll(rememberScrollState())){queue.forEach{q->key(q.id){
                    NativeLiquidSurface(modifier=Modifier.testTag("queued:${q.id}").fillMaxWidth().padding(vertical=2.dp).height(42.dp),shape=Radius.Card,color=Wash,kind=NativeGlassKind.DOCK){
                    Row(Modifier.fillMaxWidth().padding(start=12.dp,end=2.dp),verticalAlignment=Alignment.CenterVertically){ModernIcon(R.drawable.ic_lucide_clock_3,null,Modifier.size(16.dp),Muted);Text(q.text.ifBlank{"${q.images.size} 张图片 · ${q.uploads.size} 个文件"},Modifier.weight(1f).padding(start=8.dp),maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=13.sp);if(operationId==q.id||q.status=="sending"||q.error.isNotBlank()||q.status=="failed")Text(if(operationId==q.id)"处理中" else if(q.status=="sending")"发送中" else "待处理",fontSize=11.sp,color=Muted,maxLines=1,modifier=Modifier.padding(start=6.dp))
                        var show by remember(q.id){mutableStateOf(false)}
                        Box{
                            Box(Modifier.size(34.dp).clip(Radius.Button).clickable{show=true},contentAlignment=Alignment.Center){ModernIcon(R.drawable.ic_lucide_ellipsis,"待发消息操作",Modifier.size(18.dp),Muted)}
                            ModernDropdown(show,{show=false},218.dp){Column(Modifier.padding(6.dp)){
                                if(q.error.isNotBlank()){
                                    Text(nativeQueueError(q.error),Modifier.padding(10.dp),fontSize=12.sp,color=Muted,maxLines=3,overflow=TextOverflow.Ellipsis)
                                    PopupMenuRow(R.drawable.ic_lucide_copy,"复制错误详情"){clipboard.setText(AnnotatedString(q.error));show=false}
                                }
                                PopupMenuRow(R.drawable.ic_lucide_copy,"复制文字"){clipboard.setText(AnnotatedString(q.text));show=false}
                                PopupMenuRow(R.drawable.ic_lucide_square_pen,"编辑消息"){show=false;onEdit(q)}
                                if(q.status!="sending"&&operationId.isEmpty()){
                                if(q.canSteer)PopupMenuRow(R.drawable.ic_lucide_corner_down_right,"改为引导"){show=false;vm.queueAction(q,"steer")}
                                if(!running&&q.status!="failed"&&queue.firstOrNull()?.id==q.id)PopupMenuRow(R.drawable.ic_lucide_corner_down_right,"发送下一条"){show=false;vm.queueAction(q,"retry")}
                                if(queue.indexOf(q)>0&&queue[queue.indexOf(q)-1].status!="sending")PopupMenuRow(R.drawable.ic_lucide_arrow_up,"上移"){show=false;vm.moveQueued(q,"up")}
                                if(queue.indexOf(q)<queue.lastIndex)PopupMenuRow(R.drawable.ic_lucide_arrow_down,"下移"){show=false;vm.moveQueued(q,"down")}
                                if(q.status=="failed")PopupMenuRow(R.drawable.ic_lucide_rotate_cw,"重试"){show=false;vm.queueAction(q,"retry")}
                                PopupMenuRow(R.drawable.ic_lucide_x,"取消发送",danger=true){show=false;vm.queueAction(q,"delete")}
                                }
                            }}
                        }
                    }
                    }
                }}}}
}
@Composable internal fun NativeGoalEditContent(objective:String,change:(String)->Unit,saving:Boolean,busy:Boolean,error:String,hint:String,saveLabel:String,modifier:Modifier=Modifier,save:()->Unit){
    Column(modifier.fillMaxWidth()){
        Entry(objective,change,hint,modifier=Modifier.fillMaxWidth().testTag("goalEditor"),enabled=!saving)
        if(error.isNotBlank())Text(error,Modifier.padding(top=10.dp).testTag("goalSaveError"),color=MaterialTheme.colors.error,fontSize=13.sp)
        Button(onClick=save,enabled=objective.isNotBlank()&&!saving&&!busy,modifier=Modifier.fillMaxWidth().padding(top=12.dp).testTag("goalSave")){Text(if(saving)"保存中…" else saveLabel)}
    }
}
@Composable internal fun NativeGoalDock(vm:NativeViewModel,threadId:String,goal:NativeGoal,onEdit:(String)->Unit={}){
    var expanded by remember(threadId){mutableStateOf(false)}
    val expansion=updateTransition(expanded,label="goalExpansion")
    val chevronAngle=expansion.animateFloat(transitionSpec={chevronMotion()},label="goalChevron"){if(it)90f else 0f}
    val expandInteraction=remember{MutableInteractionSource()}
    val expandPressed by expandInteraction.collectIsPressedAsState()
    val pressFill=animateColorAsState(if(expandPressed)Ink.copy(alpha=0.06f) else Color.Transparent,tween(if(expandPressed)80 else 120,easing=ControlEase),label="goalPress")
    val status=when(goal.status){"active"->if(vm.state.running)"进行中" else "已就绪";"paused"->"已暂停";"blocked"->"受阻";"usage_limited"->"用量限制";"budget_limited"->"预算限制";else->goal.status}
    Column(Modifier.fillMaxWidth().padding(horizontal=12.dp,vertical=4.dp)){
        NativeLiquidSurface(shape=Radius.Composer,color=Wash,kind=NativeGlassKind.DOCK,modifier=Modifier.fillMaxWidth().testTag("goalChip")){
            Column {Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Row(Modifier.fillMaxWidth().testTag("goalExpand").clip(Radius.Composer).drawBehind{drawRect(pressFill.value)}.clickable(interactionSource=expandInteraction,indication=null){expanded=!expanded}.padding(horizontal=12.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically){
                ModernIcon(R.drawable.ic_lucide_circle_dot,null,Modifier.size(18.dp).testTag("goalHeaderIcon"),Muted)
                NativeGoalHeaderText("目标：${goal.objective}",14.sp,Ink,Modifier.weight(1f).padding(start=8.dp).testTag("goalHeaderTitle"))
                NativeGoalElapsed(threadId,goal,vm.state.connected&&vm.state.running)
                NativeGoalHeaderText(status,12.sp,Muted,Modifier.padding(start=8.dp).testTag("goalHeaderStatus"))
                ModernIcon(R.drawable.ic_lucide_chevron_right,null,Modifier.padding(start=2.dp).size(16.dp).graphicsLayer{rotationZ=chevronAngle.value},Muted)
                }
            }
            expansion.AnimatedVisibility(visible={it},enter=disclosureEnter(),exit=disclosureExit()){Column(Modifier.padding(start=12.dp,end=12.dp,bottom=2.dp),verticalArrangement=Arrangement.spacedBy(2.dp)){
                SelectionContainer{Text(goal.objective,Modifier.testTag("goalObjective"),fontSize=14.sp,lineHeight=21.sp)}
                if(goal.tokenBudget!=null)Text("已用 ${nativeTokenCount(goal.tokensUsed)} / ${nativeTokenCount(goal.tokenBudget)} tokens",fontSize=12.sp,color=Muted)
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){TextButton(onClick={onEdit(goal.objective)},enabled=!vm.goalWorkBusy(threadId),contentPadding=PaddingValues(horizontal=8.dp,vertical=4.dp),modifier=Modifier.testTag("goalEdit").semantics{contentDescription="编辑目标"}){Text("修改",fontSize=13.sp)};TextButton(onClick={if(goal.status=="active")vm.updateGoal(threadId,status="paused") else vm.continueGoal(threadId)},enabled=vm.state.connected&&!vm.goalWorkBusy(threadId),contentPadding=PaddingValues(horizontal=8.dp,vertical=4.dp),modifier=Modifier.testTag("goalContinue")){Text(if(vm.goalWorkBusy(threadId))"处理中…" else if(goal.status=="active")"暂停" else "继续",fontSize=13.sp)};TextButton(onClick={vm.updateGoal(threadId,status="complete")},enabled=vm.state.connected&&!vm.goalWorkBusy(threadId),contentPadding=PaddingValues(horizontal=8.dp,vertical=4.dp),modifier=Modifier.testTag("goalClose").semantics{contentDescription="关闭目标"}){Text("关闭目标",fontSize=13.sp)}}
                vm.goalError(threadId).takeIf{it.isNotBlank()}?.let{Text(it,Modifier.testTag("goalActionError").padding(bottom=8.dp),fontSize=12.sp,color=MaterialTheme.colors.error)}
            }} }
        }
    }
}
@Composable internal fun NativeSessionId(id:String,modifier:Modifier=Modifier){
    val density=LocalDensity.current
    val measurer=rememberTextMeasurer()
    val style=androidx.compose.material.LocalTextStyle.current
    BoxWithConstraints(modifier){
        val available=with(density){(maxWidth-1.dp).roundToPx()}
        val size=remember(id,available,density,measurer,style){
            (0..14).map{(12f-it*0.25f).sp}.firstOrNull{candidate->
                measurer.measure(id,style.copy(fontFamily=FontFamily.Monospace,fontSize=candidate,letterSpacing=0.sp),softWrap=false,maxLines=1).size.width<=available
            }?:8.5.sp
        }
        // Keep UUIDs intact at normal widths; very large accessibility fonts can scroll.
        Text(id,fontFamily=FontFamily.Monospace,fontSize=size,letterSpacing=0.sp,maxLines=1,softWrap=false,
            modifier=Modifier.horizontalScroll(rememberScrollState()).testTag("sessionContextId"))
    }
}
@Composable private fun NativeToolbarText(text:String,size:TextUnit,lineHeight:TextUnit,weight:FontWeight,color:Color,modifier:Modifier=Modifier){
    val density=LocalDensity.current
    val typeface=androidx.compose.ui.platform.LocalFontFamilyResolver.current.resolve(FontFamily.Default,weight).value as android.graphics.Typeface
    val leftBearing=remember(text,size,density,typeface){
        val paint=android.graphics.Paint().apply{this.typeface=typeface;textSize=with(density){size.toPx()}}
        android.graphics.Rect().also{paint.getTextBounds(text,0,text.length,it)}.left
    }
    // CJK and Latin glyphs start at different offsets inside their text boxes.
    // Align their visible left edges using the same font Android renders.
    Text(text,fontSize=size,lineHeight=lineHeight,fontFamily=FontFamily.Default,fontWeight=weight,color=color,
        style=TextStyle(platformStyle=PlatformTextStyle(includeFontPadding=false)),maxLines=1,overflow=TextOverflow.Ellipsis,
        modifier=modifier.layout{measurable,constraints->
            val child=measurable.measure(constraints)
            layout(child.width,child.height){child.placeRelative(-leftBearing,0)}
        })
}
@Composable private fun NativeGoalHeaderText(text:String,size:TextUnit,color:Color,modifier:Modifier=Modifier,monospace:Boolean=false){
    val density=LocalDensity.current
    val ink=remember(text,size,density,monospace){
        val paint=android.graphics.Paint().apply{
            textSize=with(density){size.toPx()}
            typeface=if(monospace)android.graphics.Typeface.MONOSPACE else android.graphics.Typeface.DEFAULT
        }
        android.graphics.Rect().also{paint.getTextBounds(text,0,text.length,it)}
    }
    // Latin digits and CJK text have different ink bounds even on one baseline.
    // Place the visible glyphs around the row centre, matching the adjacent icons.
    Text(text,color=color,fontSize=size,fontWeight=FontWeight.Normal,fontFamily=if(monospace)FontFamily.Monospace else FontFamily.Default,
        style=TextStyle(lineHeight=20.sp,platformStyle=PlatformTextStyle(includeFontPadding=false)),maxLines=1,overflow=TextOverflow.Ellipsis,
        modifier=modifier.layout{measurable,constraints->
            val child=measurable.measure(constraints)
            val offset=(child.height/2f-child[FirstBaseline]-(ink.top+ink.bottom)/2f).roundToInt()
            layout(child.width,child.height){child.placeRelative(0,offset)}
        })
}
@Composable private fun NativeGoalElapsed(threadId:String,goal:NativeGoal,running:Boolean){
    val clock=remember(threadId,goal.id){GoalRunClock()}
    var seconds by remember(threadId,goal.id){mutableStateOf(goal.timeUsedSeconds)}
    val active=goal.status=="active"&&running
    LaunchedEffect(clock,goal.timeUsedSeconds,active){
        do {
            seconds=clock.sample(goal.timeUsedSeconds,active,android.os.SystemClock.elapsedRealtime())
            if(!active||seconds==null)break
            delay(1000)
        }while(true)
    }
    goalRunTime(seconds)?.let{description->
        val elapsed=seconds!!.coerceAtLeast(0)
        val label="${elapsed/3600}:${(elapsed%3600/60).toString().padStart(2,'0')}:${(elapsed%60).toString().padStart(2,'0')}"
        NativeGoalHeaderText(label,11.sp,Muted,Modifier.padding(start=6.dp).testTag("goalRunTime").semantics{contentDescription=description},monospace=true)
    }
}
@Composable private fun NativeModelSettings(vm:NativeViewModel,close:()->Unit){
    val s=vm.state
    val routeHints=remember(s.models){nativeModelRouteHints(s.models)}
    val model=s.models.find{it.id==s.model}
    var expanded by remember{mutableStateOf(false)}
    var search by remember{mutableStateOf("")}
    Sheet("模型与思考强度",close){
        Text("模型",fontSize=13.sp,color=Muted,modifier=Modifier.padding(start=4.dp,bottom=8.dp,top=8.dp))
        Row(Modifier.fillMaxWidth().clip(Radius.Section).background(MaterialTheme.colors.surface).clickable{expanded=!expanded}.padding(horizontal=16.dp,vertical=15.dp),verticalAlignment=Alignment.CenterVertically){
            Text(model?.let(::nativeModelDisplayName)?:"选择模型",Modifier.weight(1f),fontSize=16.sp,fontWeight=FontWeight.Medium,maxLines=2,overflow=TextOverflow.Ellipsis)
            ModernIcon(if(expanded)R.drawable.ic_lucide_chevron_up else R.drawable.ic_lucide_chevron_down,"选择模型",Modifier.size(20.dp),Muted)
        }
        AnimatedVisibility(expanded,enter=disclosureEnter(),exit=disclosureExit()){Column{
            Spacer(Modifier.height(8.dp));Entry(search,{search=it},"搜索模型")
            val matches=s.models.filter{it.available&&it.harness==s.harness&&listOf(it.name,it.id,it.providerName,it.providerId,nativeModelDisplayName(it)).any{name->name.contains(search,true)}}
            if(matches.isEmpty())Text("没有匹配的模型",color=Muted,modifier=Modifier.padding(12.dp))
            Column(Modifier.heightIn(max=220.dp).verticalScroll(rememberScrollState()).padding(top=4.dp)){
                nativeModelGroups(matches).forEach{group->
                    if(group.name.isNotBlank())Text(group.name,Modifier.fillMaxWidth().padding(horizontal=14.dp,vertical=8.dp).testTag("settingsModelProvider:${group.id}"),fontSize=12.sp,fontWeight=FontWeight.Medium,color=Muted)
                    group.models.forEach{m->Row(Modifier.fillMaxWidth().clip(Radius.Field).clickable{vm.chooseModel(m.id);expanded=false;search=""}.padding(horizontal=14.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){
                    Column(Modifier.weight(1f)){
                        Text(nativeModelDisplayName(m),fontSize=15.sp)
                        routeHints[m.id]?.let{Text(it,Modifier.padding(top=3.dp),fontSize=11.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)}
                    }
                    if(m.id==s.model)ModernIcon(R.drawable.ic_lucide_check,null,Modifier.size(19.dp))
                    }}
                }
            }
        }}
        val efforts=model?.efforts.orEmpty()
        EffortSlider(efforts,s.effort,vm::effort)
        Text("执行权限",fontSize=13.sp,color=Muted,modifier=Modifier.padding(start=4.dp,top=22.dp,bottom=8.dp))
        Text(if(s.harness=="antigravity")"工具操作自动执行；更改对新任务生效" else "对新任务生效",fontSize=12.sp,color=Muted,modifier=Modifier.padding(start=4.dp,bottom=8.dp))
        Column(Modifier.fillMaxWidth().clip(Radius.Section).background(MaterialTheme.colors.surface)){
            (if(s.harness=="antigravity")listOf("auto" to "自动审批","full" to "完全访问") else listOf("ask" to "询问","auto" to "自动审批","full" to "完全访问")+if(s.harness=="codex")listOf("custom" to "自定义 (config.toml)")else emptyList()).forEach{(value,label)->
                Row(Modifier.fillMaxWidth().clickable{vm.permission(value)}.padding(horizontal=16.dp,vertical=13.dp),verticalAlignment=Alignment.CenterVertically){
                    Text(label,Modifier.weight(1f),fontSize=15.sp)
                    if(s.permission==value)ModernIcon(R.drawable.ic_lucide_check,"已选择",Modifier.size(18.dp),Accent)
                }
            }
        }
        if(s.harness=="codex"){
            Row(Modifier.fillMaxWidth().padding(top=18.dp,bottom=4.dp).clip(Radius.Section).background(MaterialTheme.colors.surface).padding(horizontal=16.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text("自动处理 Codex 审批",fontSize=15.sp);Text(if(s.approvalBridgeConnected)"桌面审批通道已连接" else if(s.approvalBridgeConfigured)"桌面审批通道未连接，重启电脑端 Codex 后生效" else "桌面审批桥接尚未安装",fontSize=12.sp,color=Muted)};ModernToggle(s.desktopAutoApprove,s.connected&&!s.remoteApprovalBusy,vm::setRemoteAutoApproval)}
            Text("自动批准操作申请，提问仍需回答",fontSize=12.sp,color=Muted,modifier=Modifier.padding(horizontal=4.dp,vertical=8.dp))
        }
        val context=LocalContext.current
        val notifyPrefs=context.getSharedPreferences("native",0)
        var backgroundNotify by remember{mutableStateOf(notifyPrefs.getBoolean("notify.background",false))}
        Row(Modifier.fillMaxWidth().padding(top=18.dp,bottom=4.dp).clip(Radius.Section).background(MaterialTheme.colors.surface).padding(horizontal=16.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text("后台提醒",fontSize=15.sp);Text(if(backgroundNotify)"电脑端请求审批或完成任务时会发送系统通知" else "连接电脑后，在通知栏提醒审批请求与任务完成",fontSize=12.sp,color=Muted)};ModernToggle(backgroundNotify,true){enabled->
            backgroundNotify=enabled
            notifyPrefs.edit().putBoolean("notify.background",enabled).apply()
            if(enabled){
                NotificationHelper.ensureChannels(context)
                runCatching{context.startForegroundService(android.content.Intent(context,NotificationMonitorService::class.java))}
            } else runCatching{context.stopService(android.content.Intent(context,NotificationMonitorService::class.java))}
        }}
    }
}
@Composable private fun NativeThreadRow(t:ThreadRecord,selected:Boolean=false,open:()->Unit,rename:()->Unit,pin:()->Unit,modifier:Modifier=Modifier,pulse:State<Float>?=null,manage:(String)->Unit={}){
    var menu by remember(t.id){mutableStateOf(false)}
    val haptics=rememberHaptics()
    val liquid=LocalNativeTheme.current.floating
    val selection=if(liquid)Ink.copy(alpha=.07f) else if(MaterialTheme.colors.isLight)AppColor.SelectionLight else AppColor.SelectionDark
    val interaction=remember{MutableInteractionSource()}
    val pressed by interaction.collectIsPressedAsState()
    val rowColor=animateColorAsState(if(pressed)Ink.copy(alpha=0.12f) else if(selected)selection else Color.Transparent,tween(if(pressed)80 else 180,easing=ControlEase),label="threadSelection")
    Box(modifier.fillMaxWidth()){
        Row(Modifier.fillMaxWidth().testTag("threadRow:${t.id}").clip(if(liquid)Radius.Field else Radius.Button).drawBehind{drawRect(rowColor.value)}.combinedClickable(interactionSource=interaction,indication=null,onClick=open,onLongClick={haptics.longPress();menu=true}).heightIn(min=48.dp).padding(vertical=11.dp,horizontal=12.dp),verticalAlignment=Alignment.CenterVertically){
            if(t.pinnedIndex>=0)ModernIcon(R.drawable.ic_lucide_pin,null,Modifier.padding(end=8.dp).size(14.dp),Muted)
            val title=(if(t.source=="cloudCodex")"云端 · " else if(t.readOnly)"云端快照 · " else "")+nativeDisplayThreadTitle(subagentLabel(t),"新会话")
            if(t.status=="running")NativeRunningTitle(title,pulse,Modifier.weight(1f),fontWeight=if(selected)FontWeight.Medium else FontWeight.Normal)
            else Text(title,fontSize=15.sp,fontWeight=if(selected)FontWeight.Medium else FontWeight.Normal,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f))
            if(t.status!="running"&&t.unread)Box(Modifier.padding(start=10.dp).size(6.dp).testTag("threadUnread:${t.id}").semantics{contentDescription="完成未读"}.background(Accent,CircleShape))
        }
        NativeThreadActionsMenu(t,menu,{menu=false},rename,pin,manage)
    }
}
@Composable private fun NativeThreadActionsMenu(t:ThreadRecord,expanded:Boolean,dismiss:()->Unit,rename:()->Unit,pin:()->Unit,manage:(String)->Unit){
    val clipboard=LocalClipboardManager.current
    val codex=nativeThreadAgent(t.id)=="codex"
    ModernDropdown(expanded,dismiss,210.dp){Column(Modifier.padding(6.dp)){
        if(!t.readOnly){
            PopupMenuRow(R.drawable.ic_lucide_pin,if(t.pinnedIndex>=0)"取消置顶" else "置顶"){dismiss();pin()}
            if(codex){
                PopupMenuRow(R.drawable.ic_lucide_folder,"移动到项目或分区"){dismiss();manage("move")}
            }
            PopupMenuRow(R.drawable.ic_lucide_circle_dot,if(t.unread)"标记为已读" else "标记为未读"){dismiss();manage(if(t.unread)"read" else "unread")}
            PopupMenuRow(R.drawable.ic_lucide_pencil,"重命名"){dismiss();rename()}
        }
        PopupMenuRow(R.drawable.ic_lucide_copy,"复制会话 ID"){clipboard.setText(AnnotatedString(t.id));dismiss()}
        if(!t.readOnly){
            if(t.status in setOf("running","starting")||t.goal?.status=="active")Text("运行中，请先停止再归档",Modifier.padding(10.dp),fontSize=12.sp,color=Muted)
            else PopupMenuRow(R.drawable.ic_lucide_archive,"归档"){dismiss();manage("archive")}
        }
    }}
}
@Composable internal fun NativeConversationAgents(threads:List<ThreadRecord>,threadId:String,open:(ThreadRecord)->Unit,modifier:Modifier=Modifier,onClose:(ThreadRecord)->Unit={}){
    val children=remember(threads,threadId){conversationRunningAgents(threads,threadId)}
    val parents=remember(threads){threads.associateBy{it.id}}
    var expanded by remember(threadId,children.isEmpty()){mutableStateOf(false)}
    if(children.isEmpty())return
    Box(modifier.testTag("conversationAgents")){
        ChromeControl({expanded=!expanded},false,Modifier.testTag("conversationAgentsToggle").semantics{contentDescription="子代理 · ${children.size}"}){
            Box(Modifier.size(40.dp),contentAlignment=Alignment.Center){
                ModernIcon(R.drawable.ic_lucide_bot,null,Modifier.size(21.dp).testTag("conversationAgentsIcon"),Muted)
                // The badge never participates in positioning the toolbar icon.
                Box(Modifier.align(Alignment.TopEnd).heightIn(min=14.dp).widthIn(min=14.dp)
                    .background(Ink.copy(alpha=0.06f),CircleShape).padding(horizontal=2.dp),contentAlignment=Alignment.Center){
                    Text(if(children.size>99)"99+" else children.size.toString(),fontSize=8.sp,lineHeight=9.sp,fontWeight=FontWeight.Medium,color=Muted,maxLines=1)
                }
            }
        }
        ModernDropdown(expanded,{expanded=false},280.dp,placement=NativePopupPlacement.ADJACENT){Column(Modifier.padding(6.dp)){
            children.forEach{child->
                Row(Modifier.fillMaxWidth().testTag("conversationAgent:${child.id}").clip(Radius.Field).clickable{expanded=false;open(child)}.padding(horizontal=10.dp,vertical=11.dp),verticalAlignment=Alignment.CenterVertically){
                    Column(Modifier.weight(1f)){
                        Text(subagentLabel(child),fontSize=14.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                        val parent=parents[child.subagent?.parentThreadId]?.takeIf{it.id!=threadId}
                        Text(if(parent==null)"进行中" else "进行中 · ${subagentLabel(parent)}",fontSize=12.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
                    }
                    if(!child.readOnly&&nativeThreadAgent(child.id) in setOf("codex","zcode"))ChromeButton(R.drawable.ic_lucide_x,"关闭子代理",{onClose(child)},modifier=Modifier.testTag("closeSubagent:${child.id}"))
                    else ModernIcon(R.drawable.ic_lucide_chevron_right,null,Modifier.size(16.dp),Muted)
                }
            }
        }}
    }
}

@Composable private fun NativeSidebarThemeToggle(mode:String,dark:Boolean,onChange:(String)->Unit,modifier:Modifier=Modifier){
    val next=when(mode){"system"->"light";"light"->"dark";else->"system"}
    val currentLabel=if(mode=="system")"自动（${if(dark)"深色" else "浅色"}）" else if(dark)"深色" else "浅色"
    val nextLabel=when(next){"light"->"浅色";"dark"->"深色";else->"自动"}
    IconButton(onClick={onChange(next)},modifier=modifier.size(48.dp).testTag("sidebarAppearanceToggle")
        .semantics{stateDescription=currentLabel}){
        Box(Modifier.size(24.dp)){
            ModernIcon(if(dark)R.drawable.ic_lucide_moon else R.drawable.ic_lucide_sun,
                "切换为${nextLabel}模式",Modifier.align(Alignment.Center).size(20.dp),Muted)
            if(mode=="system")Text("A",Modifier.align(Alignment.BottomEnd).offset(x=5.dp,y=3.dp).semantics{invisibleToUser()},
                fontSize=8.sp,lineHeight=9.sp,fontWeight=FontWeight.Bold,color=Ink)
        }
    }
}

@Composable private fun NativeSidebarAction(icon:Int,label:String,status:Color?=null,action:()->Unit){
    val feedback=rememberHaptics()
    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).clip(Radius.Field).clickable{feedback.keyTap();action()}
        .padding(horizontal=12.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically){
        ModernIcon(icon,null,Modifier.size(20.dp),Muted)
        Text(label,Modifier.weight(1f).padding(start=12.dp),fontSize=14.sp,color=Ink)
        if(status!=null)Box(Modifier.size(6.dp).background(status,CircleShape))
    }
}

@Composable internal fun NativeSidebarAgent(thread:ThreadRecord,parent:ThreadRecord?,open:()->Unit,close:()->Unit){
    Row(Modifier.fillMaxWidth().testTag("sidebarAgent:${thread.id}").clip(Radius.Field).clickable(onClick=open).padding(start=13.dp,top=5.dp,bottom=5.dp),verticalAlignment=Alignment.CenterVertically){
        ModernIcon(R.drawable.ic_lucide_bot,null,Modifier.size(18.dp),Muted)
        Column(Modifier.weight(1f).padding(horizontal=10.dp,vertical=5.dp)){
            Text(subagentLabel(thread),fontSize=14.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
            val status=when(thread.status){"error","failed"->"失败";"interrupted"->"已停止";"ok","completed"->"已完成";else->"空闲"}
            Text(listOf(status,parent?.let{if(it.subagent!=null)subagentLabel(it) else it.title}.orEmpty()).filter{it.isNotBlank()}.joinToString(" · "),fontSize=12.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
        }
        if(!thread.readOnly&&nativeThreadAgent(thread.id) in setOf("codex","zcode"))IconButton(onClick=close,modifier=Modifier.testTag("closeSidebarAgent:${thread.id}")){ModernIcon(R.drawable.ic_lucide_x,"关闭子代理",Modifier.size(16.dp),Muted)}
    }
}

@Composable internal fun NativeSidebarThread(t:ThreadRecord,selectedId:String,open:(ThreadRecord)->Unit,rename:(ThreadRecord)->Unit,pin:(ThreadRecord)->Unit,goal:Boolean=false,pulse:State<Float>?=null,manage:(ThreadRecord,String)->Unit={_,_->}){
    if(goal){
        var menu by remember(t.id){mutableStateOf(false)}
        Box{NativeGoalRow(t,t.id==selectedId,pulse,onLongClick={menu=true}){open(t)};NativeThreadActionsMenu(t,menu,{menu=false},{rename(t)},{pin(t)},{manage(t,it)})}
    }
    else NativeThreadRow(t,t.id==selectedId,{open(t)},{rename(t)},{pin(t)},pulse=pulse,manage={manage(t,it)})
}
@Composable private fun NativeRemoteMatchRow(match:ThreadMatch,open:()->Unit){
    Row(Modifier.fillMaxWidth().clip(Radius.Field).clickable(onClick=open).padding(vertical=10.dp,horizontal=13.dp),verticalAlignment=Alignment.CenterVertically){
        ModernIcon(R.drawable.ic_lucide_file_text,null,Modifier.size(16.dp),Muted)
        Column(Modifier.weight(1f).padding(start=10.dp)){
            Text(nativeDisplayThreadTitle(match.title,"会话"),fontSize=14.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
            if(match.snippet.isNotBlank())Text(match.snippet,fontSize=12.sp,color=Muted,maxLines=2,overflow=TextOverflow.Ellipsis)
        }
    }
}
@Composable private fun NativeGoalRow(t:ThreadRecord,selected:Boolean,pulse:State<Float>?,onLongClick:()->Unit={},open:()->Unit){
    val interaction=remember{MutableInteractionSource()}
    val pressed by interaction.collectIsPressedAsState()
    val liquid=LocalNativeTheme.current.floating
    val selection=if(liquid)Ink.copy(alpha=.07f) else if(MaterialTheme.colors.isLight)AppColor.SelectionLight else AppColor.SelectionDark
    val background=animateColorAsState(if(pressed)Ink.copy(alpha=0.12f) else if(selected)selection else Color.Transparent,tween(if(pressed)80 else 180,easing=ControlEase),label="goalRowSelection")
    Row(Modifier.fillMaxWidth().testTag("runningThread:${t.id}").clip(Radius.Field).drawBehind{drawRect(background.value)}.combinedClickable(interactionSource=interaction,indication=null,onClick=open,onLongClick=onLongClick).padding(vertical=10.dp,horizontal=12.dp),verticalAlignment=Alignment.CenterVertically){
        Column(Modifier.weight(1f)){
            NativeRunningTitle(nativeDisplayThreadTitle(t.title),pulse,fontSize=14.sp,maxLines=2)
            if(t.projectPath.isNotBlank())Text(t.projectPath.replace('\\','/').trimEnd('/').substringAfterLast('/'),fontSize=12.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
        }
    }
}
@Composable private fun SidebarHeading(title:String,expanded:Boolean,moveUp:(()->Unit)?=null,moveDown:(()->Unit)?=null,toggle:(()->Unit)?){
    var menu by remember{mutableStateOf(false)}
    val chevron=animateFloatAsState(if(expanded)90f else 0f,chevronMotion(),label="sidebarHeadingChevron")
    Box(Modifier.fillMaxWidth().padding(top=8.dp)){
    Row(Modifier.fillMaxWidth().heightIn(min=44.dp).clip(Radius.Field).combinedClickable(onClick={toggle?.invoke()},onLongClickLabel="调整${title}顺序",onLongClick=if(moveUp!=null||moveDown!=null)({menu=true}) else null).padding(horizontal=12.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
        Text(title,Modifier.weight(1f),fontSize=12.sp,fontWeight=FontWeight.Medium,color=Muted)
        if(toggle!=null)ModernIcon(R.drawable.ic_lucide_chevron_right,if(expanded)"收起$title" else "展开$title",Modifier.size(16.dp).graphicsLayer{rotationZ=chevron.value},Muted)
    }
    ModernDropdown(menu,{menu=false},156.dp){Column(Modifier.padding(6.dp)){
        if(moveUp!=null)PopupMenuRow(R.drawable.ic_lucide_arrow_up,"上移"){menu=false;moveUp.invoke()}
        if(moveDown!=null)PopupMenuRow(R.drawable.ic_lucide_arrow_down,"下移"){menu=false;moveDown.invoke()}
    }}
    }
}
@Composable private fun NativeQueuedDraftRecovery(drafts:List<NativeQueued>,onRestore:(NativeQueued)->Unit){
    if(drafts.isEmpty())return
    val clipboard=LocalClipboardManager.current
    Column(Modifier.fillMaxWidth().padding(horizontal=16.dp).heightIn(max=104.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(4.dp)){
        drafts.forEach{draft->key(draft.id){
            NativeLiquidSurface(modifier=Modifier.testTag("queuedDraft:${draft.id}").fillMaxWidth(),shape=Radius.Card,color=Wash,kind=NativeGlassKind.DOCK){
            Row(Modifier.fillMaxWidth().padding(start=12.dp,end=4.dp),verticalAlignment=Alignment.CenterVertically){
                Column(Modifier.weight(1f).padding(vertical=6.dp)){
                    Text(draft.text.ifBlank{"${draft.images.size} 张图片 · ${draft.uploads.size} 个文件"},fontSize=13.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                    Text("已暂停发送，可继续编辑",fontSize=11.sp,color=Muted)
                }
                IconButton(onClick={clipboard.setText(AnnotatedString(draft.text))},modifier=Modifier.size(40.dp)){
                    ModernIcon(R.drawable.ic_lucide_copy,"复制文字",Modifier.size(16.dp),Muted)
                }
                TextButton(onClick={onRestore(draft)}){
                    Text("继续编辑",fontSize=12.sp)
                }
            }
            }
        }}
    }
}
@Composable private fun nativeEffortColor(effort:String,normal:Color):Color=
    if(effort=="ultra"){if(LocalNativeTheme.current.dark)AppColor.UltraDark else AppColor.UltraLight}else normal

@Composable private fun NativeEffortBadge(effort:String,modifier:Modifier=Modifier){
    val color=nativeEffortColor(effort,Ink)
    Text(effortName(effort),modifier.clip(Radius.Chip).background(color.copy(alpha=.10f)).padding(horizontal=7.dp,vertical=2.dp),
        fontSize=11.sp,lineHeight=14.sp,fontWeight=FontWeight.SemiBold,color=color,maxLines=1,
        style=TextStyle(platformStyle=PlatformTextStyle(includeFontPadding=false)))
}

internal fun effortName(s:String)=mapOf("default" to "默认","__default" to "默认","off" to "关闭","none" to "无","minimal" to "极低","low" to "低","medium" to "中","high" to "高","xhigh" to "极高","max" to "Max","ultra" to "Ultra")[s]?:s

@Composable private fun rememberCaretColor():Color{val transition=rememberInfiniteTransition(label="caret");val alpha by transition.animateFloat(0.15f,1f,infiniteRepeatable(tween(600,easing=androidx.compose.animation.core.LinearEasing),RepeatMode.Reverse),label="caretAlpha");return Muted.copy(alpha=alpha)}
private fun streamingText(text:String,caretColor:Color)=buildAnnotatedString{append(text);withStyle(SpanStyle(color=caretColor)){append(" ▍")}}

private data class NativeVisibleRow(val block:NativeBlock,val header:Boolean=false,val activity:NativeActivityItem?=null){
    val key:String get()=activity?.let{"${block.key}:activity:${it.key}"}?:block.key
}

private data class NativeMessageViewState(
    val threadId:String,val events:List<ChatEvent>,val pendingApprovals:List<ChatEvent>,val approvals:Set<String>,
    val approvalResults:Map<String,String>,val desktopAutoApprove:Boolean,
    val running:Boolean,val hasMoreHistory:Boolean,val loadingOlderHistory:Boolean,val loadingHistory:Boolean,
    val pendingMessage:ChatEvent?,val failedMessages:List<ChatEvent>,val historyWindow:Int,val readingKey:String,val sendingStage:String
)
@Composable private fun NativeMessages(vm:NativeViewModel,sendScrollRequest:Int,conversationVisible:Boolean,bottomInset:Dp=0.dp,topInset:Dp=0.dp,onQuestionOpen:()->Unit){
    val liquid=LocalNativeGlassMode.current.floatingChrome
    // The return button samples the opaque chat scene, excluding its own overlay.
    val returnBackdrop=rememberNativeGlassBackdrop(LocalNativeGlassMode.current)
    // Draft, queue and transport changes do not change the conversation rows.
    val s by remember(vm){derivedStateOf{
        val state=vm.state
        NativeMessageViewState(state.threadId,state.events,state.pendingApprovals,state.approvals,state.approvalResults,state.desktopAutoApprove,state.running,
            state.hasMoreHistory,state.loadingOlderHistory,state.loadingHistory,vm.pendingMessage(),vm.failedMessages(),vm.readingHistoryWindow,vm.readingPositionKey(state.threadId),state.sendingStage)
    }}
    val historyFeedback by remember(vm){derivedStateOf{vm.state.let{Triple(it.historyErrors,it.historySyncing&&it.historyErrors.isNotEmpty(),it.connected)}}}
    val list=rememberLazyListState();val scope=rememberCoroutineScope()
    val sceneBackdrop=LocalNativeScrollBackdrop.current
    DisposableEffect(sceneBackdrop,returnBackdrop,list){
        val scrollMotion={list.firstVisibleItemIndex+list.firstVisibleItemScrollOffset}
        val targets=listOfNotNull(sceneBackdrop,returnBackdrop).distinct()
        targets.forEach{it.scrollMotion=scrollMotion}
        onDispose{targets.forEach{if(it.scrollMotion===scrollMotion)it.scrollMotion=null}}
    }
    val positionKey=s.readingKey
    val savedPosition=remember(positionKey){vm.readingPositions.get(positionKey)}
    var restorePending by remember(s.threadId){mutableStateOf(savedPosition!=null&&!savedPosition.followLatest)}
    var presentation by remember(s.threadId){mutableStateOf(Triple(s.events,s.hasMoreHistory,s.loadingOlderHistory))}
    val displayedEvents=presentation.first
    val displayedHasMore=presentation.second
    val displayedLoadingOlder=presentation.third
    // Commit rows and paging chrome together; removing the header a frame earlier moves the viewport.
    LaunchedEffect(s.events,s.hasMoreHistory,s.loadingOlderHistory,list.isScrollInProgress){
        if(!list.isScrollInProgress)presentation=Triple(s.events,s.hasMoreHistory,s.loadingOlderHistory)
    }
    val endTolerance=with(LocalDensity.current){8.dp.roundToPx()}
    val atLatest by remember(list,endTolerance){derivedStateOf{
        val info=list.layoutInfo
        val last=info.visibleItemsInfo.lastOrNull()
        // Content beneath the floating dock is still inside the LazyColumn's
        // viewport. It must clear the reserved padding before following resumes.
        val readableEnd=info.viewportEndOffset-info.afterContentPadding
        // The final 1dp activity spacer is not conversation content.
        !list.canScrollForward || (last!=null&&last.index>=info.totalItemsCount-2&&last.offset+last.size-readableEnd<=endTolerance)
    }}
    var follow by remember(s.threadId){mutableStateOf(savedPosition?.followLatest?:true)}
    var resumeAtBottom by remember(s.threadId){mutableStateOf(false)}
    var returningToLatest by remember(s.threadId){mutableStateOf(false)}
    val unreadResult by remember(vm){derivedStateOf{vm.unreadCompletion(vm.state.threadId)}}
    val sidebarRefreshing by remember(vm){derivedStateOf{vm.state.loadingSidebar}}
    val readableConversation=conversationVisible&&vm.uiForeground&&!s.loadingHistory&&!s.running&&displayedEvents===s.events&&list.layoutInfo.totalItemsCount>0
    LaunchedEffect(s.threadId,unreadResult,readableConversation,sidebarRefreshing,s.events,vm.readableHistory){
        if(unreadResult>0&&readableConversation){delay(250);vm.markResultRead(s.threadId)}
    }
    LaunchedEffect(sendScrollRequest){if(sendScrollRequest>0){follow=true;resumeAtBottom=true;list.scrollToItem((list.layoutInfo.totalItemsCount-1).coerceAtLeast(0))}}
    val pendingMessage=s.pendingMessage
    val failedMessages=s.failedMessages
    val progressLabel=remember(s.events,s.threadId,s.running,s.loadingHistory,pendingMessage,s.sendingStage){
        nativeChatProgressLabel(s.events,s.threadId,s.running,s.loadingHistory,pendingMessage!=null||s.sendingStage.isNotBlank(),s.sendingStage)
    }
    val blocks=remember(displayedEvents,s.pendingApprovals,s.approvals,s.approvalResults,s.desktopAutoApprove,s.running,pendingMessage,failedMessages){
        val existing=displayedEvents.map{it.approvalId}.filter{it.isNotBlank()}.toSet()
        val visibleEvents=nativeApprovalTimelineEvents(displayedEvents,s.pendingApprovals.map{it.approvalId}.toSet(),s.approvals,s.approvalResults,s.desktopAutoApprove)
        val timeline=nativeTimeline(visibleEvents+s.pendingApprovals.filter{it.approvalId !in existing&&it.approvalId !in s.approvals},s.threadId,running=s.running)
        timeline.map{block->
            vm.outgoingKey(block.event)?.let{block.copy(key=it)}?:block
        }+failedMessages.map{NativeBlock(it.eventId,it)}+listOfNotNull(pendingMessage?.let{NativeBlock(it.eventId,it)})
    }
    val visibleRows by remember(vm,s.threadId,blocks){derivedStateOf{
        buildList{
            fun append(block:NativeBlock){
                if(block.children.isNotEmpty()){
                    add(NativeVisibleRow(block,header=true))
                    if(vm.timelineDisclosure(block.event.threadId,"turn",block.key).value)block.children.forEach{append(it)}
                }else if(block.activities.isNotEmpty()){
                    add(NativeVisibleRow(block))
                    if(vm.timelineDisclosure(block.event.threadId,"tools",block.key).value){
                        nativeActivityItems(block.activities).filter{it.type!="reasoning.summary"}.forEach{add(NativeVisibleRow(block,activity=it))}
                    }
                }else{
                    add(NativeVisibleRow(block))
                }
            }
            blocks.forEach{append(it)}
        }
    }}
    val blockKeys=remember(visibleRows){visibleRows.map{it.key}.toSet()}
    val readingState=rememberUpdatedState(Triple(s.loadingHistory,restorePending,follow))
    val readingWindow=rememberUpdatedState(s.historyWindow)
    DisposableEffect(positionKey,list){onDispose{
        val (loading,pending,following)=readingState.value
        if(!loading&&!pending){
            val row=list.layoutInfo.visibleItemsInfo.firstOrNull{it.key!="older"&&it.key!="activity"&&it.key!="historySkeleton"}
            if(row!=null&&s.threadId.isNotBlank())vm.readingPositions.save(positionKey,NativeReadingPosition(row.key.toString(),row.index,-row.offset,following,readingWindow.value))
        }
    }}
    LaunchedEffect(s.loadingHistory,displayedEvents,visibleRows){
        if(restorePending&&!s.loadingHistory&&displayedEvents==s.events&&visibleRows.isNotEmpty()){
            val saved=savedPosition!!
            val header=if(displayedHasMore||displayedLoadingOlder)1 else 0
            val found=visibleRows.indexOfFirst{it.key==saved.anchorKey}
            val index=if(found>=0)found+header else saved.fallbackIndex.coerceIn(header,visibleRows.lastIndex+header)
            list.requestScrollToItem(index,saved.scrollOffset)
            restorePending=false
        }
    }

    val olderAnchor=remember(s.threadId){arrayOfNulls<List<Pair<String,Int>>>(1)}
    fun loadOlder(){
        if(s.loadingOlderHistory||!s.hasMoreHistory)return
        follow=false;resumeAtBottom=false
        // Keep a message in view; the paging button itself may disappear.
        olderAnchor[0]=list.layoutInfo.visibleItemsInfo.filter{it.key in blockKeys}.map{it.key.toString() to it.offset}.takeIf{it.isNotEmpty()}
        vm.loadOlderHistory()
        if(!vm.state.loadingOlderHistory)olderAnchor[0]=null
    }
    val updateOlderAnchor by rememberUpdatedState({
        if(olderAnchor[0]!=null){
            list.layoutInfo.visibleItemsInfo.filter{it.key in blockKeys}.map{it.key.toString() to it.offset}
                .takeIf{it.isNotEmpty()}?.let{olderAnchor[0]=it}
        }
    })
    val requestOlder by rememberUpdatedState({loadOlder()})
    val canPage by rememberUpdatedState(s.hasMoreHistory&&!s.loadingOlderHistory&&!s.loadingHistory)
    var readingOlder by remember(s.threadId){mutableStateOf(false)}
    var olderPageArmed by remember(s.threadId){mutableStateOf(true)}
    val scrollConnection=remember(s.threadId){object:NestedScrollConnection{
        // Reading stays detached from streaming until the user explicitly returns to latest.
        override fun onPreScroll(available:Offset,source:NestedScrollSource):Offset{
            if(source==NestedScrollSource.Drag&&available.y!=0f){readingOlder=available.y>0;resumeAtBottom=available.y<0;follow=false}
            return Offset.Zero
        }
        override fun onPostScroll(consumed:Offset,available:Offset,source:NestedScrollSource):Offset{
            updateOlderAnchor()
            if(source==NestedScrollSource.Drag&&resumeAtBottom&&!returningToLatest&&!readingOlder&&consumed.y+available.y<0&&atLatest)follow=true
            return Offset.Zero
        }
        override suspend fun onPostFling(consumed:androidx.compose.ui.unit.Velocity,available:androidx.compose.ui.unit.Velocity):androidx.compose.ui.unit.Velocity{
            // The older header can enter the viewport on the final fling layout.
            // Keep the gesture intent until that layout is committed, then expire it.
            if(readingOlder){
                withFrameNanos{}
                if(list.layoutInfo.visibleItemsInfo.any{it.key=="older"}&&canPage&&olderPageArmed){
                    olderPageArmed=false
                    requestOlder()
                }
                readingOlder=false
            }
            return androidx.compose.ui.unit.Velocity.Zero
        }
    }}
    LaunchedEffect(s.threadId){
        snapshotFlow{
            val olderVisible=list.layoutInfo.visibleItemsInfo.any{it.key=="older"}
            Triple(olderVisible,readingOlder,canPage)
        }.collect{(olderVisible,reading,canLoad)->
            // A new gesture may request the next page even if the header never left view.
            if(!olderVisible||!canLoad)olderPageArmed=true
            if(olderVisible&&reading&&canLoad&&olderPageArmed){
                olderPageArmed=false
                readingOlder=false
                requestOlder()
            }
        }
    }
    SideEffect{
        val anchors=olderAnchor[0]
        if(anchors!=null&&!s.loadingOlderHistory&&!list.isScrollInProgress&&displayedEvents==s.events){
            val anchor=anchors.firstOrNull{candidate->blockKeys.contains(candidate.first)}
            val index=visibleRows.indexOfFirst{it.key==anchor?.first}
            if(index>=0&&anchor!=null)list.requestScrollToItem(index+if(displayedHasMore||displayedLoadingOlder)1 else 0,-anchor.second)
            olderAnchor[0]=null
        }
    }
    LaunchedEffect(s.threadId){
        snapshotFlow{Triple(list.isScrollInProgress,!atLatest,resumeAtBottom)}.collect{(scrolling,canForward,resume)->
            // Nested-scroll callbacks can run before the final layout/fling settles.
            if(!returningToLatest&&!scrolling&&!canForward&&resume)follow=true
        }
    }
    LaunchedEffect(s.threadId,follow){
        if(follow)snapshotFlow{
            val layout=list.layoutInfo
            Triple(list.isScrollInProgress,layout.totalItemsCount,layout.visibleItemsInfo.lastOrNull()?.let{it.index to (it.offset+it.size)})
        }.collect{(scrolling,count,_)->
            // AndroidView text/table measurement may grow after the events have been committed.
            // A size change can be observed while LazyColumn is laying out. Request
            // the next layout's position instead of forcing a nested measure here.
            if(!scrolling&&count>1&&list.canScrollForward)list.requestScrollToItem(count-1)
        }
    }
    val showReturnToLatest = !follow&&!atLatest&&!returningToLatest
    // 流式排版高峰期“不在底部”可能只维持一两帧；FAB 延迟出现避免闪现，隐藏保持即时。
    var returnToLatestVisible by remember{mutableStateOf(false)}
    LaunchedEffect(showReturnToLatest){
        if(showReturnToLatest){delay(400);returnToLatestVisible=!follow&&!atLatest&&!returningToLatest}
        else returnToLatestVisible=false
    }
    val context=LocalContext.current
    val ink=Ink.toArgb();val wash=Wash.toArgb();val surface=MaterialTheme.colors.surface.toArgb()
    // Reuse the renderer and bounded Markdown cache across conversation switches.
    val renderer=LocalChatMarkwon.current?:remember(context,ink,wash,surface,vm){nativeMarkwon(context,vm::openOutput,ink,wash,surface)}
    val markdownCache=LocalChatMarkdownCache.current?:remember(renderer){NativeMarkdownRenderCache(renderer,background={nativeMarkwon(context,vm::openOutput,ink,wash,surface)})}
    var selectionDocument by remember(s.threadId){mutableStateOf<Triple<String,String,Int>?>(null)}
    selectionDocument?.let{(document,anchor,start)->NativeTextSelection(document,anchor,start){selectionDocument=null}}
    CompositionLocalProvider(LocalChatMarkwon provides renderer,LocalChatMarkdownCache provides markdownCache,LocalNativeTextSelection provides null){
    Column(Modifier.fillMaxSize()){
    Box(Modifier.weight(1f).fillMaxWidth()){
        // Blurring glyphs on a transparent layer leaves the original sharp text
        // visible through its alpha. Include the chat backing in the same sample.
        Box(Modifier.fillMaxSize().nativeGlassSource(returnBackdrop).then(if(liquid)
            Modifier.background(LocalNativeTheme.current.palette.chat).nativeGlassBackdrop() else Modifier)){
        LazyColumn(state=list,modifier=Modifier.testTag("messages").fillMaxSize().then(if(liquid)Modifier.nativeConversationEdgeFade(topInset,bottomInset) else Modifier).nestedScroll(scrollConnection),contentPadding=PaddingValues(start=18.dp,end=18.dp,top=4.dp+topInset,bottom=4.dp+bottomInset),verticalArrangement=Arrangement.spacedBy(8.dp)){
            if(s.loadingHistory&&blocks.isEmpty())item(key="historySkeleton"){HistorySkeleton()}
            if(displayedHasMore||displayedLoadingOlder)item(key="older"){
                Box(Modifier.fillMaxWidth().height(48.dp),contentAlignment=Alignment.Center){
                    Crossfade(displayedLoadingOlder,animationSpec=tween(160,easing=ControlEase),label="olderHistoryLoading"){loading->
                        if(loading)CircularProgressIndicator(Modifier.size(16.dp),strokeWidth=2.dp,color=Muted)
                        else TextButton(onClick={loadOlder()},enabled=!vm.state.historySyncing,modifier=Modifier.fillMaxWidth().height(48.dp)){Text("查看更早记录",fontSize=13.sp,color=Muted)}
                    }
                }
            }
            items(visibleRows,key={it.key},contentType={if(it.header)"turnHeader" else if(it.activity!=null)"activityDetail" else if(it.block.activities.isNotEmpty())"tools" else it.block.event.type}){row->
                if(row.header)NativeCompletedTurnHeader(vm,row.block){follow=false;resumeAtBottom=false}
                else if(row.activity!=null)Box(Modifier.animateItem(fadeInSpec=tween(140),fadeOutSpec=null,placementSpec=null)){
                    NativeActivityDetail(vm,row.activity,row.block.event.threadId,row.block.key){follow=false;resumeAtBottom=false}
                }
                else {
                    val selectReply:((String)->Unit)?=if(row.block.event.type=="message.delta"&&row.block.replyScope.isNotBlank())({anchor->
                        val reply=nativeReplySelection(blocks,row.block.key)
                        if(reply!=null){
                        val within=reply.blockText.indexOf(anchor).coerceAtLeast(0)
                        selectionDocument=Triple(reply.document,anchor,reply.blockStart+within)
                        }
                    })else null
                    CompositionLocalProvider(LocalNativeTextSelection provides selectReply){
                        NativeTimelineBlock(vm,row.block,onQuestionOpen,{follow=false;resumeAtBottom=false},inlineActivities=false)
                    }
                }
            }
            if(progressLabel!=null)item(key="processing"){
                NativeChatProcessing(progressLabel,Modifier.testTag("chatProcessing"))
            }
            item(key="activity") {Spacer(Modifier.height(1.dp))}
        }
        }

        if(historyFeedback.first.isNotEmpty())Box(Modifier.align(Alignment.TopCenter).padding(start=18.dp,end=18.dp,top=topInset+4.dp)){
            CompositionLocalProvider(LocalNativeGlassBackdrop provides returnBackdrop){
            NativeHistoryFeedback(historyFeedback.first,historyFeedback.second,historyFeedback.third,vm::retryHistory)
            }
        }
        androidx.compose.animation.AnimatedVisibility(visible=returnToLatestVisible,modifier=Modifier.align(Alignment.BottomCenter).padding(start=8.dp,end=8.dp,top=8.dp,bottom=bottomInset+8.dp),enter=if(liquid)fadeIn(tween(140)) else fadeIn(tween(140))+scaleIn(initialScale=0.92f,animationSpec=tween(140)),exit=if(liquid)fadeOut(tween(100)) else fadeOut(tween(100))+scaleOut(targetScale=0.92f,animationSpec=tween(100))){
            CompositionLocalProvider(LocalNativeGlassBackdrop provides (returnBackdrop?:LocalNativeGlassBackdrop.current)){
            val fabHaptics=rememberHaptics()
            SmallFloatingActionButton(onClick={
                fabHaptics.virtualKey()
                returningToLatest=true
                scope.launch{
                    try{
                        list.animateScrollToItem((list.layoutInfo.totalItemsCount-1).coerceAtLeast(0))
                        follow=true
                    }catch(_:kotlinx.coroutines.CancellationException){
                        // A direct swipe takes priority over the programmatic return.
                    }finally{returningToLatest=false}
                }
            },modifier=Modifier){ModernIcon(R.drawable.ic_lucide_arrow_down,"回到最新",Modifier.size(22.dp))}
            }
        }
    }
}
}
}
@Composable private fun NativeHistoryFeedback(errors:Map<String,String>,retrying:Boolean,connected:Boolean,onRetry:()->Unit){
    if(errors.isEmpty())return
    var details by remember{mutableStateOf(false)}
    val labels=mapOf("history" to "会话记录","approvals" to "审批","queue" to "待发任务")
    val parts=errors.keys.mapNotNull{labels[it]}.joinToString("、").ifBlank{"会话状态"}
    val summary=if(retrying)"正在更新会话状态" else nativeErrorSummary(errors.values.joinToString("\n"))
    NativeNoticeSurface(if(retrying)Accent else AppColor.StatusWarning,Modifier.fillMaxWidth().testTag("historyFeedback")){
        Row(Modifier.fillMaxWidth().heightIn(min=52.dp).clickable{details=true}.padding(horizontal=12.dp,vertical=4.dp),verticalAlignment=Alignment.CenterVertically){
            ModernIcon(R.drawable.ic_lucide_circle_alert,null,Modifier.size(17.dp),if(retrying)Accent else AppColor.StatusWarning)
            Column(Modifier.weight(1f).padding(start=9.dp),verticalArrangement=Arrangement.spacedBy(2.dp)){
                Text(summary,color=Ink,fontSize=13.sp,fontWeight=FontWeight.Medium,maxLines=1,overflow=TextOverflow.Ellipsis)
                Text(parts,color=Muted,fontSize=11.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
            }
            if(connected)TextButton(onClick=onRetry,enabled=!retrying,modifier=Modifier.testTag("retryHistory")){
                Text(if(retrying)"更新中" else "重试",fontSize=12.sp)
            }else ModernIcon(R.drawable.ic_lucide_chevron_right,"查看更新状态",Modifier.padding(start=8.dp).size(16.dp),Muted)
        }
    }
    if(details)Sheet("同步状态",{details=false}){
        Column(verticalArrangement=Arrangement.spacedBy(16.dp)){
            errors.entries.groupBy{it.value}.forEach{(detail,entries)->key(entries.map{it.key}){
                Column(verticalArrangement=Arrangement.spacedBy(6.dp)){
                    Text(entries.mapNotNull{labels[it.key]}.joinToString("、").ifBlank{"会话状态"},fontSize=13.sp,fontWeight=FontWeight.Medium)
                    NativeErrorDetail(ChatEvent(type="error",threadId="",eventId="sync:"+entries.joinToString(":"){it.key},detail=detail))
                }
            }}
            if(connected)TextButton(onClick=onRetry,enabled=!retrying){Text(if(retrying)"正在更新" else "重新更新")}
        }
    }
}
@Composable internal fun HistorySkeleton(){
    val transition=rememberInfiniteTransition(label="historySkeleton")
    val pulse by transition.animateFloat(initialValue=0.09f,targetValue=0.18f,animationSpec=infiniteRepeatable(tween(1100,easing=FastOutSlowInEasing),RepeatMode.Reverse),label="historySkeletonPulse")
    Column(Modifier.testTag("historySkeleton").fillMaxWidth().padding(vertical=12.dp),verticalArrangement=Arrangement.spacedBy(24.dp)){
        repeat(3){
            Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
                listOf(0.70f,0.85f,0.60f).forEach{fraction->
                    Box(Modifier.fillMaxWidth(fraction).height(12.dp).clip(RoundedCornerShape(6.dp)).background(Muted.copy(alpha=pulse)))
                }
            }
        }
    }
}
@Composable private fun SmallFloatingActionButton(onClick:()->Unit,modifier:Modifier,content:@Composable ()->Unit){
    val floating=LocalNativeGlassMode.current.floatingChrome
    NativeLiquidSurface(modifier.size(48.dp).clip(CircleShape).clickable(onClick=onClick),shape=CircleShape,
        color=MaterialTheme.colors.surface,border=if(floating)null else BorderStroke(1.dp,Ink.copy(alpha=.12f)),
        kind=NativeGlassKind.PANEL){
        CompositionLocalProvider(LocalContentColor provides Ink){Box(contentAlignment=Alignment.Center){content()}}
    }
}
@Composable private fun NativeCompletedTurnHeader(vm:NativeViewModel,block:NativeBlock,onRead:()->Unit){
    var expanded by vm.timelineDisclosure(block.event.threadId,"turn",block.key)
    val title=block.event.title.ifBlank{"处理过程"}
    NativeProcessHeader(title,expanded,{onRead();expanded=!expanded},Modifier.testTag("processToggle:${block.key}").semantics{contentDescription=if(expanded)"收起详情" else "展开详情"})
}
@Composable private fun NativeOverlayClose(close:()->Unit,enabled:Boolean=true,label:String="关闭"){
    IconButton(onClick=close,enabled=enabled,modifier=Modifier.size(48.dp)){
        Box(Modifier.size(32.dp).clip(CircleShape).background(Ink.copy(alpha=.055f)),contentAlignment=Alignment.Center){
            ModernIcon(R.drawable.ic_lucide_x,label,Modifier.size(18.dp),if(enabled)Ink else Muted)
        }
    }
}
@Composable private fun CompactForm(title:String,close:()->Unit,body:@Composable ColumnScope.()->Unit){
    if(LocalNativeGlassMode.current.floatingChrome){Sheet(title,close,body=body);return}
    val backdrop=LocalNativeOverlayBackdrop.current?:LocalNativeGlassBackdrop.current
    Dialog(onDismissRequest=close){NativeDialogSystemBars(Color.Transparent);CompositionLocalProvider(LocalNativeGlassBackdrop provides backdrop){NativeGlassSurface(shape=Radius.Panel,kind=NativeGlassKind.MENU,color=MaterialTheme.colors.surface){Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp)){
        Row(verticalAlignment=Alignment.CenterVertically){Text(title,Modifier.weight(1f),fontSize=20.sp,fontWeight=FontWeight.SemiBold);NativeOverlayClose(close)}
        Spacer(Modifier.height(12.dp));body()
    }}}}
}
@Composable internal fun NativeTimelineBlock(vm:NativeViewModel,block:NativeBlock,onQuestionOpen:()->Unit,onRead:()->Unit={},inlineActivities:Boolean=true){
    if(block.event.type=="files.summary")NativeFileChangeCard(vm,block,onRead=onRead)
    else if(block.children.isNotEmpty()){
        var expanded by vm.timelineDisclosure(block.event.threadId,"turn",block.key)
        Column(Modifier.fillMaxWidth()){
            NativeCompletedTurnHeader(vm,block,onRead)
            AnimatedVisibility(expanded,enter=disclosureEnter(),exit=disclosureExit()){Column(verticalArrangement=Arrangement.spacedBy(10.dp)){block.children.forEach{key(it.key){NativeTimelineBlock(vm,it,onQuestionOpen,onRead)}}}}
        }
    }else if(block.activities.isNotEmpty())NativeToolGroup(vm,block,onRead,inlineActivities) else NativeMessage(vm,block,onQuestionOpen,onRead)
}
@Composable private fun NativeMessage(vm:NativeViewModel,block:NativeBlock,onQuestionOpen:()->Unit,onRead:()->Unit={}){
    val event=block.event
    val approvalResult by remember(vm,event.threadId,event.approvalId){derivedStateOf{vm.state.approvalResults[nativeApprovalKey(event.threadId,event.approvalId)].orEmpty()}}
    if(event.type=="user.message")NativeUserMessage(vm,event)
    else if(event.type=="approval.requested"&&event.approvalType=="question"){
        val question=runCatching{org.json.JSONObject(event.detail).getJSONArray("questions").getJSONObject(0).getString("question")}.getOrDefault("需要你的回答")
        val pending=event.approvalId !in vm.state.approvals&&vm.state.pendingApprovals.any{it.approvalId==event.approvalId}
        Row(Modifier.fillMaxWidth().clip(Radius.Card).clickable(enabled=pending,onClick=onQuestionOpen).padding(horizontal=8.dp,vertical=9.dp),verticalAlignment=Alignment.CenterVertically){ModernIcon(R.drawable.ic_lucide_circle_question_mark,null,Modifier.size(17.dp),Muted);Text(if(pending)question else "已回答 · $question",Modifier.weight(1f).padding(start=9.dp),fontSize=13.sp,color=Muted,maxLines=2,overflow=TextOverflow.Ellipsis);if(pending)ModernIcon(R.drawable.ic_lucide_chevron_right,null,Modifier.size(17.dp),Muted)}
    }
    else if(event.type=="context.compaction"){
        var expanded by vm.timelineDisclosure(event.threadId,"compaction",block.key,false)
        val summary=event.text.ifBlank{event.detail}
        Column(Modifier.fillMaxWidth()){
            Row(Modifier.fillMaxWidth().heightIn(min=40.dp).clip(Radius.Card).clickable(enabled=summary.isNotBlank()){expanded=!expanded;if(expanded)onRead()}.padding(horizontal=6.dp,vertical=8.dp).testTag("contextCompaction"),verticalAlignment=Alignment.CenterVertically){
                ModernIcon(R.drawable.ic_lucide_minimize_2,null,Modifier.size(15.dp),Muted)
                StatusPulseText(when(event.status){"running"->"正在压缩上下文";"cancelled"->"压缩已中止";"error"->"压缩失败";else->"上下文已自动压缩"},event.status=="running",Modifier.weight(1f).padding(start=7.dp))
                if(summary.isNotBlank())ModernIcon(if(expanded)R.drawable.ic_lucide_chevron_up else R.drawable.ic_lucide_chevron_right,null,Modifier.size(17.dp),Muted)
            }
            AnimatedVisibility(expanded&&summary.isNotBlank(),enter=disclosureEnter(),exit=disclosureExit()){
                Surface(Modifier.fillMaxWidth().padding(top=2.dp,bottom=4.dp),shape=Radius.Field,color=Wash){Column(Modifier.padding(12.dp).testTag("contextCompactionSummary")){NativeMarkdown(summary)}}
            }
        }
    }
    else if(event.type=="message.delta")Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
        val answer=remember(event.text){nativeAnswerContent(event.text)}
        NativeRichText(vm,answer.text,event)
        if(block.copyable&&answer.text.isNotBlank())NativeMessageActions(answer.text,onRetry=if(block.retryPrompt!=null&&!vm.isReadOnly()){ {vm.retryAnswer(block)} }else null,endedAt=block.endedAt,referenceContent=if(answer.hasMemoryReferences){{NativeMemoryReferenceAction(answer.memoryReferences)}}else null)
        else if(answer.hasMemoryReferences)NativeMemoryReferenceAction(answer.memoryReferences)
    }
    else if(event.type=="run.ended")nativeRunEndLabel(block.endedAt).takeIf{it.isNotBlank()}?.let{Text("结束于 $it",Modifier.padding(top=4.dp,bottom=8.dp),fontSize=12.sp,color=Muted)}
    else {
        var expanded by vm.timelineDisclosure(event.threadId,"event",event.eventId.ifBlank{event.itemId+event.type},event.type=="error"&&!event.willRetry||event.type=="approval.requested")
        Column(Modifier.fillMaxWidth()){
            val label=event.title.ifBlank{when(event.type){"reasoning.summary"->"思考摘要";"plan.updated"->"任务计划";"approval.requested"->"需要确认";"file.changed","diff.updated"->"文件改动";"error"->"执行失败";else->"运行提示"}}
            Row(Modifier.fillMaxWidth().heightIn(min=36.dp).clip(Radius.Card).clickable{expanded=!expanded;if(expanded)onRead()}.padding(horizontal=6.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically){
                ModernIcon(when(event.type){"file.changed","diff.updated"->R.drawable.ic_lucide_file_diff;"plan.updated"->R.drawable.ic_lucide_list_todo;"error"->R.drawable.ic_lucide_circle_alert;"approval.requested"->R.drawable.ic_lucide_shield_check;else->R.drawable.ic_lucide_info},null,Modifier.size(17.dp),Muted)
                Text(label,Modifier.weight(1f).padding(start=9.dp),fontSize=13.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
                if(event.type=="approval.requested")Text(nativeApprovalResultLabel(approvalResult,event.approvalId in vm.state.approvals,vm.state.pendingApprovals.any{it.approvalId==event.approvalId}),Modifier.padding(horizontal=8.dp).testTag("approvalResult:${event.approvalId}"),fontSize=12.sp,color=when(approvalResult){"accepted"->AppColor.StatusOk;"declined"->AppColor.StatusError;else->Muted})
                ModernIcon(if(expanded)R.drawable.ic_lucide_chevron_up else R.drawable.ic_lucide_chevron_right,null,Modifier.size(17.dp),Muted)
            }
            AnimatedVisibility(expanded,enter=disclosureEnter(),exit=disclosureExit()){Surface(Modifier.fillMaxWidth().padding(top=2.dp,bottom=4.dp),shape=Radius.Field,color=Wash){Column(Modifier.padding(12.dp)){if(event.type=="error"){NativeErrorDetail(event);if((block.retryPrompt!=null||(block.retryFailure&&vm.state.threads.find{it.id==vm.state.threadId}?.goal?.status in setOf("active","paused","blocked")))&&vm.state.harness=="codex"&&!vm.isReadOnly())TextButton(onClick={vm.retryAnswer(block)},enabled=vm.state.connected&&!vm.state.running&&!vm.state.sending&&!vm.currentWorkBusy(),modifier=Modifier.testTag("retryTurn")){Text("重试")}} else NativeMarkdown(event.text.ifBlank{event.detail.ifBlank{event.command.ifBlank{event.diff}}});if(event.type=="approval.requested"&&approvalResult.isEmpty()&&event.approvalId.isNotBlank()&&event.approvalId !in vm.state.approvals&&vm.state.pendingApprovals.any{it.approvalId==event.approvalId}){val msgHaptics=rememberHaptics();Row{TextButton(enabled=!vm.currentWorkBusy(),onClick={msgHaptics.longPress();vm.approve(event.approvalId,false)}){Text("拒绝")};ApprovalButton(enabled=!vm.currentWorkBusy(),onClick={msgHaptics.longPress();vm.approve(event.approvalId,true)}){Text("允许")}}}}}}
        }
    }
}
@Composable private fun NativeUserMessage(vm:NativeViewModel,event:ChatEvent){
    nativeScheduledMessage(event)?.let{NativeScheduledTrigger(vm,event,it);return}
    var menu by remember(event.eventId){mutableStateOf(false)}
    val clipboard=LocalClipboardManager.current
    val context=LocalContext.current
    val haptics=rememberHaptics()
    val imageEndpoints=buildList {
        event.images.forEach{add("/api/uploads/images/${it.id}")}
        event.attachments.forEachIndexed{index,file->
            if(file.path.substringAfterLast('.').lowercase() in listOf("png","jpg","jpeg","gif","webp")){
                add(file.url.takeIf{it.startsWith("/api/")||it.startsWith("/raw/")}
                    ?:runCatching{nativeFileEndpointForPath(vm.state,file.path)}.getOrNull()
                    ?:if(event.eventId.startsWith("history:"))"/api/threads/${java.net.URLEncoder.encode(event.threadId,"UTF-8")}/history-image?eventId=${java.net.URLEncoder.encode(event.eventId,"UTF-8")}&index=$index" else "missing-image:${file.name}")
            }
        }
    }
    val otherAttachments=event.attachments.filterNot{it.path.substringAfterLast('.').lowercase() in listOf("png","jpg","jpeg","gif","webp")}
    Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.End){
        event.messageSource?.let{source->NativeMessageSourceLabel(vm,source)}
        Box(Modifier.align(Alignment.End)){
        Column(horizontalAlignment=Alignment.End){
        if(imageEndpoints.isNotEmpty())Box(Modifier.combinedClickable(onClick={},onLongClick={haptics.longPress();menu=true})){NativeImageGallery(vm,imageEndpoints)}
        if(event.text.isNotBlank()||event.uploads.isNotEmpty()||otherAttachments.isNotEmpty())OutgoingBubble(Modifier.semantics{
            customActions=listOf(
                CustomAccessibilityAction("复制消息"){clipboard.setText(AnnotatedString(event.text));true},
                CustomAccessibilityAction("消息操作"){menu=true;true}
            )+if(vm.messageEditTurn(event).isNotBlank())listOf(CustomAccessibilityAction("编辑消息"){vm.editMessage(event);true})else emptyList()
        }.combinedClickable(onClick={},onLongClickLabel="消息操作",onLongClick={haptics.longPress();menu=true})) {
                event.uploads.forEach{file->
                    Surface(shape=Radius.Card,color=MaterialTheme.colors.surface,modifier=Modifier.clickable{vm.openUpload(file)}){
                        Row(Modifier.padding(8.dp),verticalAlignment=Alignment.CenterVertically){
                            ModernIcon(if(file.mime.startsWith("video/"))R.drawable.ic_lucide_video else R.drawable.ic_lucide_file_text,null,Modifier.size(18.dp))
                            Text(file.name,Modifier.widthIn(max=220.dp).padding(start=8.dp),maxLines=2,overflow=TextOverflow.Ellipsis,fontSize=13.sp)
                        }
                    }
                }
                otherAttachments.forEach{file->TextButton(onClick={vm.openOutput(nativeFilePathHref(file.path))}){Text(file.name,maxLines=2,overflow=TextOverflow.Ellipsis)}}
                if(event.questionReplies.isNotEmpty())event.questionReplies.forEach{reply->
                    Row(Modifier.fillMaxWidth().padding(bottom=8.dp).testTag("replyQuestion").height(IntrinsicSize.Min)){
                        Box(Modifier.width(2.dp).fillMaxHeight().background(Muted.copy(alpha=0.45f)))
                        Text(reply.question,Modifier.padding(start=9.dp),fontSize=13.sp,lineHeight=20.sp,color=Muted)
                    }
                    Text(reply.answer,Modifier.padding(bottom=if(reply==event.questionReplies.last())0.dp else 12.dp),fontSize=16.sp,lineHeight=25.sp)
                } else if(event.text.isNotBlank())Text(event.text,fontSize=16.sp,lineHeight=25.sp)
        }
        }
        ModernDropdown(menu,{menu=false},192.dp,edgeMargin=20.dp,placement=NativePopupPlacement.ADJACENT){
            PopupMenuRow(R.drawable.ic_lucide_copy,"复制",compact=true){clipboard.setText(AnnotatedString(event.text));menu=false}
            if(vm.messageEditTurn(event).isNotBlank())PopupMenuRow(R.drawable.ic_lucide_square_pen,"编辑",compact=true){vm.editMessage(event);menu=false}
            if(vm.state.harness=="codex"&&"thread-fork" in vm.state.capabilities&&event.turnId.isNotBlank()&&vm.state.events.any{it.type=="turn.completed"&&it.turnId==event.turnId})PopupMenuRow(R.drawable.ic_lucide_git_branch,"从此轮创建分支",compact=true){menu=false;vm.forkConversation(event.turnId)}
            PopupMenuRow(R.drawable.ic_lucide_square_pen,"再次使用",compact=true){vm.reuseMessage(event);menu=false}
            PopupMenuRow(R.drawable.ic_lucide_share_2,"分享",compact=true){menu=false;context.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND).apply{type="text/plain";putExtra(android.content.Intent.EXTRA_TEXT,event.text)},"分享消息"))}
        }
        }
        if(event.status=="send.failed")Row(Modifier.testTag("failedSend").padding(top=4.dp),verticalAlignment=Alignment.CenterVertically){
            Text(event.detail,Modifier.weight(1f),fontSize=12.sp,color=MaterialTheme.colors.error,maxLines=2,overflow=TextOverflow.Ellipsis)
            TextButton(onClick={vm.retryFailedMessage(event.requestId)},enabled=vm.state.connected&&!vm.state.sending){Text("重试",fontSize=12.sp)}
            IconButton(onClick={vm.discardFailedMessage(event.requestId)},modifier=Modifier.size(48.dp)){ModernIcon(R.drawable.ic_lucide_x,"移除待发消息",Modifier.size(16.dp),Muted)}
        }
    }
}
@Composable private fun NativeMemoryReferenceAction(references:List<NativeMemoryReference>,modifier:Modifier=Modifier){
    var open by remember{mutableStateOf(false)}
    Box(modifier){
        IconButton(onClick={open=true},modifier=Modifier.size(48.dp)){
            ModernIcon(R.drawable.ic_lucide_brain,"查看记忆引用",Modifier.size(18.dp),Muted)
        }
        if(open)CompactForm("参考的记忆",{open=false}){
            if(references.isEmpty())Text("这条回复未提供具体引用来源。",fontSize=14.sp,lineHeight=22.sp,color=Muted)
            references.forEachIndexed{index,reference->
                if(index>0)Divider(Modifier.padding(vertical=12.dp),color=Ink.copy(alpha=0.08f))
                if(reference.note.isNotBlank())Text(reference.note,fontSize=14.sp,lineHeight=22.sp)
                Text("${reference.source} · 第 ${reference.lines} 行",Modifier.padding(top=4.dp),fontSize=12.sp,lineHeight=18.sp,color=Muted)
            }
        }
    }
}
@Composable private fun NativeSidebarFilterMenu(filter:NativeThreadFilter,drawerOpen:Boolean,onSelect:(NativeThreadFilter)->Unit){
    var expanded by remember(drawerOpen){mutableStateOf(false)}
    val active=filter!=NativeThreadFilter.ALL
    Box{
        Row(Modifier.heightIn(min=48.dp).widthIn(min=48.dp).clip(Radius.Button).background(if(active)Wash else Color.Transparent)
            .testTag("threadFilterMenu").semantics{contentDescription="筛选会话，当前${filter.label}"}
            .clickable(role=Role.Button){expanded=!expanded}.padding(horizontal=12.dp),
            verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.Center){
            if(active){
                Text(filter.label,fontSize=12.sp,color=Ink)
                ModernIcon(R.drawable.ic_lucide_chevron_down,null,Modifier.padding(start=4.dp).size(14.dp),Muted)
            }else ModernIcon(R.drawable.ic_filter_funnel,null,Modifier.size(20.dp),Muted)
        }
        ModernDropdown(expanded,{expanded=false},160.dp){Column(Modifier.padding(6.dp)){
            NativeThreadFilter.entries.forEach{option->
                val selected=filter==option
                Row(Modifier.fillMaxWidth().heightIn(min=48.dp).clip(Radius.MenuItem).testTag("threadFilter:${option.wire}")
                    .semantics{this.selected=selected}.clickable(role=Role.RadioButton){expanded=false;onSelect(option)}
                    .padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically){
                    Text(option.label,Modifier.weight(1f),fontSize=14.sp,color=Ink)
                    if(selected)ModernIcon(R.drawable.ic_lucide_check,null,Modifier.size(18.dp))
                }
            }
        }}
    }
}
@Composable private fun NativeMessageActions(text:String,user:Boolean=false,onRetry:(()->Unit)?=null,endedAt:String="",referenceContent:(@Composable ()->Unit)?=null){
    if(text.isBlank())return
    val clipboard=LocalClipboardManager.current
    val context=LocalContext.current
    val haptics=rememberHaptics()
    var copied by remember(text){mutableStateOf(false)}
    var menu by remember(text){mutableStateOf(false)}
    val selectAcross=LocalNativeTextSelection.current
    LaunchedEffect(copied){if(copied){delay(1800);copied=false}}
    Row(verticalAlignment=Alignment.CenterVertically) {
        IconButton(onClick={clipboard.setText(AnnotatedString(text));haptics.keyTap();copied=true},modifier=Modifier.size(48.dp)){
            ModernIcon(if(copied)R.drawable.ic_lucide_check else R.drawable.ic_lucide_copy,if(copied)"已复制" else if(user)"复制消息" else "复制回复",Modifier.size(18.dp),Muted)
        }
        referenceContent?.invoke()
        if(!user)Box{
            IconButton(onClick={menu=!menu},modifier=Modifier.size(48.dp)){
                ModernIcon(if(menu)R.drawable.ic_lucide_x else R.drawable.ic_lucide_ellipsis,if(menu)"关闭回复菜单" else "回复菜单",Modifier.size(18.dp),Muted)
            }
            ModernDropdown(menu,{menu=false},192.dp,edgeMargin=20.dp){
                nativeRunEndLabel(endedAt).takeIf{it.isNotBlank()}?.let{
                    Text("结束于 $it",Modifier.fillMaxWidth().padding(horizontal=12.dp,vertical=10.dp),fontSize=12.sp,lineHeight=18.sp,color=Muted)
                    Divider(color=Ink.copy(alpha=0.08f))
                }
                PopupMenuRow(R.drawable.ic_lucide_copy,"复制",compact=true){clipboard.setText(AnnotatedString(text));menu=false;copied=true}
                if(selectAcross!=null)PopupMenuRow(R.drawable.ic_lucide_scan_text,"整屏选文",compact=true){menu=false;selectAcross(text)}
                if(onRetry!=null)PopupMenuRow(R.drawable.ic_lucide_rotate_cw,"重试",compact=true){menu=false;onRetry()}
                PopupMenuRow(R.drawable.ic_lucide_share_2,"分享",compact=true){menu=false;context.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND).apply{type="text/plain";putExtra(android.content.Intent.EXTRA_TEXT,text)},"分享回复"))}
            }
        }
    }
}
@Composable internal fun StatusPulseText(text:String,running:Boolean,modifier:Modifier=Modifier){
    if(running)NativeRunningTitle(text,rememberNativeRunningPulse(true),modifier,fontSize=13.sp)
    else Text(text,modifier,fontSize=13.sp,color=Muted,maxLines=1,overflow=TextOverflow.Ellipsis)
}
@Composable private fun NativeToolGroup(vm:NativeViewModel,block:NativeBlock,onRead:()->Unit={},inlineDetails:Boolean=true){
    var expanded by vm.timelineDisclosure(block.event.threadId,"tools",block.key)
    LaunchedEffect(expanded,block.activities,vm.state.connected,vm.activityLoadEpoch){if(expanded&&vm.state.connected)vm.loadActivityGroups(block.activities)}
    val entries=remember(block.activities,expanded,inlineDetails){if(expanded&&inlineDetails)nativeActivityItems(block.activities) else emptyList()}
    val failed=block.activities.any{it.status=="error"}
    val running=!failed&&!vm.state.loadingHistory&&nativeActivityRunning(block.activities,vm.state.events,vm.state.running)
    Column(Modifier.fillMaxWidth()){
        NativeActivityHeader(nativeActivitySummary(block.activities),expanded,{expanded=!expanded;if(expanded)onRead()},Modifier.testTag("activityGroupHeader"),running,failed)
        if(expanded)NativeActivityLoadFeedback(vm,block.activities)
        if(inlineDetails)AnimatedVisibility(expanded,enter=disclosureEnter(),exit=disclosureExit()){Surface(Modifier.fillMaxWidth().padding(top=2.dp,bottom=4.dp),shape=Radius.Field,color=Color.Transparent){Column(Modifier.padding(vertical=2.dp),verticalArrangement=Arrangement.spacedBy(2.dp)){
            entries.filter{it.type!="reasoning.summary"}.forEach{entry->key(entry.key){NativeActivityDetail(vm,entry,block.event.threadId,block.key,onRead)}}
        }}}
    }
}
@Composable private fun NativeActivityLoadFeedback(vm:NativeViewModel,events:List<ChatEvent>){
    events.filter{it.activityGroupId.isNotBlank()}.forEach{event->
        if(event.activityGroupId in vm.state.activityLoading)Text("正在加载操作…",Modifier.padding(8.dp),fontSize=12.sp,color=Muted)
        vm.state.activityErrors[event.activityGroupId]?.let{message->TextButton(onClick={vm.loadActivityGroups(listOf(event))}){Text("加载失败，点击重试：$message",fontSize=12.sp)}}
    }
}
@Composable private fun NativeActivityDetail(vm:NativeViewModel,entry:NativeActivityItem,threadId:String,groupKey:String,onRead:()->Unit){
    var detailOpen by vm.timelineDisclosure(threadId,"detail",groupKey+":"+entry.key)
    var changeOpen by remember{mutableStateOf(false)}
    val latestEntry by rememberUpdatedState(entry)
    LaunchedEffect(detailOpen,changeOpen,threadId,vm.state.connected,vm.activityLoadEpoch){
        if(vm.state.connected&&(detailOpen||changeOpen)){
            var first=true
            snapshotFlow{latestEntry.let{if(it.deferred)it.eventIds else emptyList()}}.collect{ids->
                if(ids.isNotEmpty()){vm.loadActivityDetails(threadId,ids,retry=first);first=false}
            }
        }
    }
    val arrowAngle=animateFloatAsState(if(detailOpen)90f else 0f,chevronMotion(),label="activity-detail-arrow")
    var preparedDetail by remember(threadId,groupKey,entry.key){mutableStateOf<NativePreparedActivityDetail?>(null)}
    LaunchedEffect(entry,detailOpen,changeOpen){
        if(detailOpen||changeOpen)preparedDetail=withContext(Dispatchers.Default){prepareNativeActivityDetail(entry)}
    }
    // Classify output-dependent patches with the opened body, never in row composition.
    val isChange=entry.knownChange||preparedDetail?.takeIf{it.entry==entry}?.isChange==true
    // A deferred tool can become a patch only after its body arrives. Preserve
    // the user's first open intent instead of leaving the now-change row blank.
    val changeRequested=changeOpen||detailOpen&&isChange
    val detailText=preparedDetail?.text.orEmpty()
    val changeDetail=preparedDetail?.takeIf{it.entry==entry}?.text
    Column(Modifier.testTag("activityDetail")){
        Row(Modifier.fillMaxWidth().then(if(isChange)Modifier.testTag("activityChange") else Modifier).heightIn(min=34.dp).clip(Radius.Inset).clickable(enabled=entry.hasDetails||entry.files.isNotEmpty()||entry.deferred){onRead();if(isChange)changeOpen=true else detailOpen=!detailOpen}.padding(horizontal=6.dp,vertical=5.dp),verticalAlignment=Alignment.CenterVertically){
            ModernIcon(when(entry.type){"reasoning.summary"->R.drawable.ic_lucide_lightbulb;"file.changed","diff.updated"->R.drawable.ic_lucide_file_diff;"context.compaction"->R.drawable.ic_lucide_minimize_2;else->if(entry.status=="error")R.drawable.ic_lucide_circle_alert else R.drawable.ic_lucide_terminal},null,Modifier.size(16.dp),Muted)
            Text(entry.title,Modifier.weight(1f).padding(start=8.dp),fontSize=13.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
            if(entry.hasDetails||entry.files.isNotEmpty()||entry.deferred)ModernIcon(R.drawable.ic_lucide_chevron_right,null,Modifier.size(16.dp).graphicsLayer{rotationZ=if(isChange)0f else arrowAngle.value},Muted)
        }
        if((detailOpen||changeOpen)&&entry.deferred){
            if(entry.eventIds.any{it in vm.state.activityLoading})Text("正在加载…",Modifier.padding(8.dp),fontSize=12.sp,color=Muted)
            entry.eventIds.firstNotNullOfOrNull{vm.state.activityErrors[it]}?.let{message->TextButton(onClick={vm.loadActivityDetails(threadId,entry.eventIds)}){Text("加载失败，点击重试：$message",fontSize=12.sp)}}
        }
        AnimatedVisibility(!isChange&&detailOpen&&detailText.isNotBlank(),enter=disclosureEnter(),exit=disclosureExit()){Box(Modifier.fillMaxWidth().padding(horizontal=6.dp).padding(bottom=8.dp).heightIn(max=if(detailText.contains("![查看图片]"))320.dp else 180.dp).verticalScroll(rememberScrollState())){
            if(detailText.contains("![查看图片]"))NativeRichText(vm,detailText,ChatEvent("tool.completed",threadId,eventId=entry.eventIds.firstOrNull().orEmpty())) else if(entry.type in setOf("reasoning.summary","plan.updated"))NativeMarkdown(detailText) else SelectionContainer{Text(detailText,fontFamily=FontFamily.Monospace,fontSize=12.sp,lineHeight=18.sp,color=Muted)}
        }}
    }
    if(changeRequested&&!entry.deferred)NativeChangeDetail(entry.title,entry.files,changeDetail.orEmpty(),statusContent=if(changeDetail==null)({
        NativeRunningTitle("正在整理改动…",rememberNativeRunningPulse(true),fontSize=14.sp)
    })else null){changeOpen=false;detailOpen=false}
}
@Composable private fun NativeQuestions(vm:NativeViewModel,event:ChatEvent){
    val questions=remember(event.detail){runCatching{val a=org.json.JSONObject(event.detail).getJSONArray("questions");(0 until a.length()).map{a.getJSONObject(it)}}.getOrDefault(emptyList())}
    val draftKey=vm.questionDraftKey(event.threadId,event.approvalId)
    val answers=vm.questionDraft(draftKey)
    val resolved by remember(vm,event.approvalId){derivedStateOf{event.approvalId in vm.state.approvals}}
    val busy by remember(vm){derivedStateOf{vm.currentWorkBusy()}}
    NativeQuestionForm(questions,answers,resolved,busy,{id,value->vm.editQuestionDraft(draftKey,id,value)},{vm.answerQuestions(event.approvalId,answers)})
}

@Composable internal fun NativeQuestionForm(questions:List<org.json.JSONObject>,answers:Map<String,String>,resolved:Boolean,busy:Boolean,onAnswer:(String,String)->Unit,onSubmit:()->Unit){
    Column(Modifier.fillMaxWidth().clip(Radius.Button).background(Wash).padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text(if(resolved)"问题已处理" else "需要你的回答",fontWeight=FontWeight.Medium)
        questions.forEach{q->val id=q.getString("id");Text(q.getString("question"),fontSize=16.sp)
            if(!resolved){val options=q.optJSONArray("options");if(options!=null)for(i in 0 until options.length()){val option=options.getJSONObject(i);val label=option.getString("label");OutlinedButton(onClick={onAnswer(id,label)},modifier=Modifier.fillMaxWidth()){if(answers[id]==label)ModernIcon(R.drawable.ic_lucide_check,null,Modifier.size(18.dp));Column(Modifier.weight(1f)){Text(label);val description=option.optString("description");if(description.isNotBlank())Text(description,fontSize=12.sp,color=Muted)}}}
                BasicTextField(answers[id].orEmpty(),{onAnswer(id,it)},modifier=Modifier.testTag("questionAnswer:$id").semantics{contentDescription=q.getString("question")}.fillMaxWidth().background(MaterialTheme.colors.surface,Radius.Inset).padding(12.dp),textStyle=TextStyle(color=Ink,fontSize=16.sp),keyboardOptions=if(q.optBoolean("isSecret"))KeyboardOptions(keyboardType=androidx.compose.ui.text.input.KeyboardType.Password,autoCorrect=false) else KeyboardOptions.Default,visualTransformation=if(q.optBoolean("isSecret"))androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,decorationBox={inner->if(answers[id].isNullOrEmpty())Text("输入你的回答",color=Muted);inner()})
            }
        }
        if(!resolved)Button(onClick=onSubmit,enabled=!busy&&questions.isNotEmpty()&&questions.all{!answers[it.getString("id")].isNullOrBlank()}){Text("提交回答")}
    }
}

@Composable internal fun NativePairingSheet(vm:NativeViewModel,close:()->Unit){
    val context=LocalContext.current
    val state=vm.state
    var address by remember{mutableStateOf(state.address)}
    var publicUrl by remember{mutableStateOf(state.publicUrl)}
    var remotePassword by remember{mutableStateOf(state.remotePassword)}
    var certificate by remember{mutableStateOf(state.certificateSha256)}
    var code by remember{mutableStateOf("")}
    var scanError by remember{mutableStateOf("")}
    var connectionError by remember{mutableStateOf("")}
    var legacyOpen by remember{mutableStateOf(false)}
    val legacy=remember(vm,state.recoveryVersion){vm.unassignedMessages()}
    val clipboard=LocalClipboardManager.current
    if(legacyOpen){
        NativeLegacyMessagesSheet(legacy,{clipboard.setText(AnnotatedString(it))}){legacyOpen=false}
        return
    }
    val paired=vm.hasSavedPairing()
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
                    connectionError=""
                    address=link.address
                    publicUrl=link.publicUrl
                    certificate=link.certificateSha256
                    code=link.code
                }
            }?.addOnFailureListener{scanError="扫码未完成，请重试或手动输入配对码"}
        },modifier=Modifier.fillMaxWidth()){
            ModernIcon(R.drawable.ic_lucide_qr_code,null,Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("扫描电脑二维码")
        }
        if(scanError.isNotBlank())Text(scanError,fontSize=12.sp,color=MaterialTheme.colors.error)
        if(legacy.isNotEmpty())TextButton(onClick={legacyOpen=true},modifier=Modifier.fillMaxWidth().testTag("legacyMessagesEntry")){
            Text("查看旧版消息（${legacy.size}）")
        }
        Spacer(Modifier.height(12.dp))
        NativeConnectionField(address,{address=it;connectionError=""},"内网 HTTPS 地址",modifier=Modifier.testTag("connectionAddress"),keyboardType=androidx.compose.ui.text.input.KeyboardType.Uri)
        Spacer(Modifier.height(10.dp))
        NativeConnectionField(publicUrl,{publicUrl=it;connectionError=""},"公网 HTTPS 地址（可选）",modifier=Modifier.testTag("connectionPublicUrl"),keyboardType=androidx.compose.ui.text.input.KeyboardType.Uri)
        Spacer(Modifier.height(10.dp))
        NativeConnectionField(remotePassword,{remotePassword=it;connectionError=""},"公网独立密码",modifier=Modifier.testTag("connectionPassword"),secret=true)
        PublicConnectionTest(vm,publicUrl,remotePassword)
        if(paired)NativeConnectionRoutes(state.route,state.connecting,publicUrl.isNotBlank()&&remotePassword.isNotBlank()){route->
            connectionError=if(vm.connect(address,code=code,publicUrl=publicUrl,remotePassword=remotePassword,certificateSha256=certificate,route=route))"" else vm.state.error
        }
        if(paired)Text(if(state.connected)"网关在线 · ${if(state.activeAddress==state.publicUrl&&state.publicUrl.isNotBlank())"公网" else "内网"}" else if(state.connecting)"正在连接网关…" else "网关未连接",fontSize=12.sp,color=Muted)
        Spacer(Modifier.height(10.dp))
        NativeConnectionField(certificate,{certificate=it;connectionError=""},"本地证书 SHA-256 指纹",modifier=Modifier.testTag("connectionCertificate"))
        Spacer(Modifier.height(10.dp))
        NativeConnectionField(code,{code=it;connectionError=""},if(paired)"配对码（重新配对时填写）" else "配对码",modifier=Modifier.testTag("connectionCode"),imeAction=androidx.compose.ui.text.input.ImeAction.Done)
        Text(if(paired)"已配对，修改公网密码后直接保存即可。" else "扫描后自动填入地址、证书和配对码；公网密码仍需单独填写。",fontSize=12.sp,color=Muted,modifier=Modifier.padding(vertical=12.dp))
        if(connectionError.isNotBlank())Text(connectionError,fontSize=12.sp,color=MaterialTheme.colors.error,modifier=Modifier.testTag("connectionFormError"))
        Button(onClick={
            if(vm.connect(address,code=code,publicUrl=publicUrl,remotePassword=remotePassword,certificateSha256=certificate))close()
            else connectionError=vm.state.error
        },enabled=address.isNotBlank()&&(paired||code.isNotBlank()),modifier=Modifier.fillMaxWidth()){
            Text(if(paired&&code.isBlank())"保存并连接" else "连接")
        }
    }
}

@Composable internal fun NativeLegacyMessagesSheet(records:List<NativeLegacySubmission>,copy:(String)->Unit,close:()->Unit){
    var selected by remember{mutableStateOf<String?>(null)}
    val record=records.find{it.id==selected}
    if(record!=null){
        var copied by remember(record.id){mutableStateOf(false)}
        Sheet("旧消息详情",{selected=null}){
            Text(record.address.ifBlank{"未记录电脑地址"},fontSize=12.sp,color=Muted)
            nativeRunEndLabel(record.submittedAt).takeIf{it.isNotBlank()}?.let{Text(it,fontSize=12.sp,color=Muted)}
            Spacer(Modifier.height(14.dp))
            SelectionContainer{Text(record.text.ifBlank{"（没有文字）"},fontSize=15.sp,lineHeight=23.sp,modifier=Modifier.testTag("legacyMessageText"))}
            if(record.attachmentNames.isNotEmpty()){
                Spacer(Modifier.height(14.dp));Text("附件名称",fontSize=12.sp,color=Muted)
                record.attachmentNames.forEach{name->Text(name,fontSize=14.sp,modifier=Modifier.padding(top=6.dp))}
            }
            Spacer(Modifier.height(14.dp))
            OutlinedButton(onClick={copy(record.text);copied=true},enabled=record.text.isNotBlank(),modifier=Modifier.fillMaxWidth().testTag("copyLegacyMessage")){Text(if(copied)"已复制文字" else "复制文字")}
        }
        return
    }
    Sheet("旧版保存的消息",close){
        Text("原电脑信息不完整。可在这里查看、复制文字，附件保留名称。",fontSize=12.sp,color=Muted)
        records.forEach{item->
            Surface(shape=Radius.Card,color=Wash,modifier=Modifier.fillMaxWidth().padding(top=12.dp).clickable{selected=item.id}.testTag("legacyMessage:${item.id}")){
                Column(Modifier.padding(14.dp)){
                    Text(item.text.ifBlank{"仅包含附件"},fontSize=14.sp,maxLines=2,overflow=TextOverflow.Ellipsis)
                    Text(item.address.ifBlank{"未记录电脑地址"},fontSize=12.sp,color=Muted,modifier=Modifier.padding(top=6.dp))
                    if(item.attachmentNames.isNotEmpty())Text("${item.attachmentNames.size} 个附件",fontSize=12.sp,color=Muted)
                }
            }
        }
    }
}

@Composable private fun NativeConnectionRoutes(route:ConnectionRoute,connecting:Boolean,hasPublic:Boolean,select:(ConnectionRoute)->Unit){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        TextButton(onClick={select(ConnectionRoute.LOCAL)},modifier=Modifier.weight(1f)){Text(if(connecting&&route==ConnectionRoute.LOCAL)"重连内网" else "连接内网")}
        TextButton(onClick={select(ConnectionRoute.PUBLIC)},enabled=hasPublic,modifier=Modifier.weight(1f)){Text(if(connecting&&route==ConnectionRoute.PUBLIC)"重连公网" else "连接公网")}
    }
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
        Text(when(route){ConnectionRoute.AUTO->"自动选择：内网优先";ConnectionRoute.LOCAL->"仅使用内网";ConnectionRoute.PUBLIC->"仅使用公网"},Modifier.weight(1f),fontSize=12.sp,color=Muted)
        if(route!=ConnectionRoute.AUTO)TextButton(onClick={select(ConnectionRoute.AUTO)}){Text("恢复自动")}
    }
}

@Composable private fun PublicConnectionTest(vm:NativeViewModel,address:String,password:String,connect:(()->Unit)?=null){
    val s=vm.state
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        TextButton(onClick={vm.testPublicConnection(address,password)},enabled=!s.publicTestRunning,modifier=Modifier.weight(1f)){
            Text(if(s.publicTestRunning)"正在测试公网…" else "测试公网连接")
        }
        if(connect!=null)TextButton(onClick=connect,modifier=Modifier.weight(1f)){Text("连接电脑")}
    }
    AnimatedVisibility(s.publicTestMessage.isNotBlank()){
        Column(Modifier.fillMaxWidth().clip(Radius.Section).background(Wash).padding(12.dp)){
            if(s.publicTestRunning)LinearProgressIndicator(Modifier.fillMaxWidth().padding(bottom=8.dp),color=Ink,backgroundColor=Wash)
            Text(s.publicTestMessage,fontSize=13.sp,color=Ink)
            if(s.publicTestPassed)Text(when{
                s.connected->"当前连接：${if(s.activeAddress==s.publicUrl&&s.publicUrl.isNotBlank())"公网" else "内网"}"
                s.connecting->"正在连接${if(s.activeAddress==s.publicUrl&&s.publicUrl.isNotBlank())"公网" else "内网"}…"
                else->"当前未连接"
            },fontSize=12.sp,color=Muted)
        }
    }
}
@Composable internal fun OutgoingBubble(modifier:Modifier=Modifier,content:@Composable ColumnScope.()->Unit){
    val shape=Radius.Composer
    val maxWidth=LocalConfiguration.current.screenWidthDp.dp*0.88f
    Surface(Modifier.widthIn(max=maxWidth).clip(shape).then(modifier).testTag("outgoingBubble"),shape=shape,color=LocalNativeTheme.current.palette.bubble){
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp),content=content)
    }
}

@Composable private fun ApprovalButton(enabled:Boolean,onClick:()->Unit,content:@Composable RowScope.()->Unit){
    Button(enabled=enabled,onClick=onClick,content=content)
}
@Composable internal fun NativeMessageSourceLabel(vm:NativeViewModel,source:NativeMessageSource){
    var avatar by remember(source.avatar,vm.imageRevision){mutableStateOf<android.graphics.Bitmap?>(null)}
    LaunchedEffect(source.avatar,vm.imageRevision){if(source.avatar.startsWith("/api/cloud/avatar/"))try{avatar=vm.loadImage(source.avatar,64).first}catch(e:kotlinx.coroutines.CancellationException){throw e}catch(_:Exception){}}
    Row(Modifier.padding(end=8.dp,bottom=6.dp).testTag("messageSource"),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(5.dp)){
        val image=avatar
        if(image!=null)Image(image.asImageBitmap(),null,Modifier.size(18.dp).testTag("messageSourceAvatar"),contentScale=ContentScale.Fit)
        else NativeHarnessIcon(source.threadId.takeIf{it.isNotBlank()}?.let(::nativeThreadAgent)?:vm.state.harness,Modifier.size(16.dp),Muted)
        Text("来自 ${source.name.ifBlank{if(source.kind=="schedule")"定时任务" else "其他任务"}}",fontSize=12.sp,color=Muted)
    }
}
private val nativeGenericActivitySummary=Regex("^(?:处理过程\\s*[·•]\\s*)?(\\d+)\\s*项操作$")
internal fun nativeActivitySummary(events:List<ChatEvent>):String {
    val provided=events.firstOrNull{it.activitySummary.isNotBlank()}?.activitySummary?.let(::nativeActivityLabel)
    if(provided!=null&&!nativeGenericActivitySummary.matches(provided))return provided.take(80)
    val thought=events.lastOrNull{it.type=="reasoning.summary"&&(it.title.isNotBlank()||it.text.isNotBlank())}
    if(thought!=null)return nativeActivityLabel(thought.text.ifBlank{thought.title}).take(80)
    val groups=events.filter{it.activityGroupId.isNotBlank()}.distinctBy{it.activityGroupId}
    val groupedCount=groups.sumOf{event->event.activityCount.takeIf{it>0}
        ?:nativeGenericActivitySummary.matchEntire(event.activitySummary)?.groupValues?.get(1)?.toIntOrNull()?:1}
    val count=groupedCount+events.filter{it.activityGroupId.isBlank()&&it.type!="reasoning.summary"}
        .mapIndexed{index,event->event.itemId.ifBlank{event.commandId.ifBlank{event.eventId.ifBlank{"event:$index"}}}}.distinct().size
    // File metadata is already parsed; do not inspect patch bodies or load deferred content here.
    val files=events.flatMap{event->event.fileChanges.map{it.path}+if(event.type=="file.changed")event.files else emptyList()}
        .filter{it.isNotBlank()}.distinct().size
    return listOfNotNull(if(count>0)"$count 项操作" else null,if(files>0)"改动 $files 个文件" else null)
        .joinToString(" · ").ifBlank{"操作"}
}
