package com.localcodex.control
import org.junit.Test
import org.junit.Assert.*
class NativeReadingPositionTest {
 @Test fun independentThreadsKeepReadingAndFollowingIntent(){val s=NativeReadingPositions();val read=NativeReadingPosition("a-row",8,23,false);val follow=NativeReadingPosition("b-row",40,0,true);s.save("a",read);s.save("b",follow);assertEquals(read,s.get("a"));assertEquals(follow,s.get("b"))}
 @Test fun boundedStoreRefreshesChangedThreadWithoutEvictingItsNewPosition(){val s=NativeReadingPositions(2);val p=NativeReadingPosition("row",1,0,false);s.save("a",p);s.save("b",p);s.save("a",p.copy(scrollOffset=17));s.save("c",p);assertNull(s.get("b"));assertEquals(17,s.get("a")!!.scrollOffset)}
}
