package com.localcodex.control

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.sp

private val DashboardEase=CubicBezierEasing(.22f,1f,.36f,1f)

@Composable internal fun DashboardCard(
    modifier:Modifier=Modifier,
    color:Color=MaterialTheme.colors.surface,
    content:@Composable ColumnScope.()->Unit
) {
    NativeSettingsGroup(modifier,color){
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp),content=content)
    }
}

@Composable internal fun DashboardTabs(
    options:List<Pair<String,String>>,selected:String,onSelect:(String)->Unit,
    modifier:Modifier=Modifier,enabled:Boolean=true
) {
    if(options.isEmpty())return
    val selectedIndex=options.indexOfFirst{it.first==selected}
    val position=animateFloatAsState(selectedIndex.coerceAtLeast(0).toFloat(),tween(170,easing=DashboardEase),label="dashboardTabPosition")
    val surface=MaterialTheme.colors.surface
    val ink=MaterialTheme.colors.onSurface
    val primary=MaterialTheme.colors.primary
    val light=MaterialTheme.colors.isLight
    val liquid=LocalNativeGlassMode.current.floatingChrome
    val shape=if(liquid)Radius.Chip else Radius.Control
    val selectedFill=if(liquid)androidx.compose.ui.graphics.lerp(surface,primary,if(light).08f else .16f).copy(alpha=.92f) else surface
    val rtl=LocalLayoutDirection.current==LayoutDirection.Rtl
    NativeLiquidSurface(modifier.fillMaxWidth(),shape=shape,color=if(liquid)surface else ink.copy(alpha=0.055f),kind=if(LocalNativeFloatingChrome.current)NativeGlassKind.PANEL else NativeGlassKind.INSET){
    Box(Modifier.padding(4.dp).selectableGroup()){
        // One moving indicator keeps rapid taps from leaving overlapping fills.
        Box(Modifier.matchParentSize().testTag("dashboardTabIndicator").drawWithCache{
            val gap=3.dp.toPx()
            val width=(size.width-gap*(options.size-1))/options.size
            val rim=if(liquid)androidx.compose.ui.graphics.Brush.verticalGradient(listOf(primary.copy(alpha=.18f),primary.copy(alpha=.10f))) else null
            val rimStroke=Stroke(.75.dp.toPx())
            val rimInset=.5.dp.toPx()
            onDrawBehind{
            if(selectedIndex>=0){
                val offset=(width+gap)*position.value
                val origin=Offset(if(rtl)size.width-width-offset else offset,0f)
                val radius=CornerRadius(if(liquid)size.height/2 else 12.dp.toPx())
                drawRoundRect(selectedFill,topLeft=origin,size=Size(width,size.height),cornerRadius=radius)
                if(rim!=null)drawRoundRect(rim,topLeft=origin+Offset(rimInset,rimInset),
                    size=Size((width-rimInset*2).coerceAtLeast(0f),(size.height-rimInset*2).coerceAtLeast(0f)),
                    cornerRadius=CornerRadius((radius.x-rimInset).coerceAtLeast(0f)),style=rimStroke)
            }
            }
        })
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(3.dp)){
        options.forEach{(value,label)->key(value){
            val active=value==selected
            val interaction=remember{MutableInteractionSource()}
            val pressed by interaction.collectIsPressedAsState()
            val press=animateFloatAsState(if(pressed).055f else 0f,tween(if(pressed)60 else 100,easing=DashboardEase),label="dashboardTabPress")
            Box(Modifier.weight(1f).clip(shape).drawBehind{drawRect(ink.copy(alpha=press.value))}
                .selectable(selected=active,enabled=enabled,role=Role.Tab,interactionSource=interaction,indication=null,onClick={if(!active)onSelect(value)})
                .heightIn(min=48.dp).padding(horizontal=6.dp,vertical=9.dp),contentAlignment=Alignment.Center){
                Text(label,fontSize=14.sp,fontWeight=FontWeight.Medium,
                    color=ink.copy(alpha=if(!enabled).4f else if(active)1f else 0.65f),maxLines=1,overflow=TextOverflow.Ellipsis)
            }
        }}
        }
    }
    }
}

@Composable internal fun DashboardHeading(title:String,modifier:Modifier=Modifier,trailingContent:(@Composable ()->Unit)?=null){
    Row(modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
        Text(title,Modifier.weight(1f),fontSize=16.sp,fontWeight=FontWeight.SemiBold)
        trailingContent?.invoke()
    }
}

@Composable internal fun DashboardMetric(label:String,value:String,modifier:Modifier=Modifier,valueModifier:Modifier=Modifier){
    Column(modifier,verticalArrangement=Arrangement.spacedBy(5.dp)){
        Text(label,fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.65f))
        Text(value,valueModifier,fontSize=24.sp,fontWeight=FontWeight.SemiBold,letterSpacing=(-0.5).sp,maxLines=1)
    }
}

@Composable internal fun DashboardSwitch(checked:Boolean,onCheckedChange:(Boolean)->Unit,modifier:Modifier=Modifier,enabled:Boolean=true){
    val interaction=remember{MutableInteractionSource()}
    val pressed by interaction.collectIsPressedAsState()
    val haptics=rememberHaptics()
    val position=animateFloatAsState(if(checked)1f else 0f,tween(180,easing=FastOutSlowInEasing),label="dashboardSwitchThumb")
    val track=animateColorAsState(if(checked)MaterialTheme.colors.primary else MaterialTheme.colors.onSurface.copy(alpha=0.16f),tween(160),label="dashboardSwitchTrack")
    val scale=animateFloatAsState(if(pressed)0.95f else 1f,tween(100),label="dashboardSwitchPress")
    val thumb=animateColorAsState(if(!MaterialTheme.colors.isLight&&checked)MaterialTheme.colors.onPrimary else Color.White,tween(160),label="dashboardSwitchThumbColor")
    Box(modifier.size(width=52.dp,height=48.dp).clip(Radius.Control)
        .semantics{stateDescription=if(checked)"已启用" else "已关闭"}
        .toggleable(value=checked,enabled=enabled,role=Role.Switch,interactionSource=interaction,indication=null){haptics.keyTap();onCheckedChange(it)},contentAlignment=Alignment.Center){
        Canvas(Modifier.size(width=44.dp,height=26.dp).graphicsLayer{alpha=if(enabled)1f else 0.4f;scaleX=scale.value;scaleY=scale.value}){
            drawRoundRect(track.value,cornerRadius=CornerRadius(size.height/2))
            val radius=10.dp.toPx();val margin=3.dp.toPx()
            drawCircle(thumb.value,radius,Offset(margin+radius+(size.width-margin*2-radius*2)*position.value,size.height/2))
        }
    }
}

@Composable internal fun DashboardAction(label:String,onClick:()->Unit,modifier:Modifier=Modifier,enabled:Boolean=true,primary:Boolean=false,icon:Int?=null){
    val foreground=if(primary)MaterialTheme.colors.onPrimary else MaterialTheme.colors.onSurface
    Row(modifier.clip(Radius.Button).background(if(primary)MaterialTheme.colors.primary else MaterialTheme.colors.onSurface.copy(alpha=0.055f))
        .clickable(enabled=enabled,role=Role.Button,onClick=onClick).widthIn(min=48.dp).heightIn(min=48.dp).padding(horizontal=14.dp,vertical=10.dp)
        .graphicsLayer{alpha=if(enabled)1f else 0.4f},verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.Center){
        if(icon!=null)Icon(painterResource(icon),null,Modifier.padding(end=6.dp).size(16.dp),tint=foreground)
        Text(label,fontSize=14.sp,fontWeight=FontWeight.Medium,color=foreground)
    }
}
