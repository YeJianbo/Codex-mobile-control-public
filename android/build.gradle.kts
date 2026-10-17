plugins {
    id("com.android.application") version "8.8.1" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}

providers.gradleProperty("cmcBuildRoot").orNull?.let { root ->
    val outputRoot = file(root).absoluteFile
    allprojects {
        layout.buildDirectory.set(outputRoot.resolve(if (path == ":") "root" else path.trimStart(':').replace(':', '/')))
    }
}

