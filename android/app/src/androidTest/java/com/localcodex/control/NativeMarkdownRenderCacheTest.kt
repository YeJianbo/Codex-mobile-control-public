package com.localcodex.control

import android.text.style.ClickableSpan
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.noties.markwon.Markwon
import io.noties.markwon.AbstractMarkwonPlugin
import kotlinx.coroutines.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeMarkdownRenderCacheTest {
    @Test fun lateBackgroundRenderDoesNotReplaceNewForegroundCache()=runBlocking {
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val started=CountDownLatch(1)
        val release=CountDownLatch(1)
        val worker=Markwon.builder(context).usePlugin(object:AbstractMarkwonPlugin(){
            override fun beforeRender(node:org.commonmark.node.Node){
                started.countDown()
                check(release.await(5,TimeUnit.SECONDS))
            }
        }).build()
        val cache=NativeMarkdownRenderCache(Markwon.create(context),background={worker})
        val old=async(Dispatchers.Default){cache.renderAsync("**旧版本**","stream")}
        try {
            assertTrue(started.await(2,TimeUnit.SECONDS))
            val current=cache.render("**新版本**","stream")
            release.countDown()
            assertEquals("旧版本",old.await().toString())
            val misses=cache.misses
            assertSame(current,cache.render("**新版本**","stream"))
            assertEquals(misses,cache.misses)
        } finally { release.countDown();old.cancelAndJoin() }
    }
    @Test fun streamedVersionsKeepCompletedMessagesCachedAndNeverReturnStaleText(){
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val cache=NativeMarkdownRenderCache(Markwon.create(context),8000)
        val completed="**已完成** "+"旧消息。".repeat(150)
        val first=cache.render(completed,"completed")
        var latest=""
        repeat(40){index->latest="**正在生成** "+"正文。".repeat(10+index*10);cache.render(latest,"streaming")}
        val misses=cache.misses
        assertSame(first,cache.render(completed,"completed"))
        assertEquals(misses,cache.misses)
        assertTrue(cache.render(latest,"streaming").toString().contains("正文。"))
        assertEquals(misses,cache.misses)
        assertEquals("替换后的正文",cache.render("替换后的正文","streaming").toString())
        assertEquals(misses+1,cache.misses)
    }
    @Test fun oversizedReplyDoesNotEvictOtherMessages(){
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val cache=NativeMarkdownRenderCache(Markwon.create(context),2000)
        val source="**保留** [链接](https://example.com)"
        val first=cache.render(source)
        assertEquals("超长正文".repeat(2000),cache.render("超长正文".repeat(2000)).toString())
        val misses=cache.misses
        assertSame(first,cache.render(source))
        assertEquals(misses,cache.misses)
    }
    @Test fun chineseClosingPunctuationRendersBoldWithoutAddingText(){
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val cache=NativeMarkdownRenderCache(Markwon.create(context))
        val result=cache.render("**3557、3558的逆光暗调可以保留；3652、3653的奶白微绿花瓣也不必强行调成纯白。**其余照片没有看到明显需要纠正的调色问题。")
        assertFalse(result.toString().contains("**"))
        assertTrue(result.toString().contains("纯白。其余照片"))
        assertEquals(1,result.getSpans(0,result.length,io.noties.markwon.core.spans.StrongEmphasisSpan::class.java).size)
    }
    @Test fun literalStarsInCodeAndEscapedTextStayLiteral(){
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val cache=NativeMarkdownRenderCache(Markwon.create(context))
        for(source in listOf("`**中文。**其余`","```text\n**中文。**其余\n```","\\*\\*中文。\\*\\*其余")){
            val result=cache.render(source)
            assertTrue(result.toString().contains("**中文。**其余"))
            assertEquals(0,result.getSpans(0,result.length,io.noties.markwon.core.spans.StrongEmphasisSpan::class.java).size)
        }
    }
    @Test fun revisitedMarkdownRetainsLinksAndDoesNotParseAgain(){
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val cache=NativeMarkdownRenderCache(Markwon.create(context))
        val source="**强调** [打开文件](https://example.com/file)  \n\n"
        val first=cache.render(source)
        assertEquals(1,cache.misses)
        assertTrue(first.getSpans(0,first.length,ClickableSpan::class.java).isNotEmpty())
        assertFalse(first.last().isWhitespace())
        assertSame(first,cache.render(source))
        assertEquals(1,cache.misses)
    }
}
