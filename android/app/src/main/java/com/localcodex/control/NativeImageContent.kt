@file:OptIn(androidx.compose.animation.ExperimentalAnimationApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
package com.localcodex.control

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlin.math.abs
import kotlin.math.min

@Composable internal fun NativeImageGallery(vm:NativeViewModel,endpoints:List<String>,remove:((String)->Unit)?=null){
    if(endpoints.isEmpty())return
    val draft=remove!=null
    val columns=minOf(3,endpoints.size)
    val gap=6.dp
    val preferredTile=if(endpoints.size==1&&!draft)156.dp else 110.dp
    // Uploads arrive one at a time. Keep loaded thumbnails when the list grows;
    // an existing image loader does not run again merely because a sibling was added.
    val previewImages=remember(vm,vm.imageRevision){mutableStateMapOf<String,Pair<android.graphics.Bitmap,String>>()}
    LaunchedEffect(endpoints){
        previewImages.keys.filter{it !in endpoints}.forEach{previewImages.remove(it)}
    }
    BoxWithConstraints(Modifier.testTag(if(draft)"draftImageGallery" else "sentImageGallery")
        .widthIn(max=if(draft)Dp.Unspecified else preferredTile*columns+gap*(columns-1)).fillMaxWidth().padding(bottom=7.dp)){
        val tileSize=minOf(preferredTile,((maxWidth-gap*(columns-1))/columns).coerceAtLeast(1.dp))
        val tile:@Composable (String)->Unit={endpoint->key(endpoint){
            Box(Modifier.size(tileSize).testTag("imageTile:$endpoint")){
                NativeImageView(vm,endpoint,Modifier.fillMaxSize(),thumbnail=true,shape=Radius.Card,
                    onOpen={image->previewImages[endpoint]=image to "";vm.showImage(endpoint,image,endpoints,previewImages)},
                    onLoaded={image,mime->previewImages[endpoint]=image to mime})
                if(remove!=null)IconButton(onClick={remove(endpoint)},modifier=Modifier.align(Alignment.TopEnd).size(48.dp)){
                    Box(Modifier.size(24.dp).clip(CircleShape).background(Color.Black.copy(alpha=.55f)),contentAlignment=Alignment.Center){
                        ModernIcon(R.drawable.ic_lucide_x,"移除图片",Modifier.size(14.dp),Color.White)
                    }
                }
            }
        }}
        if(draft)Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(gap)){
            endpoints.forEach{tile(it)}
        }else Column(verticalArrangement=Arrangement.spacedBy(gap)){
            endpoints.chunked(columns).forEach{row->Row(horizontalArrangement=Arrangement.spacedBy(gap)){row.forEach{tile(it)}}}
        }
    }
}
@Composable internal fun NativeImageView(vm:NativeViewModel,endpoint:String,modifier:Modifier,thumbnail:Boolean=false,onOpen:((android.graphics.Bitmap)->Unit)?=null,onLoaded:((android.graphics.Bitmap,String)->Unit)?=null,adaptive:Boolean=false,shape:androidx.compose.ui.graphics.Shape=Radius.Field){
    if(endpoint.startsWith("missing-image:")){
        Box(modifier.clip(shape).background(NativeWash),contentAlignment=Alignment.Center){Text("图片暂不可用",fontSize=12.sp,color=NativeMuted)}
        return
    }
    val maxSide=if(thumbnail)512 else 2048
    val cached=remember(vm,endpoint,thumbnail,vm.imageRevision){vm.cachedImage(endpoint,maxSide)}
    val dimensions=remember(vm,endpoint,vm.imageRevision){vm.cachedImageDimensions(endpoint)}
    var bitmap by remember(vm,endpoint,thumbnail,vm.imageRevision){mutableStateOf(cached?.first)}
    var failure by remember(endpoint,vm.imageRevision){mutableStateOf(false)}
    var failureReason by remember(endpoint,vm.imageRevision){mutableStateOf("")}
    var attempt by remember(endpoint,vm.imageRevision){mutableIntStateOf(0)}
    val loadedAction by rememberUpdatedState(onLoaded)
    val openAction by rememberUpdatedState(onOpen)
    LaunchedEffect(endpoint,cached,vm.imageRevision){cached?.let{loadedAction?.invoke(it.first,it.second)}}
    suspend fun load(maxSide:Int)=vm.loadImage(endpoint,maxSide)
    LaunchedEffect(endpoint,attempt,vm.imageRevision,vm.state.connected){
        if(bitmap!=null)return@LaunchedEffect
        failure=false;failureReason=""
        repeat(3){tryIndex->
            try{
                val revision=vm.imageRevision
                val(loaded,type)=load(maxSide)
                if(revision!=vm.imageRevision)return@LaunchedEffect
                bitmap=loaded;loadedAction?.invoke(loaded,type)
                return@LaunchedEffect
            }catch(error:kotlinx.coroutines.CancellationException){throw error
            }catch(error:Exception){
                val message=error.message.orEmpty()
                val retryable=error is java.io.IOException||message.contains("连接",true)||message.contains("读取失败 (5")
                if(!retryable||tryIndex==2){
                    failure=true
                    val status=Regex("读取失败 \\((\\d{3})\\)").find(message)?.groupValues?.get(1)
                    failureReason=if(status!=null)"图片读取失败（HTTP $status）" else if(message in setOf("图片格式无法解码","图片超过本机预览大小限制","连接已断开"))message else "网络读取失败"
                    return@LaunchedEffect
                }
                delay(if(tryIndex==0)400 else 1000)
            }
        }
    }
    NativeImageContent(NativeImageState(bitmap,dimensions,failure,failureReason),modifier,thumbnail,adaptive,shape){
        if(failure){failure=false;attempt++}else bitmap?.let{image->if(openAction!=null)openAction?.invoke(image) else vm.showImage(endpoint,image)}
    }
}

internal data class NativeImageState(
    val bitmap:android.graphics.Bitmap?,val dimensions:android.util.Size?,
    val failed:Boolean,val failureReason:String,
)

@Composable internal fun NativeImageContent(
    state:NativeImageState,modifier:Modifier=Modifier,thumbnail:Boolean=false,adaptive:Boolean=false,
    shape:androidx.compose.ui.graphics.Shape=Radius.Field,onClick:()->Unit={},
){
    val bitmap=state.bitmap;val dimensions=state.dimensions
    val failure=state.failed;val failureReason=state.failureReason
    val imageFrame:@Composable (Modifier)->Unit={frame->
        Box(frame.clip(shape).background(NativeWash).clickable(enabled=bitmap!=null||failure,onClick=onClick),contentAlignment=Alignment.Center){bitmap?.let{Image(it.asImageBitmap(),"图片",modifier=Modifier.fillMaxSize(),contentScale=if(thumbnail)ContentScale.Crop else ContentScale.Fit)}?:if(failure)Text("${failureReason.ifBlank{"加载失败"}}，点击重试",fontSize=12.sp,color=NativeMuted,textAlign=TextAlign.Center,modifier=Modifier.padding(12.dp)) else CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp,color=NativeMuted)}
    }
    if(adaptive){
        val heightLimit=minOf(320.dp,LocalConfiguration.current.screenHeightDp.dp*0.5f)
        BoxWithConstraints(modifier,contentAlignment=Alignment.CenterStart){
            val loaded=bitmap
            val widthPixels=loaded?.width?:dimensions?.width
            val heightPixels=loaded?.height?:dimensions?.height
            if(widthPixels!=null&&heightPixels!=null){
                val ratio=widthPixels.toFloat()/heightPixels.coerceAtLeast(1)
                val width=minOf(maxWidth,heightLimit*ratio)
                imageFrame(Modifier.size(width,width/ratio))
            }else imageFrame(Modifier.fillMaxWidth().height(minOf(96.dp,heightLimit)))
        }
    }else imageFrame(modifier)
}
@Composable internal fun NativeImagePreview(initialBitmap:android.graphics.Bitmap,vm:NativeViewModel,endpoint:String,close:()->Unit,endpoints:List<String> = listOf(endpoint),startIndex:Int=0,thumbnails:Map<String,Pair<android.graphics.Bitmap,String>> = emptyMap()){
    val context=LocalContext.current
    var currentIndex by remember(endpoints,endpoint){mutableIntStateOf(startIndex)}
    val currentEndpoint=endpoints[currentIndex]
    val fullImages=remember(endpoints){mutableStateMapOf<String,Pair<android.graphics.Bitmap,String>>()}
    val thumb=thumbnails[currentEndpoint]
    val full=fullImages[currentEndpoint]
    val bitmap=thumb?.first?:initialBitmap.takeIf{currentEndpoint==endpoint}?:full?.first
    var fullFailure by remember(currentEndpoint){mutableStateOf(false)}
    var fullAttempt by remember(currentEndpoint){mutableIntStateOf(0)}
    LaunchedEffect(currentEndpoint,fullAttempt){
        fullImages.keys.filter{key->key!=currentEndpoint&&key!=endpoints.getOrNull(currentIndex-1)&&key!=endpoints.getOrNull(currentIndex+1)}.forEach{fullImages.remove(it)}
        if(fullImages.containsKey(currentEndpoint))return@LaunchedEffect
        fullFailure=false
        try{fullImages[currentEndpoint]=vm.loadImage(currentEndpoint,2048)}
        catch(error:kotlinx.coroutines.CancellationException){throw error}
        catch(_:Exception){fullFailure=true}
    }
    val save=rememberNativeSaveAction{
        val bytes=vm.originalImageBytes(currentEndpoint)
        val mime=nativeEncodedImageMime(bytes)
        nativeSavePublicFile(context,nativeImageName(currentEndpoint,mime),mime){it.write(bytes)}
        "图片已保存到相册/Codex"
    }
    NativeImagePreviewContent(
        NativeImagePreviewState(endpoints,currentIndex,bitmap,full?.first,
            endpoints.getOrNull(currentIndex-1)?.let{fullImages[it]?.first?:thumbnails[it]?.first},
            endpoints.getOrNull(currentIndex+1)?.let{fullImages[it]?.first?:thumbnails[it]?.first},
            fullFailure,save.saving),
        onSelect={currentIndex=it},onRetry={fullAttempt++},onSave=save.save,close=close,
    )
}

internal data class NativeImagePreviewState(
    val endpoints:List<String>,val currentIndex:Int,val bitmap:android.graphics.Bitmap?,val fullImage:android.graphics.Bitmap?,
    val previousImage:android.graphics.Bitmap?,val nextImage:android.graphics.Bitmap?,
    val fullImageFailed:Boolean,val saving:Boolean,
)

@Composable internal fun NativeImagePreviewContent(
    state:NativeImagePreviewState,onSelect:(Int)->Unit,onRetry:()->Unit,onSave:()->Unit,close:()->Unit,
){
    val scope=rememberCoroutineScope()
    val currentIndex by rememberUpdatedState(state.currentIndex)
    val endpoints by rememberUpdatedState(state.endpoints)
    val selectImage by rememberUpdatedState(onSelect)
    val bitmap=state.bitmap;val full=state.fullImage
    var scale by remember{mutableFloatStateOf(1f)}
    var pan by remember{mutableStateOf(Offset.Zero)}
    var dismissY by remember{mutableFloatStateOf(0f)}
    var swipeX by remember{mutableFloatStateOf(0f)}
    var swipeDirection by remember{mutableIntStateOf(0)}
    var toolbarVisible by remember{mutableStateOf(true)}
    var motion by remember{mutableStateOf<kotlinx.coroutines.Job?>(null)}
    val resolutionAlpha=animateFloatAsState(if(full==null)0f else 1f,tween(140,easing=NativeControlEase),label="imageResolution")
    // Compose 1.7's custom-width Dialog measures against screenHeightDp, which
    // excludes the bars. Use native window constraints and size that window in
    // NativeDialogSystemBars instead of accepting that shorter measurement.
    Dialog(onDismissRequest=close,properties=DialogProperties(dismissOnClickOutside=false,usePlatformDefaultWidth=true,decorFitsSystemWindows=false)){
        NativeDialogSystemBars(Color.Black,lightIcons=true,immersive=true)
        BoxWithConstraints(Modifier.fillMaxSize()){
                val density=LocalDensity.current
                val width=with(density){maxWidth.toPx()};val height=with(density){maxHeight.toPx()}
                val fitted=min(width/(bitmap?.width?:1),height/(bitmap?.height?:1))
                val imageWidth=(bitmap?.width?:1)*fitted;val imageHeight=(bitmap?.height?:1)*fitted
                val currentImageSize by rememberUpdatedState(Size(imageWidth,imageHeight))
                fun clampPan(target:Offset,atScale:Float):Offset{
                    val limitX=((currentImageSize.width*atScale-width)/2f).coerceAtLeast(0f)
                    val limitY=((currentImageSize.height*atScale-height)/2f).coerceAtLeast(0f)
                    return Offset(target.x.coerceIn(-limitX,limitX),target.y.coerceIn(-limitY,limitY))
                }
                fun animateZoom(target:Float){
                    motion?.cancel()
                    val initial=scale
                    val initialPan=pan
                    motion=scope.launch{animate(initial,target,animationSpec=tween(220,easing=NativeControlEase)){value,_->
                        scale=value;pan=clampPan(initialPan,value)
                    };if(target==1f)pan=Offset.Zero}
                }
                val showToolbar by remember{derivedStateOf{abs(dismissY)<20f}}
                Box(Modifier.fillMaxSize().clipToBounds().testTag("imagePreviewGestureSurface").drawBehind{
                    val fade=(1f-abs(dismissY)/(size.height*.7f)).coerceIn(.25f,1f)
                    drawRect(AppColor.PreviewBackdrop.copy(alpha=fade))
                }
                    .pointerInput(width,height){detectTapGestures(onTap={toolbarVisible=!toolbarVisible},onDoubleTap={animateZoom(if(scale>1.01f)1f else 2.5f)})}
                    .pointerInput(width,height){
                        awaitEachGesture{
                            val down=awaitFirstDown(requireUnconsumed=false)
                            motion?.cancel();motion=null
                            var velocity=VelocityTracker().apply{addPosition(down.uptimeMillis,down.position)}
                            var total=Offset.Zero
                            var dismissing=false
                            var swiping=false
                            var transformed=false
                            while(true){
                                val event=awaitPointerEvent()
                                val active=event.changes.count{it.pressed}
                                if(active<=1)(event.changes.firstOrNull{it.pressed}?:event.changes.firstOrNull())?.let{velocity.addPosition(it.uptimeMillis,it.position)}
                                if(active==0)break
                                val zoomChange=event.calculateZoom()
                                val movement=event.calculatePan()
                                if(active>1)transformed=true
                                if(transformed||scale>1.01f||zoomChange!=1f){
                                    motion?.cancel()
                                    dismissing=false;swiping=false;total=Offset.Zero;velocity=VelocityTracker();swipeX=0f;swipeDirection=0
                                    val next=(scale*zoomChange).coerceIn(1f,5f)
                                    val center=event.calculateCentroid()-Offset(width/2f,height/2f)
                                    val factor=next/scale
                                    scale=next
                                    pan=clampPan(pan+movement+(center-pan)*(1f-factor),next)
                                    dismissY=0f
                                    event.changes.forEach{it.consume()}
                                }else{
                                    total+=movement
                                    if(!dismissing&&!swiping&&abs(total.y)>viewConfiguration.touchSlop&&abs(total.y)>abs(total.x)*1.25f)dismissing=true
                                    if(!dismissing&&!swiping&&endpoints.size>1&&abs(total.x)>viewConfiguration.touchSlop&&abs(total.x)>abs(total.y)*1.25f)swiping=true
                                    if(dismissing){
                                        motion?.cancel()
                                        dismissY=(dismissY+movement.y).coerceIn(-height,height)
                                        event.changes.forEach{it.consume()}
                                    }else if(swiping){
                                        motion?.cancel()
                                        val next=swipeX+movement.x
                                        val direction=if(next<0f)1 else if(next>0f)-1 else 0
                                        swipeDirection=direction.takeIf{currentIndex+it in endpoints.indices}?:0
                                        swipeX=if(swipeDirection==0)next.coerceIn(-width*.12f,width*.12f) else next.coerceIn(-width,width)
                                        event.changes.forEach{it.consume()}
                                    }
                                }
                            }
                            if(swiping){
                                val direction=if(swipeX<0)1 else -1
                                val target=currentIndex+direction
                                val shouldChange=abs(swipeX)>width*.18f||abs(velocity.calculateVelocity().x)>with(density){800.dp.toPx()}
                                val start=swipeX
                                if(shouldChange&&target in endpoints.indices){
                                    motion=scope.launch{
                                        animate(start,-direction*width,animationSpec=tween(220,easing=NativeControlEase)){value,_->swipeX=value}
                                        selectImage(target);scale=1f;pan=Offset.Zero;dismissY=0f;swipeX=0f;swipeDirection=0
                                    }
                                }else{
                                    motion=scope.launch{
                                        animate(start,0f,animationSpec=tween(220,easing=NativeControlEase)){value,_->swipeX=value}
                                        swipeDirection=0
                                    }
                                }
                                return@awaitEachGesture
                            }
                            if(!dismissing&&swipeX!=0f){
                                val start=swipeX
                                motion=scope.launch{animate(start,0f,animationSpec=tween(220,easing=NativeControlEase)){value,_->swipeX=value};swipeDirection=0}
                                return@awaitEachGesture
                            }
                            val velocityY=velocity.calculateVelocity().y
                            val quickDismiss=dismissing&&abs(dismissY)>with(density){24.dp.toPx()}&&velocityY*dismissY>0f&&abs(velocityY)>with(density){800.dp.toPx()}
                            if(dismissing&&(abs(dismissY)>min(height*.18f,with(density){112.dp.toPx()})||quickDismiss)){
                                val start=dismissY
                                val target=if(start<0f)-height else height
                                motion=scope.launch{animate(start,target,animationSpec=tween(160,easing=NativeControlEase)){value,_->dismissY=value};close()}
                            }
                            else if(dismissY!=0f){
                                val start=dismissY
                                motion=scope.launch{animate(start,0f,animationSpec=spring(stiffness=Spring.StiffnessMedium,dampingRatio=Spring.DampingRatioNoBouncy)){value,_->dismissY=value}}
                            }
                        }
                    },contentAlignment=Alignment.Center){
                    val adjacentIndex=currentIndex+swipeDirection
                    if(swipeDirection!=0&&adjacentIndex in endpoints.indices){
                        val adjacentBitmap=if(swipeDirection<0)state.previousImage else state.nextImage
                        if(adjacentBitmap!=null){
                            val adjacentFit=min(width/adjacentBitmap.width,height/adjacentBitmap.height)
                            Box(Modifier.size(with(density){(adjacentBitmap.width*adjacentFit).toDp()},with(density){(adjacentBitmap.height*adjacentFit).toDp()})
                                .testTag("imagePreviewNeighbor")
                                .graphicsLayer{translationX=swipeX+swipeDirection*width;translationY=dismissY}){
                                Image(adjacentBitmap.asImageBitmap(),null,Modifier.fillMaxSize(),contentScale=ContentScale.Fit)
                            }
                        }
                    }
                    if(bitmap!=null)Box(modifier=Modifier
                        .size(with(density){imageWidth.toDp()},with(density){imageHeight.toDp()})
                        .semantics(mergeDescendants=true){contentDescription="图片预览";stateDescription="${(scale*100).toInt()}% · ${currentIndex+1}/${endpoints.size}"}
                        .graphicsLayer{scaleX=scale;scaleY=scale;translationX=pan.x+swipeX;translationY=pan.y+dismissY}){
                        Image(bitmap.asImageBitmap(),null,Modifier.fillMaxSize(),contentScale=ContentScale.Fit)
                        if(full!=null)Image(full.asImageBitmap(),null,Modifier.fillMaxSize().testTag("fullImageLayer").graphicsLayer{alpha=resolutionAlpha.value},contentScale=ContentScale.Fit)
                    } else CircularProgressIndicator(Modifier.size(28.dp),color=Color.White,strokeWidth=2.dp)
                }
            if(state.fullImageFailed)TextButton(onClick=onRetry,modifier=Modifier.align(Alignment.BottomCenter).padding(bottom=24.dp).background(AppColor.PreviewToolbarScrim,Radius.Button).testTag("imagePreviewRetry")){
                Text("原图加载失败，点击重试",color=Color.White)
            }
            AnimatedVisibility(toolbarVisible&&showToolbar,Modifier.align(Alignment.TopEnd).windowInsetsPadding(WindowInsets.displayCutout).padding(8.dp)){
                Row(Modifier.background(AppColor.PreviewToolbarScrim,Radius.Panel)){
                IconButton(enabled=!state.saving,onClick=onSave){ModernIcon(R.drawable.ic_lucide_arrow_down_to_line,if(state.saving)"正在保存图片" else "保存图片",Modifier.size(22.dp),Color.White)}
                IconButton(onClick={animateZoom((scale+1f).coerceAtMost(5f))}){ModernIcon(R.drawable.ic_lucide_zoom_in,"放大图片",Modifier.size(22.dp),Color.White)}
                IconButton(onClick={animateZoom(1f)}){ModernIcon(R.drawable.ic_lucide_scan,"复位图片",Modifier.size(22.dp),Color.White)}
                IconButton(onClick=close){ModernIcon(R.drawable.ic_lucide_x,"关闭图片预览",Modifier.size(22.dp),Color.White)}
                }
            }
        }
    }
}
