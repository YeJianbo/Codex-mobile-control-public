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
import org.json.JSONObject

data class NativeAccountsState(val service:String="",val data:JSONObject?=null,val loading:Boolean=false,val busy:String="",val error:String="",val message:String="",val confirmation:JSONObject?=null,val result:JSONObject?=null)

internal data class NativeAccountConnection(val api:GatewayClient,val current:()->Boolean)

internal class NativeAccountsController(
    private val scope:CoroutineScope,
    private val connection:()->NativeAccountConnection?,
    private val errorText:(Exception)->String,
){
    var state by mutableStateOf(NativeAccountsState());private set
    private var job:Job?=null
    private var revision=0L

    fun load(service:String){
        val owner=connection()?:return
        job?.cancel();val ticket=++revision
        state=if(state.service==service)state.copy(loading=true,error="",message="",confirmation=null,result=null) else NativeAccountsState(service=service,loading=true)
        job=scope.launch{
            fun current()=owner.current()&&ticket==revision
            try{
                val result=owner.api.accountsAsync(service)
                if(current())state=state.copy(data=result,loading=false)
            }catch(e:CancellationException){throw e}catch(e:Exception){if(current())state=state.copy(loading=false,error=errorText(e))}
        }
    }

    fun cancelRead(service:String){
        // A submitted account action owns its completion even when its page is left.
        if(state.service!=service||state.busy.isNotBlank())return
        revision++;job?.cancel();job=null
        state=state.copy(loading=false,confirmation=null)
    }

    fun action(service:String,action:String,body:JSONObject){
        val owner=connection()?:return
        if(state.busy.isNotBlank())return
        job?.cancel();val ticket=++revision
        state=state.copy(busy=action,error="",message="",confirmation=null,result=null)
        job=scope.launch{
            fun current()=owner.current()&&ticket==revision
            try{
                val result=withContext(Dispatchers.IO){owner.api.accountAction(service,action,body)}
                if(!current())return@launch
                when{
                    action=="switch-preview"->state=state.copy(busy="",confirmation=result)
                    action in readActions->state=state.copy(busy="",result=result,message=result.optString("message").ifBlank{when(action){"test"->"连接检查完成";"models","discover-models"->"模型列表已获取";"routing-preview"->"预览已获取";else->"已读取"}})
                    else->{
                        state=state.copy(busy="",message=result.optString("message").ifBlank{"已保存"},result=result)
                        try{
                            val data=owner.api.accountsAsync(service)
                            if(current())state=state.copy(data=data)
                        }catch(e:CancellationException){throw e}catch(e:Exception){if(current())state=state.copy(error="操作已完成，刷新失败：${errorText(e)}")}
                    }
                }
            }catch(e:CancellationException){throw e}catch(e:Exception){if(current())state=state.copy(busy="",error=errorText(e))}
        }
    }

    fun dismissConfirmation(){state=state.copy(confirmation=null)}
    fun reset(){revision++;job?.cancel();job=null;state=NativeAccountsState()}

    private companion object{
        val readActions=setOf("models","test","read","discover-models","routing-preview","profile","test-model","history","oauth-status","oauth-start","oauth-cancel")
    }
}
