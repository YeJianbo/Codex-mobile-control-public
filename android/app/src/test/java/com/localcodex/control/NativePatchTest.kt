package com.localcodex.control
import org.junit.Assert.*
import org.junit.Test
class NativePatchTest{
 @Test fun mixedNewlinesKeepTextTrailingRowsAndLineNumbers(){
  val rows=patchLines("@@ -7,2 +9,2 @@\r context\n-old\r\n+new\r")
  assertEquals(listOf("@@ -7,2 +9,2 @@"," context","-old","+new",""),rows.map{it.text})
  assertEquals(7,rows[1].oldLine);assertEquals(9,rows[1].newLine)
  assertEquals(8,rows[2].oldLine);assertNull(rows[2].newLine)
  assertEquals(10,rows[3].newLine);assertNull(rows[3].oldLine)
  assertEquals(listOf("","","",""),patchLines("\n\r\n\r").map{it.text})
 }
 @Test fun patchBoundsKeepLongLinesAndLargePayloadsOutOfTheReader(){
  assertFalse(nativePatchTooLarge("x".repeat(10000)))
  assertTrue(nativePatchTooLarge("x".repeat(10001)))
  assertFalse(nativePatchTooLarge("x\r\n".repeat(5000)))
  assertTrue(nativePatchTooLarge("x\r\n".repeat(5001)))
  assertTrue(nativePatchTooLarge("x".repeat(262145)))
 }
 @Test fun fileSelectionMatchesWholePathsAndNeverFallsBackToOtherFiles(){
  val detail="*** Begin Patch\n*** Update File: a.kt\n@@\n-old\n+selected\n*** Add File: a.kt.bak\n+sibling\n*** Update File: src/a.kt\n@@\n+other-directory\n*** End Patch"
  val selected=filePatch(detail,"a.kt")
  assertTrue(selected.contains("+selected"));assertFalse(selected.contains("+sibling"));assertFalse(selected.contains("+other-directory"))
  assertEquals("",filePatch(detail,"missing.kt"))
  assertTrue(filePatch(detail,"src/a.kt").contains("+other-directory"))
  assertEquals("@@\n-old\n+new",filePatch("@@\n-old\n+new","a.kt"))
 }
 @Test fun gitHeadersMatchQuotedPathsRenamesAndDeletedFiles(){
  val detail="diff --git \"a/space name.kt\" \"b/space name.kt\"\r\n--- \"a/space name.kt\"\r\n+++ \"b/space name.kt\"\r\n@@ -1 +1 @@\r\n-old\r\n+selected\r\ndiff --git a/deleted.kt b/deleted.kt\n--- a/deleted.kt\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed\ndiff --git a/old.kt b/new.kt\nsimilarity index 100%\nrename from old.kt\nrename to new.kt\n"
  assertTrue(filePatch(detail,"space name.kt").contains("+selected"));assertFalse(filePatch(detail,"space name.kt").contains("-removed"))
  assertTrue(filePatch(detail,"deleted.kt").contains("-removed"));assertFalse(filePatch(detail,"deleted.kt").contains("+selected"))
  assertEquals(filePatch(detail,"old.kt"),filePatch(detail,"new.kt"))
  assertTrue(filePatch(detail,"new.kt").contains("rename to new.kt"));assertEquals("",filePatch(detail,"missing.kt"))
  val unified="--- a/src/a.kt\told time\n+++ b/src/a.kt\tnew time\n@@ -1 +1 @@\n-old\n+new"
  assertEquals(unified,filePatch(unified,"src\\a.kt"));assertEquals("",filePatch(unified,"a.kt"))
 }
 @Test fun numbersFollowOldAndNewFile(){
  val lines=patchLines("@@ -36,2 +36,2 @@\n same\n-old\n+new")
  assertEquals(36,lines[1].oldLine);assertEquals(36,lines[1].newLine)
  assertEquals(37,lines[2].oldLine);assertNull(lines[2].newLine)
  assertEquals(37,lines[3].newLine);assertNull(lines[3].oldLine)
 }
 @Test fun selectedFileOmitsSiblingAndUnknownNumbersStayUnknown(){
  val detail="*** Begin Patch\n*** Update File: a.kt\n@@\n-old\n+new\n*** Add File: b.kt\n+other\n*** End Patch"
  assertFalse(filePatch(detail,"a.kt").contains("other"))
  assertNull(patchLines(filePatch(detail,"a.kt")).first{it.kind=="add"}.newLine)
  assertEquals(1,patchLines(filePatch(detail,"b.kt")).first{it.kind=="add"}.newLine)
 }
}
