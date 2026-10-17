package com.localcodex.control

import androidx.compose.material.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp

@Composable internal fun NativeHarnessIcon(key:String,modifier:Modifier=Modifier,tint:Color){
    val painter=if(key=="hermes"){
        val resources=LocalContext.current.resources
        val vector=remember(resources){
            // The official compound path exceeds AAPT's XML string limit.
            // Parse raw text as one path to preserve holes and every contour.
            val data=resources.openRawResource(R.raw.harness_hermes_path).bufferedReader().use{it.readText()}
            ImageVector.Builder("Hermes",24.dp,24.dp,5487.0615f,5487.0615f).apply{
                addGroup(scaleX=1.0330354f,scaleY=1.0330354f,translationX=-145.41428f,translationY=-2499.328f)
                addPath(PathParser().parsePathString(data).toNodes(),fill=SolidColor(Color.Black))
                clearGroup()
            }.build()
        }
        rememberVectorPainter(vector)
    }else painterResource(when(key){"claude"->R.drawable.harness_claude;"antigravity"->R.drawable.harness_antigravity;"grok"->R.drawable.harness_grok;"deepseek"->R.drawable.harness_deepseek;"opencode"->R.drawable.harness_opencode;else->R.drawable.harness_codex})
    Icon(painter,null,modifier,tint=tint)
}
