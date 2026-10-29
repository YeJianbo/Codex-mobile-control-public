package com.localcodex.control

import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal enum class ComposerAction { Send, Stop, Progress }

@Composable internal fun NativeChatProcessing(text:String,modifier:Modifier=Modifier){
    Box(modifier.fillMaxWidth().heightIn(min=36.dp).padding(start=26.dp,top=6.dp,bottom=6.dp),contentAlignment=Alignment.CenterStart){
        StatusPulseText(text,true)
    }
}

@Composable internal fun NativeComposerSurface(
    modifier:Modifier=Modifier,kind:NativeGlassKind=NativeGlassKind.CHROME,
    content:@Composable ColumnScope.()->Unit,
){
    NativeGlassSurface(modifier,shape=Radius.Composer,color=NativeWash,elevation=0.dp,kind=kind){
        Column(Modifier.padding(horizontal=9.dp,vertical=7.dp),content=content)
    }
}

@Composable internal fun NativeComposerTextField(
    value:String,onValueChange:(String)->Unit,placeholder:String,modifier:Modifier=Modifier,maxLines:Int=6,
){
    val style=TextStyle(fontSize=16.sp,lineHeight=20.sp,color=NativeInk,platformStyle=PlatformTextStyle(includeFontPadding=false))
    BasicTextField(value,onValueChange,modifier=modifier,textStyle=style,maxLines=maxLines,
        cursorBrush=SolidColor(NativeAccent),keyboardOptions=KeyboardOptions(capitalization=KeyboardCapitalization.Sentences),
        decorationBox={field->Box(contentAlignment=Alignment.TopStart){
            if(value.isEmpty())Text(placeholder,style=style.copy(color=NativeMuted),maxLines=1,overflow=TextOverflow.Ellipsis)
            field()
        }})
}

@Composable internal fun NativeComposerAction(
    action:ComposerAction,label:String,enabled:Boolean,onClick:()->Unit,modifier:Modifier=Modifier,
){
    val interaction=remember{MutableInteractionSource()}
    val pressed by interaction.collectIsPressedAsState()
    val scale=animateFloatAsState(if(pressed)0.94f else 1f,nativePressMotion(pressed),label="composerPress")
    val fill=animateColorAsState(if(enabled)NativeAccent else NativeInk.copy(alpha=.15f),tween(140,easing=NativeControlEase),label="composerActionFill")
    Box(modifier.size(48.dp).semantics{contentDescription=label}
        .clickable(interactionSource=interaction,indication=null,enabled=enabled,role=Role.Button,onClick=onClick),contentAlignment=Alignment.Center){
        Box(Modifier.size(36.dp).graphicsLayer{scaleX=scale.value;scaleY=scale.value}.clip(CircleShape)
            .drawBehind{drawCircle(fill.value)},contentAlignment=Alignment.Center){
            Crossfade(action,Modifier.fillMaxSize(),tween(120,easing=NativeControlEase),label="composerAction"){target->
                Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center){when(target){
                    ComposerAction.Progress->CircularProgressIndicator(Modifier.size(16.dp),color=MaterialTheme.colors.onPrimary,strokeWidth=2.dp)
                    ComposerAction.Stop->Box(Modifier.size(13.dp).clip(Radius.Tiny).background(MaterialTheme.colors.onPrimary))
                    ComposerAction.Send->ModernIcon(R.drawable.ic_lucide_arrow_up,null,Modifier.size(18.dp),MaterialTheme.colors.onPrimary)
                }}
            }
        }
    }
}

@Composable internal fun NativeActivityHeader(
    title:String,expanded:Boolean,onClick:()->Unit,modifier:Modifier=Modifier,running:Boolean=false,failed:Boolean=false,
){
    val angle=animateFloatAsState(if(expanded)90f else 0f,nativeChevronMotion(),label="activityChevron")
    Row(modifier.fillMaxWidth().heightIn(min=36.dp).clip(Radius.Card).clickable(onClick=onClick)
        .padding(horizontal=6.dp,vertical=6.dp),verticalAlignment=Alignment.CenterVertically){
        ModernIcon(R.drawable.ic_lucide_chevron_right,null,Modifier.size(15.dp).graphicsLayer{rotationZ=angle.value},NativeMuted)
        StatusPulseText(title,running,Modifier.weight(1f).padding(start=5.dp))
        if(failed)ModernIcon(R.drawable.ic_lucide_circle_alert,"执行失败",Modifier.size(15.dp),MaterialTheme.colors.error)
    }
}

@Composable internal fun NativeProcessHeader(title:String,expanded:Boolean,onClick:()->Unit,modifier:Modifier=Modifier){
    val angle=animateFloatAsState(if(expanded)90f else 0f,nativeChevronMotion(),label="completedTurnChevron")
    Row(modifier.fillMaxWidth().clickable(onClick=onClick).padding(vertical=10.dp),verticalAlignment=Alignment.CenterVertically){
        ModernIcon(R.drawable.ic_lucide_chevron_right,null,Modifier.size(17.dp).graphicsLayer{rotationZ=angle.value},NativeMuted)
        Text(title,Modifier.weight(1f).padding(start=6.dp),color=NativeMuted,fontSize=13.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
    }
}
