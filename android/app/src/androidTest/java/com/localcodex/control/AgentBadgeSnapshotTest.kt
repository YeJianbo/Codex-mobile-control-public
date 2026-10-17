package com.localcodex.control

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.Icon
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.junit.Rule
import org.junit.Test
import java.io.File

class AgentBadgeSnapshotTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun fourteenAgentsToolbarSnapshot(){
        val main=ThreadRecord("badge-main",title="评估联邦学习课题创新与可行性")
        val agents=(1..14).map{ThreadRecord("badge-$it",subagent=NativeSubagent(main.id,"代理 $it"))}
        ui.setContent{MaterialTheme{
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,1.3f)){
                Row(Modifier.testTag("badgeSnapshotToolbar").fillMaxWidth().height(64.dp).background(Color.White).padding(horizontal=8.dp),verticalAlignment=Alignment.CenterVertically){
                    Icon(painterResource(R.drawable.ic_menu_compact),null,Modifier.padding(horizontal=8.dp).size(21.dp))
                    Text(main.title,Modifier.weight(1f).padding(start=8.dp),fontSize=18.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                    Box(Modifier.padding(horizontal=6.dp).size(6.dp).background(Color(0xff459b7e),CircleShape))
                    Box(Modifier.size(38.dp),contentAlignment=Alignment.Center){Box(Modifier.size(14.dp).border(1.8.dp,Color.Gray,CircleShape))}
                    NativeConversationAgents(listOf(main)+agents,main.id,{})
                    Icon(painterResource(R.drawable.ic_lucide_ellipsis),null,Modifier.padding(horizontal=12.dp).size(21.dp))
                }
            }
        }}
        ui.onNodeWithText("14").assertIsDisplayed()
        val image=ui.onNodeWithTag("badgeSnapshotToolbar").captureToImage().asAndroidBitmap()
        val file=File(ui.activity.getExternalFilesDir(null),"agent-badge-14-150.png")
        file.outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}
    }
}
