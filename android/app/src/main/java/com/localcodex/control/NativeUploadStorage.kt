package com.localcodex.control

internal data class NativeStoredUpload(val kind:String,val id:String,val name:String,val size:Long,val createdAt:String,val protectedReason:String){val key get()="$kind:$id"}
internal data class NativeUploadStorageState(val items:List<NativeStoredUpload> = emptyList(),val totalBytes:Long=0,val blockedReason:String="",val busy:Boolean=false,val error:String="",val message:String="")
