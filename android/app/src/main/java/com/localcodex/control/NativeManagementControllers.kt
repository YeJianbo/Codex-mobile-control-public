package com.localcodex.control

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

internal data class NativeManagementConnection(val api:GatewayClient,val current:()->Boolean)

internal class NativeAgentHealthController(
    private val scope:CoroutineScope,
    private val connection:()->NativeManagementConnection?,
    private val errorText:(Exception)->String,
    private val updateErrorText:(Exception)->String,
){
    var state by mutableStateOf(NativeAgentHealthState());private set
    private var revision=0L
    private var healthJob:Job?=null
    private var updatesJob:Job?=null
    private var accessJob:Job?=null

    fun setPublicAccess(agent:String,enabled:Boolean){
        if(state.accessBusy.isNotBlank())return
        val owner=connection()?:return;val ticket=revision
        fun current()=owner.current()&&ticket==revision
        state=state.copy(accessBusy=agent,error="")
        accessJob=scope.launch{
            try{
                withContext(Dispatchers.IO){owner.api.nativeJson("PUT","/api/settings/harness-access",JSONObject().put("agents",JSONObject().put(agent,enabled)))}
                if(!current())return@launch
                state=state.copy(agents=state.agents.map{if(it.agent==agent)it.copy(publicAllowed=enabled) else it},accessBusy="")
                load()
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(current())state=state.copy(error=errorText(e))}
            finally{if(current())state=state.copy(accessBusy="")}
        }
    }

    fun load(force:Boolean=false):Job?{
        if(state.loading)return null
        val owner=connection()?:return null;val ticket=revision
        fun current()=owner.current()&&ticket==revision
        state=state.copy(loading=true,error="")
        return scope.launch{
            try{
                val result=withContext(Dispatchers.IO){owner.api.agentHealth(force)}
                if(!current())return@launch
                state=state.copy(agents=result.agents(),checkedAt=result.optString("checkedAt"),error=result.optString("error"),desktop=result.optJSONObject("desktop")?.let{parseNativeAgentHealth(it)})
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(current())state=state.copy(error=errorText(e))}
            finally{if(current())state=state.copy(loading=false)}
        }.also{healthJob=it}
    }

    fun checkUpdates():Job?{
        if(state.checkingUpdates)return null
        val owner=connection()?:return null;val ticket=revision
        fun current()=owner.current()&&ticket==revision
        state=state.copy(checkingUpdates=true,error="")
        return scope.launch{
            try{
                val result=withContext(Dispatchers.IO){owner.api.checkAgentUpdates();owner.api.agentHealth()}
                if(!current())return@launch
                state=state.copy(agents=result.agents(),desktop=result.optJSONObject("desktop")?.let{parseNativeAgentHealth(it)},checkedAt=result.optString("checkedAt"),error=result.optString("error"))
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(current())state=state.copy(error=updateErrorText(e))}
            finally{if(current())state=state.copy(checkingUpdates=false)}
        }.also{updatesJob=it}
    }

    fun reset(){
        revision++;healthJob?.cancel();updatesJob?.cancel();accessJob?.cancel()
        healthJob=null;updatesJob=null;accessJob=null
        state=NativeAgentHealthState()
    }

    private fun JSONObject.agents():List<NativeAgentHealth>{
        val rows=optJSONArray("agents")?:JSONArray()
        return (0 until rows.length()).map{parseNativeAgentHealth(rows.getJSONObject(it))}
    }
}

internal class NativeNetworkController(
    private val scope:CoroutineScope,
    private val connection:()->NativeManagementConnection?,
    private val errorText:(Exception)->String,
){
    var state by mutableStateOf(NativeNetworkState());private set
    private var job:Job?=null
    private var revision=0L

    fun load()=request("GET","/api/network/openai")
    fun selectNode(group:String,node:String){if(!state.busy)request("PUT","/api/network/openai/node",JSONObject().put("group",group).put("node",node))}
    fun testNode(group:String,node:String){if(!state.busy)request("POST","/api/network/openai/test",JSONObject().put("group",group).put("node",node),group to node)}

    private fun request(method:String,route:String,body:JSONObject?=null,test:Pair<String,String>?=null){
        val owner=connection()?:run{state=NativeNetworkState(error="连接电脑后可管理 Clash 节点");return}
        val ticket=++revision
        fun current()=ticket==revision&&owner.current()
        job?.cancel();state=state.copy(loading=method=="GET",busy=true,error="",message="")
        job=scope.launch{
            try{
                val result=withContext(Dispatchers.IO){owner.api.nativeJsonAsync(method,route,body)}
                if(current()){
                    state=if(test==null)state.copy(groups=result.toNativeProxyGroups(),message=if(method=="PUT")"节点已切换" else "")
                    else state.copy(groups=state.groups.map{group->if(group.name==test.first)group.copy(nodes=group.nodes.map{node->if(node.name==test.second)node.copy(delay=result.optInt("delay").takeIf{it>0})else node})else group},message="延迟测试完成")
                }
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(current())state=state.copy(error=errorText(e))}
            finally{if(current())state=state.copy(loading=false,busy=false)}
        }
    }

    fun reset(){revision++;job?.cancel();job=null;state=NativeNetworkState()}
}
