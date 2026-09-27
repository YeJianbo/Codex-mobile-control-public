package com.localcodex.control

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativePickerTest {
    @Test fun samsungRoutesDirectlyToGalleryAndMyFiles(){
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val gallery=nativePickerIntent(context,NativePickKind.MEDIA,"samsung"){true}
        assertEquals("com.sec.android.gallery3d",gallery.`package`)
        assertEquals(Intent.ACTION_GET_CONTENT,gallery.action)
        assertEquals("*/*",gallery.type)
        assertEquals(listOf("image/*","video/*"),gallery.getStringArrayExtra(Intent.EXTRA_MIME_TYPES)?.toList())
        assertEquals(true,gallery.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE,false))

        val files=nativePickerIntent(context,NativePickKind.FILES,"Samsung"){true}
        assertEquals("com.sec.android.app.myfiles",files.`package`)
        assertEquals(Intent.ACTION_GET_CONTENT,files.action)
        assertEquals("*/*",files.type)

        val fallback=nativePickerIntent(context,NativePickKind.FILES,"samsung"){false}
        assertEquals(null,fallback.`package`)
        assertEquals(Intent.ACTION_OPEN_DOCUMENT,fallback.action)
    }

    @Test fun pickerCollectsEverySelectedUriOnce(){
        val first=Uri.parse("content://gallery/first")
        val second=Uri.parse("content://gallery/second")
        val clip=ClipData.newRawUri("first",first).apply{addItem(ClipData.Item(second))}
        val result=Intent().apply{clipData=clip;data=first}
        assertEquals(listOf(first,second),nativePickedUris(result))
    }
}
