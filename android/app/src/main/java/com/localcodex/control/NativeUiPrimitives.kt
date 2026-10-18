@file:OptIn(androidx.compose.animation.ExperimentalAnimationApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
package com.localcodex.control

import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.material.*
import androidx.compose.material.Button as MaterialButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.min

internal val NativeInk:Color @Composable get()=MaterialTheme.colors.onSurface
internal val NativeMuted:Color @Composable get()=MaterialTheme.colors.onSurface.copy(alpha=0.64f)
internal val NativeWash:Color @Composable get()=LocalNativeTheme.current.palette.wash
internal val NativeAccent:Color @Composable get()=MaterialTheme.colors.primary
internal val NativeGlassEdge:Color @Composable get()=MaterialTheme.colors.onSurface.copy(alpha=.09f)
@Composable internal fun NativePrimaryButton(onClick:()->Unit,modifier:Modifier=Modifier,enabled:Boolean=true,interactionSource:MutableInteractionSource=remember{MutableInteractionSource()},content:@Composable RowScope.()->Unit){
    MaterialButton(onClick=onClick,modifier=modifier.heightIn(min=48.dp),enabled=enabled,interactionSource=interactionSource,shape=Radius.Button,elevation=null,contentPadding=PaddingValues(horizontal=24.dp,vertical=12.dp)){
        ProvideTextStyle(TextStyle(fontSize=16.sp,fontWeight=FontWeight.Medium)){content()}
    }
}
internal val NativeControlEase=CubicBezierEasing(0.23f,1f,0.32f,1f)
internal fun nativeDisclosureEnter()=expandVertically(animationSpec=spring(dampingRatio=1f,stiffness=900f))+fadeIn(tween(120,easing=NativeControlEase))
internal fun nativeDisclosureExit()=shrinkVertically(animationSpec=spring(dampingRatio=1f,stiffness=1200f))+fadeOut(tween(100,easing=NativeControlEase))
internal fun nativeChevronMotion()=spring<Float>(dampingRatio=1f,stiffness=1000f,visibilityThreshold=0.1f)
internal fun nativePressMotion(pressed:Boolean)=tween<Float>(if(pressed)80 else 120,easing=NativeControlEase)
@Composable internal fun ChromeControl(click:()->Unit,emphasized:Boolean,modifier:Modifier=Modifier,enabled:Boolean=true,content:@Composable ()->Unit){
    val interaction=remember{MutableInteractionSource()}
    val pressed by interaction.collectIsPressedAsState()
    val scale=animateFloatAsState(if(pressed)0.97f else 1f,nativePressMotion(pressed),label="chromePress")
    val floating=LocalNativeFloatingChrome.current
    val touch: @Composable ()->Unit={Box(Modifier.fillMaxSize().clip(if(floating)CircleShape else Radius.Button)
        .background(if(emphasized)NativeWash else Color.Transparent)
        .clickable(enabled=enabled,interactionSource=interaction,indication=LocalIndication.current,role=Role.Button,onClick=click),contentAlignment=Alignment.Center){content()}}
    val frame=modifier.size(48.dp).graphicsLayer{scaleX=scale.value;scaleY=scale.value}
    if(floating)NativeGlassSurface(frame,shape=CircleShape,content=touch) else Box(frame){touch()}
}
@Composable internal fun ModernIcon(icon:Int,label:String?=null,modifier:Modifier=Modifier.size(20.dp),tint:Color=NativeInk){
    Icon(painterResource(icon),label,modifier=modifier,tint=tint)
}
@Composable internal fun ChromeButton(icon:Int,label:String,click:()->Unit,emphasized:Boolean=false,enabled:Boolean=true){
    ChromeControl(click,emphasized,enabled=enabled){ModernIcon(icon,label,Modifier.size(21.dp),if(enabled)NativeInk else NativeMuted)}
}
@Composable internal fun NativeTextEntry(value:String,change:(String)->Unit,hint:String,modifier:Modifier=Modifier,surface:Color=NativeWash,label:String=hint,enabled:Boolean=true){
    Box(modifier.clip(Radius.Field).background(surface).padding(14.dp)) {
        if(value.isEmpty())Text(hint,color=NativeMuted,fontSize=16.sp)
        BasicTextField(value,change,enabled=enabled,textStyle=TextStyle(color=NativeInk,fontSize=16.sp),modifier=Modifier.fillMaxWidth().semantics{if(label.isNotBlank())contentDescription=label})
    }
}
