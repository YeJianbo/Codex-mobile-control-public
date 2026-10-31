package com.localcodex.control

import android.graphics.Bitmap
import android.os.Build
import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.zIndex
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.input.ImeAction
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import net.sp00nz.vncfree.Rfb
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.max

private data class DesktopFrame(val bitmap:Bitmap,val width:Int,val height:Int)
private data class DesktopScreenState(val frame:DesktopFrame?=null,val error:String="",val scroll:Boolean=false,val text:String="")

private class DesktopConnection {
    private val closed=AtomicBoolean(false)
    private var tunnel:NativeVncTunnel?=null
    private var handle=0L
    val input=Channel<(Long)->Unit>(256)
    fun submit(action:(Long)->Unit){if(!input.trySend(action).isSuccess)stop()}
    @Synchronized fun stop(){
        if(!closed.compareAndSet(false,true))return
        input.close();val h=handle;if(h!=0L)runCatching{Rfb.close(h)};tunnel?.close()
    }
    @Synchronized fun attachTunnel(value:NativeVncTunnel):Boolean {if(closed.get()){value.close();return false};tunnel=value;return true}
    @Synchronized fun attach(h:Long):Boolean {if(closed.get()){Rfb.close(h);return false};handle=h;return true}
    @Synchronized fun free(h:Long){if(handle==h)handle=0;Rfb.free(h)}
}

@Composable internal fun NativeRemoteDesktop(vm:NativeViewModel,back:()->Unit){
    var state by remember { mutableStateOf(DesktopScreenState()) }
    var attempt by remember { mutableIntStateOf(0) }
    val context=LocalContext.current
    val desktopPrefs=remember{context.getSharedPreferences("remote_desktop",0)}
    var scale by remember{mutableIntStateOf(desktopPrefs.getInt("scale",75).takeIf{it in listOf(50,75,100)}?:75)}
    val pageActive=LocalManagementPageActive.current
    val activity=context as? Activity
    val originalOrientation=rememberSaveable { activity?.requestedOrientation?:ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    val window=activity?.window
    val originalStatusVisible=rememberSaveable { window?.decorView?.let{androidx.core.view.ViewCompat.getRootWindowInsets(it)}?.isVisible(WindowInsetsCompat.Type.statusBars())?:true }
    val originalNavigationVisible=rememberSaveable { window?.decorView?.let{androidx.core.view.ViewCompat.getRootWindowInsets(it)}?.isVisible(WindowInsetsCompat.Type.navigationBars())?:true }
    val originalBehavior=rememberSaveable { window?.let{WindowCompat.getInsetsController(it,it.decorView).systemBarsBehavior}?:WindowInsetsControllerCompat.BEHAVIOR_DEFAULT }
    val originalCutout=rememberSaveable { if(Build.VERSION.SDK_INT>=28)window?.attributes?.layoutInDisplayCutoutMode?:0 else 0 }
    DisposableEffect(activity,pageActive){
        val controller=window?.let{WindowCompat.getInsetsController(it,it.decorView)}
        if(pageActive&&activity!=null&&window!=null){
            if(Build.VERSION.SDK_INT>=28)window.attributes=window.attributes.apply{layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES}
            controller?.systemBarsBehavior=WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller?.hide(WindowInsetsCompat.Type.systemBars())
            activity.requestedOrientation=ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
        onDispose{
            if(pageActive&&activity!=null&&window!=null){
                if(Build.VERSION.SDK_INT>=28)window.attributes=window.attributes.apply{layoutInDisplayCutoutMode=originalCutout}
                controller?.systemBarsBehavior=originalBehavior
                if(originalStatusVisible)controller?.show(WindowInsetsCompat.Type.statusBars())
                if(originalNavigationVisible)controller?.show(WindowInsetsCompat.Type.navigationBars())
                if(!activity.isChangingConfigurations)activity.requestedOrientation=originalOrientation
            }
        }
    }
    BackHandler(enabled=pageActive,onBack=back)
    val active=pageActive&&vm.uiForeground&&vm.state.connected
    val connection=remember(active,vm.state.activeAddress,attempt,scale){DesktopConnection()}
    DisposableEffect(connection){onDispose{connection.stop()}}
    LaunchedEffect(connection,active){
        if(!active){state=state.copy(frame=null);return@LaunchedEffect}
        state=state.copy(frame=null,error="")
        try{
            if(Build.SUPPORTED_ABIS.none{it=="arm64-v8a"||it=="x86_64"})throw IllegalStateException("当前设备架构暂不支持远程桌面")
            if(vm.state.publicUrl.isNotBlank()&&vm.state.activeAddress==vm.state.publicUrl)throw IllegalStateException("请先切换到内网连接")
            val info=vm.threadToolRequest("POST","/api/desktop/session?scale=$scale")
            val tunnel=NativeVncTunnel(vm.desktopGateway(),info.getString("id"));if(!connection.attachTunnel(tunnel))return@LaunchedEffect;tunnel.open()
            val handle=withContext(Dispatchers.IO){Rfb.connect(tunnel.address,"",info.getString("password"),context.filesDir.path)}
            if(!connection.attach(handle)){withContext(Dispatchers.IO){connection.free(handle)};return@LaunchedEffect}
            val sender=launch(Dispatchers.IO){for(action in connection.input)runCatching{action(handle)}}
            try{
                var pixels=IntArray(0);val bitmaps=arrayOfNulls<Bitmap>(2);var which=0
                while(isActive){
                    val frame=withContext(Dispatchers.IO){
                        val size=Rfb.waitFrame(handle);val w=size ushr 16;val h=size and 0xffff
                        if(w<=0||h<=0||w.toLong()*h>32000000)throw IllegalStateException("桌面画面尺寸无效")
                        val fresh=pixels.size!=w*h
                        if(fresh){pixels=IntArray(w*h);for(i in bitmaps.indices)bitmaps[i]=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888)}
                        Rfb.copy(handle,pixels,fresh);which=which xor 1
                        val bitmap=bitmaps[which]!!;bitmap.setPixels(pixels,0,w,0,0,w,h);DesktopFrame(bitmap,w,h)
                    }
                    state=state.copy(frame=frame,error="")
                }
            }finally{connection.stop();withContext(NonCancellable){sender.cancelAndJoin();withContext(Dispatchers.IO){connection.free(handle)}}}
        }catch(e:CancellationException){throw e}catch(e:LinkageError){state=state.copy(frame=null,error="当前设备无法加载远程桌面组件")}
        catch(e:Exception){state=state.copy(frame=null,error=e.message?:"远程桌面连接失败")}
        finally{connection.stop()}
    }
    fun pointer(mask:Int,x:Float,y:Float){val f=state.frame?:return;connection.submit{h->Rfb.pointer(h,mask,(x*(f.width-1)).toInt(),(y*(f.height-1)).toInt())}}
    fun key(code:Int){connection.submit{h->Rfb.key(h,code,true);Rfb.key(h,code,false)}}
    fun chord(modifier:Int,code:Int){connection.submit{h->Rfb.key(h,modifier,true);try{Rfb.key(h,code,true);Rfb.key(h,code,false)}finally{Rfb.key(h,modifier,false)}}}
    NativeRemoteDesktopContent(state,vm.state.connected,scale,{value->if(scale!=value){scale=value;desktopPrefs.edit().putInt("scale",value).apply()}},back,{attempt++},{state=state.copy(scroll=!state.scroll)},
        {state=state.copy(text=it)},::pointer,::key,::chord,{
            val value=state.text;if(value.isNotEmpty()){connection.submit{h->Rfb.typeText(h,value)};state=state.copy(text="")}
        })
}

@Composable private fun NativeRemoteDesktopContent(state:DesktopScreenState,connected:Boolean,scale:Int,onScale:(Int)->Unit,back:()->Unit,retry:()->Unit,toggleScroll:()->Unit,onText:(String)->Unit,pointer:(Int,Float,Float)->Unit,key:(Int)->Unit,chord:(Int,Int)->Unit,onSend:()->Unit){
    var keysOpen by remember{mutableStateOf(false)}
    var scaleOpen by remember{mutableStateOf(false)}
    var inputOpen by rememberSaveable{mutableStateOf(false)}
    val inputFocus=remember{FocusRequester()}
    val keyboard=LocalSoftwareKeyboardController.current
    val focusManager=LocalFocusManager.current
    val inputScope=rememberCoroutineScope()
    val ready=connected&&state.frame!=null
    fun closeInput(){keyboard?.hide();focusManager.clearFocus();inputOpen=false}
    BackHandler(enabled=inputOpen){closeInput()}
    LaunchedEffect(inputOpen,ready){if(inputOpen&&ready){withFrameNanos{};inputFocus.requestFocus();keyboard?.show()}}
    Box(Modifier.fillMaxSize().background(Color.Black).testTag("remoteDesktop")){
        val frame=state.frame
        if(frame!=null)DesktopCanvas(frame,state.scroll,pointer,Modifier.fillMaxSize())
        else Column(Modifier.align(Alignment.Center),horizontalAlignment=Alignment.CenterHorizontally){
            Text(if(connected)state.error.ifBlank{"正在连接电脑桌面…"} else "连接电脑后使用",color=Color.White,fontSize=14.sp)
            if(connected&&state.error.isNotBlank())TextButton(onClick=retry){Text("重试")}
        }
        Row(Modifier.align(Alignment.TopStart).padding(start=12.dp,top=10.dp).clip(RoundedCornerShape(24.dp)).background(Color.Black.copy(alpha=.72f)).padding(horizontal=2.dp),verticalAlignment=Alignment.CenterVertically){
            DesktopToolbarButton(R.drawable.ic_lucide_arrow_left,"返回",true,back)
            TextButton(onClick=toggleScroll,enabled=ready,contentPadding=PaddingValues(horizontal=8.dp)){Text(if(state.scroll)"滚动" else "拖动",color=if(ready)Color.White else Color.Gray,fontSize=13.sp)}
            DesktopToolbarButton(R.drawable.ic_lucide_pencil,"输入文字",ready){
                if(inputOpen)inputScope.launch{inputFocus.requestFocus();keyboard?.show()} else inputOpen=true
            }
            Box{
                TextButton(onClick={scaleOpen=true},contentPadding=PaddingValues(horizontal=8.dp)){Text("${scale}%",color=Color.White,fontSize=13.sp)}
                ModernDropdown(scaleOpen,{scaleOpen=false},180.dp){
                    listOf(50,75,100).forEach{value->PopupMenuRow(R.drawable.ic_lucide_monitor,if(value==100)"原始画质" else "${value}% 分辨率"){scaleOpen=false;onScale(value)}}
                }
            }
            Box{
                DesktopToolbarButton(R.drawable.ic_lucide_ellipsis,"快捷键",ready){keysOpen=true}
                ModernDropdown(keysOpen,{keysOpen=false},200.dp){
                    listOf("Esc" to 0xff1b,"Tab" to 0xff09,"删除" to 0xffff,"开始菜单" to 0xffeb).forEach{(label,code)->
                        PopupMenuRow(R.drawable.ic_lucide_terminal,label){keysOpen=false;key(code)}
                    }
                    listOf("全选" to 'a'.code,"复制" to 'c'.code,"粘贴" to 'v'.code).forEach{(label,code)->
                        PopupMenuRow(R.drawable.ic_lucide_terminal,label){keysOpen=false;chord(0xffe3,code)}
                    }
                    PopupMenuRow(R.drawable.ic_lucide_terminal,"切换窗口"){keysOpen=false;chord(0xffe9,0xff09)}
                }
            }
        }
        if(inputOpen){
            Row(Modifier.align(Alignment.BottomCenter).zIndex(1f)
                .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.systemGestures.only(WindowInsetsSides.Bottom)))
                .padding(horizontal=12.dp,vertical=16.dp).widthIn(max=600.dp).fillMaxWidth()
                .clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colors.surface)
                .pointerInput(Unit){awaitPointerEventScope{while(true)awaitPointerEvent()}}
                .padding(start=8.dp,end=4.dp,bottom=4.dp).testTag("remoteDesktopInput"),verticalAlignment=Alignment.CenterVertically){
                TextField(state.text,onText,Modifier.weight(1f).focusRequester(inputFocus),placeholder={Text("输入文字")},singleLine=true,enabled=ready,
                    keyboardOptions=KeyboardOptions(imeAction=ImeAction.Send),keyboardActions=KeyboardActions(onSend={onSend()}))
                IconButton(onClick=onSend,enabled=ready&&state.text.isNotEmpty()){ModernIcon(R.drawable.ic_lucide_arrow_up,"发送文字")}
                IconButton(onClick={key(0xff0d)},enabled=ready){ModernIcon(R.drawable.ic_lucide_arrow_right,"回车")}
                IconButton(onClick={key(0xff08)},enabled=ready){ModernIcon(R.drawable.ic_lucide_delete,"退格")}
                IconButton(onClick=::closeInput,modifier=Modifier.testTag("closeRemoteDesktopInput")){ModernIcon(R.drawable.ic_lucide_x,"关闭输入")}
            }
        }
    }
}

@Composable private fun DesktopToolbarButton(icon:Int,label:String,enabled:Boolean,onClick:()->Unit){
    IconButton(onClick=onClick,enabled=enabled,modifier=Modifier.size(42.dp)){
        Icon(painterResource(icon),contentDescription=label,modifier=Modifier.size(20.dp),tint=if(enabled)Color.White else Color.Gray)
    }
}

@Composable private fun DesktopCanvas(frame:DesktopFrame,scroll:Boolean,onPointer:(Int,Float,Float)->Unit,modifier:Modifier=Modifier){
    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    val pointer by rememberUpdatedState(onPointer)
    Box(modifier.background(Color.Black).clipToBounds().testTag("remoteDesktopFrame")
        .pointerInput(scroll,frame.width,frame.height){
            awaitEachGesture {
                val down=awaitFirstDown(requireUnconsumed=false);val start=down.position
                var last=start;var multi=false;var dragged=false;var scrolled=false;var elapsed=0L;var scrollRemainder=0f
                val fit=min(size.width.toFloat()/frame.width,size.height.toFloat()/frame.height)
                val imageWidth=frame.width*fit;val imageHeight=frame.height*fit
                fun point(p:Offset):Offset {
                    val center=Offset(size.width/2f,size.height/2f);val local=(p-center-pan)/zoom+center
                    return Offset(((local.x-(size.width-imageWidth)/2f)/imageWidth).coerceIn(0f,1f),((local.y-(size.height-imageHeight)/2f)/imageHeight).coerceIn(0f,1f))
                }
                do {
                    val event=awaitPointerEvent();val pressed=event.changes.filter{it.pressed}
                    if(pressed.size>=2){
                        if(dragged){val p=point(last);pointer(0,p.x,p.y);dragged=false};multi=true
                        val next=(zoom*event.calculateZoom()).coerceIn(1f,4f);val move=event.calculatePan()
                        val bound=Offset(max(0f,(imageWidth*next-size.width)/2f),max(0f,(imageHeight*next-size.height)/2f))
                        pan=Offset((pan.x+move.x).coerceIn(-bound.x,bound.x),(pan.y+move.y).coerceIn(-bound.y,bound.y));zoom=next
                    }else if(!multi){
                        event.changes.firstOrNull()?.let{change->
                            val previous=last;last=change.position;elapsed=change.uptimeMillis-down.uptimeMillis
                            if(change.pressed&&scroll){
                                scrollRemainder+=last.y-previous.y
                                val ticks=(scrollRemainder/40f).toInt().coerceIn(-10,10)
                                if(ticks!=0){scrolled=true;val p=point(last);val button=if(ticks>0)8 else 16;repeat(abs(ticks)){pointer(button,p.x,p.y);pointer(0,p.x,p.y)};scrollRemainder-=ticks*40f}
                            }
                            if(change.pressed&&!scroll&&(last-start).getDistance()>12f){
                                if(!dragged){val p=point(start);pointer(1,p.x,p.y);dragged=true}
                                val p=point(last);pointer(1,p.x,p.y)
                            }
                        }
                    }
                    event.changes.forEach{it.consume()}
                }while(event.changes.any{it.pressed})
                if(!multi){
                    val p=point(last);val distance=(last-start).getDistance()
                    if(dragged)pointer(0,p.x,p.y)
                    else if(distance<12f&&!scrolled){val button=if(elapsed>550)4 else 1;pointer(button,p.x,p.y);pointer(0,p.x,p.y)}
                }
            }
        }){
        Image(frame.bitmap.asImageBitmap(),contentDescription="电脑桌面画面",contentScale=ContentScale.Fit,modifier=Modifier.fillMaxSize().graphicsLayer{scaleX=zoom;scaleY=zoom;translationX=pan.x;translationY=pan.y})
    }
}
