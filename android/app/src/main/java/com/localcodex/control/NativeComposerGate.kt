package com.localcodex.control

internal enum class NativeComposerGate {
    READY, STOP, CONNECTION, SENDING, UPLOADING, STOPPING, EMPTY, MODEL;
    val enabled get()=this==READY||this==STOP
}

/** The button and diagnostics share the same decision, without recording draft text. */
internal inline fun nativeComposerGate(
    connected:Boolean,sending:Boolean,uploading:Boolean,stopping:Boolean,
    hasInput:Boolean,stop:Boolean,modelAvailable:()->Boolean,
):NativeComposerGate=when{
    !connected->NativeComposerGate.CONNECTION
    stopping->NativeComposerGate.STOPPING
    stop->NativeComposerGate.STOP
    sending->NativeComposerGate.SENDING
    uploading->NativeComposerGate.UPLOADING
    !hasInput->NativeComposerGate.EMPTY
    !modelAvailable()->NativeComposerGate.MODEL
    else->NativeComposerGate.READY
}
