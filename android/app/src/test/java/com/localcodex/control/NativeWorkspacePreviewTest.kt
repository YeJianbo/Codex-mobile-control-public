package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test
import java.net.URLDecoder

class NativeWorkspacePreviewTest {
    private val root=Project("root","工作区","F:/work",true)
    private val nested=Project("nested","当前项目","F:/work/research",true)
    private val state=NativeState(projects=listOf(root,nested),projectId=nested.id,fileProjectId=root.id)
    private fun routePath(endpoint:String)=URLDecoder.decode(endpoint.substringAfter("?path="),"UTF-8")

    @Test fun backStopsAtTheBrowsedWorkspaceRoot(){
        assertEquals("research/docs",nativeWorkspaceParentPath("research/docs/images","research"))
        assertEquals("research",nativeWorkspaceParentPath("research/docs","research"))
        assertNull(nativeWorkspaceParentPath("research","research"))
        assertEquals("",nativeWorkspaceParentPath("docs",""))
        assertNull(nativeWorkspaceParentPath("",""))
        assertNull(nativeWorkspaceParentPath("another/docs","research"))
        assertEquals("research",nativeWorkspaceParentPath("research\\docs\\","research/"))
    }

    @Test fun previewsUseTheBrowsedRootInsteadOfRepeatingTheConversationDirectory(){
        for(name in listOf("报告.pdf","图片.png","README.md")){
            val path="research/$name"
            // The old relative route looks up research/research/name in the nested project.
            assertEquals(path,routePath(nativeFileEndpointForPath(state,path)))
            val endpoint=nativeFileEndpointForPath(state,nativeWorkspaceFilePath(root,path))
            assertTrue(endpoint.startsWith("/raw/projects/nested/file?"))
            assertEquals(name,routePath(endpoint))
        }
    }

    @Test fun markdownLinksKeepTheFileDirectoryAcrossProjects(){
        val source=nativeWorkspaceFilePath(root,"research/docs/README.md")
        val target=nativeMarkdownTarget(source,"images/chart.png")
        val endpoint=nativeFileEndpointForPath(state,target)
        assertEquals("research/docs/images/chart.png",routePath(nativeFileEndpointForPath(state,"research/docs/images/chart.png")))
        assertEquals("docs/images/chart.png",routePath(endpoint))
        assertTrue(endpoint.startsWith("/raw/projects/nested/file?"))
    }

    @Test fun decodedWorkspacePathsPreserveLiteralFilenameCharacters(){
        val project=root.copy(path="\\\\?\\F:\\work\\")
        val relative="research/进度 100%20#终稿.pdf"
        val absolute=nativeWorkspaceFilePath(project,relative)
        assertEquals("F:/work/$relative",absolute)
        assertEquals("进度 100%20#终稿.pdf",routePath(nativeFileEndpointForPath(state,absolute)))
        assertEquals("/报告.pdf",nativeWorkspaceFilePath(root.copy(path="/"),"报告.pdf"))
    }
}
