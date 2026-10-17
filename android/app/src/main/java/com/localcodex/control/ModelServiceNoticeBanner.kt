package com.localcodex.control

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.IconButton
import androidx.compose.material.Icon
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun ModelServiceNoticeBanner(notice:ModelServiceNotice,onDismiss:()->Unit){
    val tint=if(notice.kind=="quota-low")AppColor.StatusWarning else AppColor.StatusError
    Row(Modifier.fillMaxWidth().padding(horizontal=12.dp,vertical=4.dp).testTag("modelServiceNotice")
        .clip(Radius.Field).background(tint.copy(alpha=0.10f))
        .padding(start=12.dp,end=4.dp,top=8.dp,bottom=8.dp),verticalAlignment=Alignment.CenterVertically){
        Icon(painterResource(R.drawable.ic_lucide_circle_alert),null,Modifier.size(18.dp),tint)
        Column(Modifier.weight(1f).padding(horizontal=10.dp)){
            Text(notice.title,fontSize=13.sp,fontWeight=FontWeight.Medium,color=MaterialTheme.colors.onSurface)
            Text(notice.message,fontSize=12.sp,lineHeight=17.sp,color=MaterialTheme.colors.onSurface.copy(alpha=0.64f),modifier=Modifier.padding(top=3.dp))
        }
        IconButton(onClick=onDismiss,modifier=Modifier.size(32.dp)){
            Icon(painterResource(R.drawable.ic_lucide_x),"关闭模型提醒",Modifier.size(15.dp),MaterialTheme.colors.onSurface)
        }
    }
}
