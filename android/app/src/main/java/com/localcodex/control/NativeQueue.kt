package com.localcodex.control

import org.json.JSONObject

internal fun nativeQueueTextIncluded(draft:String,text:String):Boolean = text.isBlank()||draft.trim()==text.trim()||draft.startsWith(text+"\n\n")
internal fun nativeQueueRestoredText(draft:String,text:String):String = if(nativeQueueTextIncluded(draft,text))draft else listOf(text,draft).filter{it.isNotBlank()}.joinToString("\n\n")

internal fun JSONObject.toNativeQueued()=NativeQueued(getString("id"),optString("text"),optString("status","queued"),optString("error"),optBoolean("canSteer"),
    optJSONArray("images")?.let{rows->(0 until rows.length()).map{rows.getJSONObject(it).let{row->NativeImage(row.getString("id"),row.optString("name"))}}}.orEmpty(),
    optJSONArray("files")?.let{rows->(0 until rows.length()).map{rows.getJSONObject(it).let{row->NativeUploadedFile(row.getString("id"),row.optString("name"),row.optString("mime"),row.optLong("size"))}}}.orEmpty())
