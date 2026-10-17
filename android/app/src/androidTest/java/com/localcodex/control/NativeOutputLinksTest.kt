package com.localcodex.control

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeOutputLinksTest {
    private fun documents()=NativeState(projects=listOf(Project("p","文档","E:/Docs",true)),projectId="p")
    @Test fun locationSuffixesDoNotBecomePartOfTheFilePath(){
        val link="file:///E:/Docs/guide.md:12:4#chapter"
        assertTrue(nativeIsMarkdownFile(nativeOutputLinkName(link)))
        assertEquals("guide.md",android.net.Uri.parse(nativeFileEndpoint(documents(),link)).getQueryParameter("path"))
        assertEquals("report.pdf",nativeOutputLinkName("E:/Docs/report.pdf?download=1#page=2"))
    }
    @Test fun metadataNamesPreserveLiteralPercentAndHash(){
        val path="E:/Docs/note%20#final.md"
        assertTrue(nativeIsMarkdownFile(path))
        val direct=nativeFileEndpointForPath(documents(),path)
        assertEquals("note%20#final.md",android.net.Uri.parse(direct).getQueryParameter("path"))
        assertEquals(path,nativeOutputLinkPath(nativeFilePathHref(path)))
        assertEquals(direct,nativeFileEndpoint(documents(),nativeFilePathHref(path)))
    }
    @Test fun relativeMarkdownImagesKeepEscapesUntilTheEndpointIsBuilt(){
        val source=nativeFilePathHref("E:/Docs/space%20#dir/guide.md")
        val target=nativeMarkdownTarget(source,"images/plot%2520%23one.png")
        assertEquals("space%20#dir/images/plot%20#one.png",android.net.Uri.parse(nativeFileEndpoint(documents(),target)).getQueryParameter("path"))
    }
    @Test fun windowsNamespaceQuestionMarkIsNotAQuery(){
        assertEquals("guide.md",android.net.Uri.parse(nativeFileEndpoint(documents(),"\\\\?\\E:\\Docs\\guide.md:15")).getQueryParameter("path"))
    }
    @Test fun selectedThreadResolvesRelativeLinkBeforeProjectSelectionFinishes(){
        val state=NativeState(threadId="t",projects=listOf(Project("p","照片","E:/Pictures",true)),threads=listOf(ThreadRecord(id="t",projectPath="\\\\?\\E:\\Pictures")))
        assertEquals("/raw/projects/p/file?path=output%2Fpreview.jpg",nativeFileEndpoint(state,"output/preview.jpg"))
    }
    @Test fun nestedRootsChooseTheExactFileProject(){
        val state=NativeState(projects=listOf(Project("root","父目录","E:/Pictures",true),Project("child","照片","E:/Pictures/720",true)))
        assertEquals("/raw/projects/child/file?path=output%2Fpreview.jpg",nativeFileEndpoint(state,"E:/Pictures/720/output/preview.jpg"))
    }
    @Test fun unregisteredFileHasAnAccurateErrorAndNoInferredGrant(){
        val error=runCatching{nativeFileEndpoint(NativeState(),"E:/Pictures/720/preview.jpg")}.exceptionOrNull()
        assertTrue(error?.message.orEmpty().contains("已授权项目"))
    }
    @Test fun outputFallbackCarriesTheOriginalMessageAndThread(){
        val endpoint=nativeThreadOutputEndpoint("thread:one","history:two","E:/Pictures/720/九宫格.jpg")
        val uri=android.net.Uri.parse(endpoint)
        assertEquals("/api/threads/thread:one/output-file/九宫格.jpg",uri.path)
        assertEquals("history:two",uri.getQueryParameter("eventId"))
        assertEquals("E:/Pictures/720/九宫格.jpg",uri.getQueryParameter("path"))
    }
}
