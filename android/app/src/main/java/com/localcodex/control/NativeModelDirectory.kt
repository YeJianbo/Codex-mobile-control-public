package com.localcodex.control

// A source that is still loading cannot remove its previous successful entries.
// A completed source replaces its own entries, including an intentionally empty directory.
internal fun nativeMergeModelDirectory(incoming:List<NativeModel>,previous:List<NativeModel>,pending:Set<String>):List<NativeModel>{
    val ids=incoming.mapTo(hashSetOf()){it.id}
    return incoming+previous.filter{it.harness in pending&&it.id !in ids}
}
