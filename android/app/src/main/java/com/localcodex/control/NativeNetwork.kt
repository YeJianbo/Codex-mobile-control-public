package com.localcodex.control

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal data class NativeProxyNode(val name:String,val delay:Int?=null)
internal data class NativeProxyGroup(val name:String,val selected:String,val nodes:List<NativeProxyNode>)
internal data class NativeNetworkState(val groups:List<NativeProxyGroup> = emptyList(),val loading:Boolean=false,val busy:Boolean=false,val error:String="",val message:String="")
internal fun org.json.JSONObject.toNativeProxyGroups():List<NativeProxyGroup>{
    val rows=optJSONArray("groups")?:return emptyList()
    return (0 until rows.length()).map{index->val group=rows.getJSONObject(index);val nodes=group.getJSONArray("nodes")
        NativeProxyGroup(group.getString("name"),group.optString("selected"),(0 until nodes.length()).map{at->val node=nodes.getJSONObject(at);NativeProxyNode(node.getString("name"),if(node.isNull("delay"))null else node.optInt("delay").takeIf{it>0})})
    }
}
@Composable internal fun NativeNetworkPanel(state:NativeNetworkState,connected:Boolean,refresh:()->Unit,select:(String,String)->Unit,test:(String,String)->Unit){
    if(state.loading)Row(verticalAlignment=Alignment.CenterVertically){CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp);Text("正在连接电脑端 Clash…",Modifier.padding(start=10.dp),fontSize=14.sp)}
    if(state.error.isNotBlank())Text(state.error,color=MaterialTheme.colors.error,fontSize=14.sp)
    if(state.message.isNotBlank())Text(state.message,fontSize=13.sp)
    TextButton(onClick=refresh,enabled=connected&&!state.busy){Text("刷新节点")}
    state.groups.forEach{group->
        Text(group.name,fontSize=17.sp,modifier=Modifier.padding(top=12.dp,bottom=8.dp))
        group.nodes.forEach{node->
            Row(Modifier.fillMaxWidth().heightIn(min=52.dp).testTag("proxy:${group.name}:${node.name}").clickable(enabled=!state.busy&&connected&&node.name!=group.selected){select(group.name,node.name)}.padding(vertical=5.dp),verticalAlignment=Alignment.CenterVertically){
                RadioButton(selected=node.name==group.selected,onClick={select(group.name,node.name)},enabled=!state.busy&&connected,modifier=Modifier.size(36.dp))
                Column(Modifier.weight(1f).padding(horizontal=6.dp)){
                    Text(node.name,fontSize=14.sp)
                    Text(listOfNotNull(if(node.name==group.selected)"当前节点" else null,node.delay?.let{"${it} ms"}).joinToString(" · "),fontSize=12.sp)
                }
                TextButton(onClick={test(group.name,node.name)},enabled=!state.busy&&connected,modifier=Modifier.testTag("testProxy:${node.name}")){Text("测延迟",fontSize=12.sp)}
            }
        }
    }
    if(state.busy&&!state.loading)LinearProgressIndicator(Modifier.fillMaxWidth().padding(top=8.dp))
}
