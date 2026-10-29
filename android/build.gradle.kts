plugins {
    id("com.android.application") version "8.8.1" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}

providers.gradleProperty("cmcBuildRoot").orNull?.let { root ->
    val outputRoot = file(root).absoluteFile
    val crossDrive = System.getProperty("os.name").startsWith("Windows",ignoreCase=true) &&
        outputRoot.toPath().root != rootProject.projectDir.toPath().root
    allprojects {
        layout.buildDirectory.set(outputRoot.resolve(if (path == ":") "root" else path.trimStart(':').replace(':', '/')))
        // Kotlin 1.9 cannot relativize generated Java on another Windows drive.
        // Without this it fails incremental compilation, then recompiles anyway.
        if(crossDrive)extensions.extraProperties.set("kotlin.incremental","false")
    }
}

