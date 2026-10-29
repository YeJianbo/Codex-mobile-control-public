package com.localcodex.control

import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceError
import android.webkit.RenderProcessGoneDetail
import androidx.core.view.doOnLayout
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Alignment
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.viewinterop.AndroidView

private fun Color.documentCss():String{
    val color=toArgb()
    return "rgba(${android.graphics.Color.red(color)},${android.graphics.Color.green(color)},${android.graphics.Color.blue(color)},$alpha)"
}

/** Isolated local document layout. No scripts, network requests or filesystem URLs. */
@Composable internal fun NativeDocumentWebContent(page:NativeDocumentPage,topInset:Dp,open:(String)->Unit,modifier:Modifier=Modifier){
    val background=MaterialTheme.colors.background
    val light=MaterialTheme.colors.isLight
    val ink=NativeInk;val muted=NativeMuted;val wash=NativeWash
    val captured=LocalNativeGlassMode.current.samplesBackdrop
    val latestOpen by rememberUpdatedState(open)
    var loading by remember{mutableStateOf(true)}
    var failure by remember{mutableStateOf("")}
    var retry by remember{mutableIntStateOf(0)}
    val scrollPosition=remember{mutableIntStateOf(0)}
    NativeBackdropScrollMotion{scrollPosition.intValue}
    val html=remember(page,background,ink,muted,wash,light,topInset){
        """<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
        <style>:root{color-scheme:${if(light)"light" else "dark"}}*{box-sizing:border-box}
        html,body{background:${background.documentCss()}!important;color:${ink.documentCss()}!important}
        body{font-family:system-ui,sans-serif;font-size:16px;line-height:1.65;margin:0;padding:${topInset.value+18}px 20px 24px;overflow-wrap:anywhere}
        p{margin:0 0 .8em}h1,h2,h3,h4{line-height:1.35;margin:1em 0 .5em}img{max-width:100%;height:auto}a{color:#3566ef}
        ::selection{background:rgba(53,102,239,.28);color:inherit}pre,code{font-family:monospace;white-space:pre-wrap}
        .table-scroll{overflow:auto;max-width:100%;margin:12px 0}table{border-collapse:collapse;min-width:100%;font-size:14px}
        th,td{border:1px solid ${muted.copy(alpha=.3f).documentCss()};padding:9px 12px;vertical-align:top;text-align:start;min-width:88px}
        th{background:${wash.documentCss()};font-weight:500}td p{margin:0}
        .sheet thead th{position:sticky;top:0;z-index:2}.sheet tr>th:first-child{position:sticky;left:0;min-width:42px;z-index:1}
        .sheet td{white-space:pre-wrap;max-width:320px}.slide{position:relative;width:100%;overflow:hidden;font-size:3vw;line-height:1.35}
        .slide p{margin:0}.slide img{width:100%;height:100%;object-fit:contain}
        </style></head><body>${page.html}</body></html>""".trimIndent()
    }
    Box(modifier.fillMaxSize().testTag("documentWebContent").semantics{stateDescription=if(loading)"正在排版" else if(failure.isEmpty())"文档已就绪" else "文档加载失败"}){
    if(failure.isEmpty())key(retry){AndroidView(factory={context->WebView(context).apply{
        // A captured Compose layer cannot reuse WebView's GL tile functor as a
        // second render target. Rasterize this viewport before the glass samples it.
        setLayerType(if(captured)android.view.View.LAYER_TYPE_SOFTWARE else android.view.View.LAYER_TYPE_NONE,null)
        setOnScrollChangeListener{_,x,y,_,_->scrollPosition.intValue=x+y}
        setBackgroundColor(background.toArgb())
        settings.apply{
            javaScriptEnabled=false;allowFileAccess=false;allowContentAccess=false;blockNetworkLoads=true
            setSupportZoom(true);builtInZoomControls=true;displayZoomControls=false
            useWideViewPort=true;loadWithOverviewMode=true
        }
        webViewClient=object:WebViewClient(){
            override fun onPageStarted(view:WebView,url:String,favicon:android.graphics.Bitmap?){loading=true;failure=""}
            override fun onPageFinished(view:WebView,url:String){
                if(view.tag!=null)view.postVisualStateCallback(0,object:WebView.VisualStateCallback(){override fun onComplete(requestId:Long){if(view.tag!=null)loading=false}})
            }
            override fun onRenderProcessGone(view:WebView,detail:RenderProcessGoneDetail):Boolean{
                // Remove and destroy this view through AndroidView's release path;
                // returning true keeps a lost renderer from taking down the host app.
                loading=false;failure="文档显示中断，请重新加载"
                return true
            }
            override fun onReceivedError(view:WebView,request:WebResourceRequest,error:WebResourceError){
                if(request.isForMainFrame){failure="文档未能显示";loading=false}
            }
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean{
                val target=request.url.toString()
                if(request.url.scheme in listOf("about","data")||request.url.host=="document.invalid"&&request.url.path in listOf("","/"))return false
                if(request.url.scheme in listOf("http","https"))latestOpen(target.removePrefix("https://document.invalid/"))
                return true
            }
        }
    }},modifier=Modifier.fillMaxSize(),onRelease={it.tag=null;it.destroy()},update={view->
        val layer=if(captured)android.view.View.LAYER_TYPE_SOFTWARE else android.view.View.LAYER_TYPE_NONE
        if(view.layerType!=layer)view.setLayerType(layer,null)
        view.setBackgroundColor(background.toArgb())
        val request=html to retry
        if(view.tag!=request){
            view.tag=request
            // The initial AndroidView update can run before its first layout.
            // Load after sizing so viewport units do not start at zero.
            view.doOnLayout{if(view.tag==request)view.loadDataWithBaseURL("https://document.invalid/",html,"text/html","UTF-8","https://document.invalid/")}
        }
    })}
    if(loading)NativeRunningTitle("正在排版…",rememberNativeRunningPulse(true),modifier=Modifier.align(Alignment.Center))
    if(failure.isNotEmpty())androidx.compose.foundation.layout.Column(Modifier.align(Alignment.Center),horizontalAlignment=Alignment.CenterHorizontally){
        androidx.compose.material.Text(failure,color=ink)
        androidx.compose.material.TextButton(onClick={failure="";loading=true;retry++}){androidx.compose.material.Text("重新加载文档")}
    }
    }
}
