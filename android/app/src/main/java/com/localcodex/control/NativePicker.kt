package com.localcodex.control

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore

internal enum class NativePickKind { MEDIA, FILES }

internal fun nativePickerIntent(
    context: Context,
    kind: NativePickKind,
    manufacturer: String = Build.MANUFACTURER,
    canHandle: (Intent) -> Boolean = { it.resolveActivity(context.packageManager) != null },
): Intent {
    val mime = "*/*"
    fun request(action: String) = Intent(action).apply {
        type = mime
        if(kind==NativePickKind.MEDIA)putExtra(Intent.EXTRA_MIME_TYPES,arrayOf("image/*","video/*"))
        addCategory(Intent.CATEGORY_OPENABLE)
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    val fallback = request(if (kind == NativePickKind.MEDIA) Intent.ACTION_GET_CONTENT else Intent.ACTION_OPEN_DOCUMENT)
    if (!manufacturer.equals("samsung", ignoreCase = true)) return fallback

    val packageName = if (kind == NativePickKind.MEDIA) "com.sec.android.gallery3d" else "com.sec.android.app.myfiles"
    val samsung = request(Intent.ACTION_GET_CONTENT).setPackage(packageName)
    if (canHandle(samsung)) return samsung
    if (kind == NativePickKind.MEDIA) {
        val gallery = Intent(Intent.ACTION_PICK, MediaStore.Files.getContentUri("external")).apply {
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES,arrayOf("image/*","video/*"))
            setPackage(packageName)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        if (canHandle(gallery)) return gallery
    }
    return fallback
}

internal fun nativePickedUris(data: Intent?): List<Uri> = buildList {
    data?.clipData?.let { clip -> for (index in 0 until clip.itemCount) clip.getItemAt(index).uri?.let(::add) }
    data?.data?.let(::add)
}.distinct()
