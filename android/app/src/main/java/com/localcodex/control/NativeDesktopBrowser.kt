package com.localcodex.control

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.URLEncoder

private class BrowserDrag {var x=0f;var y=0f;var atX=0f;var atY=0f}

@Composable internal fun NativeDesktopBrowser(vm:NativeViewModel){
    val scope=rememberCoroutineScope()
    val focus=LocalFocusManager.current
    var tabs by remember{mutableStateOf(emptyList<JSONObject>())}
    var target by remember{mutableStateOf("")}
    var available by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf("")}
    var endpoint by remember{mutableStateOf("")}
    var address by remember{mutableStateOf("")}
    var editingAddress by remember{mutableStateOf(false)}
    var text by remember{mutableStateOf("")}
    var frame by remember(target){mutableStateOf<android.graphics.Bitmap?>(null)}
    var viewportWidth by remember(target){mutableStateOf(1f)}
    var viewportHeight by remember(target){mutableStateOf(1f)}
    val drag=remember(target){BrowserDrag()}
    var menu by remember{mutableStateOf(false)}
    suspend fun loadTabs(){
        val result=vm.threadToolRequest("GET","/api/browser/tabs")
        available=result.optBoolean("available");error=result.optString("error")
        val data=result.getJSONArray("tabs");tabs=(0 until data.length()).map{data.getJSONObject(it)}
        if(tabs.none{it.getString("id")==target})target=tabs.firstOrNull()?.getString("id").orEmpty()
    }
    suspend fun action(value:JSONObject){vm.threadToolRequest("POST","/api/browser/${URLEncoder.encode(target,"UTF-8")}/action",value)}
    fun send(value:JSONObject){scope.launch{try{action(value);error=""}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message.orEmpty()}}}
    LaunchedEffect(Unit){try{loadTabs()}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message.orEmpty()}}
    val foreground=vm.uiForeground
    LaunchedEffect(target,foreground){
        if(target.isBlank()||!foreground)return@LaunchedEffect
        var nextFrame=0L
        while(isActive){
            try{
                if(drag.x!=0f||drag.y!=0f){
                    val x=drag.x;val y=drag.y;drag.x=0f;drag.y=0f
                    action(JSONObject().put("type","scroll").put("x",drag.atX).put("y",drag.atY).put("deltaX",x.coerceIn(-10000f,10000f)).put("deltaY",y.coerceIn(-10000f,10000f)))
                }
                val now=android.os.SystemClock.elapsedRealtime()
                if(now>=nextFrame){
                    val response=vm.threadToolRequest("GET","/api/browser/${URLEncoder.encode(target,"UTF-8")}/screenshot")
                    val decoded=withContext(Dispatchers.Default){val bytes=Base64.decode(response.getString("data"),Base64.DEFAULT);BitmapFactory.decodeByteArray(bytes,0,bytes.size)}
                    frame=decoded;viewportWidth=response.getDouble("width").toFloat();viewportHeight=response.getDouble("height").toFloat()
                    if(!editingAddress&&response.optString("url").isNotBlank())address=response.optString("url")
                    error="";nextFrame=android.os.SystemClock.elapsedRealtime()+500
                }
            }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message.orEmpty();nextFrame=android.os.SystemClock.elapsedRealtime()+1500}
            delay(50)
        }
    }
    Column(Modifier.fillMaxWidth().testTag("desktopBrowser"),verticalArrangement=Arrangement.spacedBy(8.dp)){
        if(!available){
            Text(error.ifBlank{"正在查找电脑浏览器…"},fontSize=13.sp,color=NativeMuted)
            NativeTextEntry(endpoint,{endpoint=it},"电脑浏览器调试地址")
            TextButton(onClick={scope.launch{try{vm.threadToolRequest("PUT","/api/browser/connection",JSONObject().put("endpoint",endpoint.trim()));loadTabs()}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message.orEmpty()}}},enabled=endpoint.isNotBlank()){Text("连接")}
        }else{
            Row(Modifier.fillMaxWidth()){
                ChromeButton(R.drawable.ic_lucide_arrow_left,"网页后退",{send(JSONObject().put("type","back"))},enabled=target.isNotBlank())
                ChromeButton(R.drawable.ic_lucide_arrow_right,"网页前进",{send(JSONObject().put("type","forward"))},enabled=target.isNotBlank())
                ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新网页",{send(JSONObject().put("type","reload"))},enabled=target.isNotBlank())
                Box{
                    ChromeButton(R.drawable.ic_lucide_copy,"浏览器标签",{menu=true;scope.launch{try{loadTabs()}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message.orEmpty()}}})
                    ModernDropdown(menu,{menu=false},280.dp){tabs.forEach{tab->PopupMenuRow(R.drawable.ic_lucide_globe,tab.optString("title").ifBlank{tab.optString("url")}){target=tab.getString("id");menu=false}}}
                }
            }
            OutlinedTextField(address,{address=it},singleLine=true,modifier=Modifier.fillMaxWidth().onFocusChanged{editingAddress=it.isFocused},label={Text("网页地址")},trailingIcon={IconButton(onClick={focus.clearFocus();send(JSONObject().put("type","navigate").put("url",address.trim().let{if(it.contains("://")||it=="about:blank")it else "https://$it"}))}){ModernIcon(R.drawable.ic_lucide_arrow_right,"打开网页")}})
            frame?.let{bitmap->
                Image(bitmap.asImageBitmap(),contentDescription="电脑浏览器画面",modifier=Modifier.fillMaxWidth().aspectRatio(viewportWidth/viewportHeight).testTag("desktopBrowserFrame")
                    .pointerInput(target,viewportWidth,viewportHeight){detectTapGestures{position->focus.clearFocus();send(JSONObject().put("type","click").put("x",(position.x/size.width*viewportWidth).coerceIn(0f,viewportWidth)).put("y",(position.y/size.height*viewportHeight).coerceIn(0f,viewportHeight)))}}
                    .pointerInput(target,viewportWidth,viewportHeight){detectDragGestures{change,amount->change.consume();drag.atX=(change.position.x/size.width*viewportWidth).coerceIn(0f,viewportWidth);drag.atY=(change.position.y/size.height*viewportHeight).coerceIn(0f,viewportHeight);drag.x-=amount.x/size.width*viewportWidth;drag.y-=amount.y/size.height*viewportHeight}})
            }
            if(target.isNotBlank()){
                Row(Modifier.fillMaxWidth()){
                    OutlinedTextField(text,{text=it},Modifier.weight(1f),placeholder={Text("向网页输入文字")},maxLines=3)
                    IconButton(onClick={val pending=text;scope.launch{try{action(JSONObject().put("type","text").put("text",pending));if(text==pending)text=""}catch(e:CancellationException){throw e}catch(e:Exception){error=e.message.orEmpty()}}},enabled=text.isNotBlank()){ModernIcon(R.drawable.ic_lucide_arrow_up,"输入文字")}
                    IconButton(onClick={send(JSONObject().put("type","key").put("key","Enter"))}){ModernIcon(R.drawable.ic_lucide_arrow_right,"网页回车")}
                }
            }
            if(error.isNotBlank())Text(error,color=MaterialTheme.colors.error,fontSize=12.sp)
            if(tabs.isEmpty())Text("电脑浏览器没有可控制的网页标签",color=NativeMuted,fontSize=13.sp)
        }
    }
}
