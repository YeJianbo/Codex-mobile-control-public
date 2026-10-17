package com.localcodex.control

import android.content.Context
import android.net.Uri
import android.util.AtomicFile
import androidx.compose.runtime.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException

@Immutable internal data class NativeThemeState(
    val themes:List<NativeThemeDefinition>,val selectedId:String,val busy:Boolean=false,val error:String="",val notice:String="",
){
    val selected get()=themes.firstOrNull{it.id==selectedId}?:NativeBuiltinThemes.standard
}

/** The app owns the selection; screens only render the current immutable catalog. */
internal class NativeThemeStore(context:Context){
    private val context=context.applicationContext
    private val preferences=context.getSharedPreferences("appearance",0)
    private val directory=File(context.filesDir,"themes")
    private val initialId=preferences.getString("themeId",preferences.getString("glassMaterial","off")).orEmpty().let{if(it=="soft")"light" else it}
    private val cached=runCatching{preferences.getString("activeTheme",null)?.let{NativeThemeCodec.decode(it)}}.getOrNull()?.takeIf{it.id==initialId}
    var state by mutableStateOf(NativeThemeState(NativeBuiltinThemes.all+listOfNotNull(cached),initialId,busy=true));private set
    private fun saveSelection(theme:NativeThemeDefinition){
        preferences.edit().putString("themeId",theme.id).putString("glassMaterial",theme.mode.stored)
            .putString("activeTheme",if(theme.id.startsWith("custom:"))NativeThemeCodec.encode(theme) else null).apply()
    }
    private fun failure(error:Exception)=when(error){
        is IOException->"无法读取或保存主题文件"
        is IllegalArgumentException->error.message?:"主题参数无效"
        else->"主题文件格式无效"
    }
    suspend fun load(){
        val (themes,invalid)=withContext(Dispatchers.IO){
            val builtins=NativeBuiltinThemes.all.map{fallback->
                runCatching{context.assets.open("themes/${fallback.id}.json").bufferedReader().use{NativeThemeCodec.decode(it.readText(),builtIn=true)}}.getOrDefault(fallback)
            }
            var invalid=false
            val custom=directory.listFiles().orEmpty().filter{it.isFile&&it.extension=="json"}.mapNotNull{file->
                runCatching{AtomicFile(file).openRead().use{NativeThemeCodec.decode(read(it))}}.getOrElse{invalid=true;null}
            }
            (builtins+custom.sortedBy{it.name}) to invalid
        }
        val selected=themes.firstOrNull{it.id==state.selectedId}?:NativeBuiltinThemes.standard
        state=NativeThemeState(themes,selected.id,error=if(invalid)"部分主题文件无法读取，可重新导入" else "")
        saveSelection(selected)
    }
    fun select(id:String){
        val theme=state.themes.firstOrNull{it.id==id}?:return
        state=state.copy(selectedId=id,error="",notice="")
        saveSelection(theme)
    }
    private fun read(input:java.io.InputStream):String {
        val output=java.io.ByteArrayOutputStream();val chunk=ByteArray(4096)
        while(true){val count=input.read(chunk);if(count<0)break;require(output.size()+count<=NativeThemeCodec.maxBytes){"主题文件不能超过 64 KB"};output.write(chunk,0,count)}
        return output.toString("UTF-8")
    }
    suspend fun importTheme(uri:Uri){
        if(state.busy)return
        state=state.copy(busy=true,error="",notice="")
        try{
            val theme=withContext(Dispatchers.IO){
                val text=context.contentResolver.openInputStream(uri)?.use{read(it)}?:throw IOException()
                val parsed=NativeThemeCodec.decode(text)
                check(directory.isDirectory||directory.mkdirs()){"无法创建主题目录"}
                val file=AtomicFile(File(directory,parsed.id.removePrefix("custom:")+".json"))
                val stream=file.startWrite()
                try{stream.write(text.toByteArray(Charsets.UTF_8));file.finishWrite(stream)}catch(error:Exception){file.failWrite(stream);throw error}
                parsed
            }
            state=state.copy(themes=state.themes.filterNot{it.id==theme.id}+theme,selectedId=theme.id,busy=false,notice="已导入并应用")
            saveSelection(theme)
        }catch(error:kotlinx.coroutines.CancellationException){state=state.copy(busy=false);throw error}
        catch(error:Exception){state=state.copy(busy=false,error=failure(error))}
    }
    suspend fun exportTheme(uri:Uri,theme:NativeThemeDefinition){
        if(state.busy)return
        state=state.copy(busy=true,error="",notice="")
        try{
            withContext(Dispatchers.IO){
                val bytes=NativeThemeCodec.encode(theme).toByteArray(Charsets.UTF_8)
                context.contentResolver.openOutputStream(uri,"wt")?.use{it.write(bytes)}?:throw IOException()
            }
            state=state.copy(busy=false,notice="主题已导出")
        }catch(error:kotlinx.coroutines.CancellationException){state=state.copy(busy=false);throw error}
        catch(error:Exception){state=state.copy(busy=false,error=failure(error))}
    }
    suspend fun removeSelected(){
        val theme=state.selected
        if(state.busy||!theme.id.startsWith("custom:"))return
        state=state.copy(busy=true,error="",notice="")
        try{
            withContext(Dispatchers.IO){AtomicFile(File(directory,theme.id.removePrefix("custom:")+".json")).delete()}
            state=state.copy(themes=state.themes.filterNot{it.id==theme.id},busy=false)
            select(theme.mode.stored)
        }catch(error:kotlinx.coroutines.CancellationException){state=state.copy(busy=false);throw error}
        catch(error:Exception){state=state.copy(busy=false,error=failure(error))}
    }
}
