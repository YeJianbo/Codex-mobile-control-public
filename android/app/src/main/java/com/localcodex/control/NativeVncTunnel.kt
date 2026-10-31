package com.localcodex.control

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/** Bridges the upstream VNC engine to the authenticated gateway WebSocket. */
internal class NativeVncTunnel(private val gateway:GatewayClient,private val session:String):AutoCloseable{
    private val closed=AtomicBoolean(false)
    private val listener=ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))
    private val accepted=CountDownLatch(1)
    private val opened=CompletableDeferred<Unit>()
    @Volatile private var local:Socket?=null
    @Volatile private var remote:WebSocket?=null
    val address:String get()="127.0.0.1:${listener.localPort}"

    suspend fun open(){
        thread(name="desktop-vnc-local",isDaemon=true){
            try{
                listener.soTimeout=15000
                val socket=listener.accept();local=socket;accepted.countDown()
                val input=socket.getInputStream();val buffer=ByteArray(32768)
                while(!closed.get()){
                    val count=input.read(buffer);if(count<0)break
                    val socket=remote?:break
                    if(socket.queueSize()>4L*1024*1024||!socket.send(buffer.toByteString(0,count)))break
                }
            }catch(_:IOException){}finally{accepted.countDown();close()}
        }
        remote=gateway.desktopWebSocket(session,object:WebSocketListener(){
            override fun onOpen(webSocket:WebSocket,response:Response){remote=webSocket;opened.complete(Unit)}
            override fun onMessage(webSocket:WebSocket,bytes:ByteString){
                try{if(!accepted.await(15,TimeUnit.SECONDS))throw IOException("桌面连接超时");val output=local?.getOutputStream()?:throw IOException("桌面连接已关闭");output.write(bytes.toByteArray());output.flush()}
                catch(_:Exception){close()}
            }
            override fun onFailure(webSocket:WebSocket,t:Throwable,response:Response?){opened.completeExceptionally(IOException("远程桌面连接失败",t));close()}
            override fun onClosed(webSocket:WebSocket,code:Int,reason:String){opened.completeExceptionally(IOException("远程桌面连接已关闭"));close()}
        })
        try{withTimeout(15000){opened.await()}}catch(e:Exception){close();throw e}
    }
    override fun close(){
        if(!closed.compareAndSet(false,true))return
        accepted.countDown();runCatching{local?.close()};runCatching{listener.close()};remote?.cancel()
    }
}
