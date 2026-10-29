plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    compileOptions { sourceCompatibility = JavaVersion.VERSION_1_8; targetCompatibility = JavaVersion.VERSION_1_8 }
    kotlinOptions {
        jvmTarget = "1.8"
        // Keep unchanged conversation rows out of composer/queue recompositions.
        freeCompilerArgs += listOf("-P", "plugin:androidx.compose.compiler.plugins.kotlin:experimentalStrongSkipping=true")
        if (providers.gradleProperty("composeReports").orNull == "true") {
            freeCompilerArgs += listOf("-P", "plugin:androidx.compose.compiler.plugins.kotlin:reportsDestination=${layout.buildDirectory.get()}/compose-reports")
        }
    }
    namespace = "com.localcodex.control"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.localcodex.control"
        minSdk = 26
        targetSdk = 31
        versionCode = 477
        versionName = "0.6.505"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    lint {
        // This APK is distributed directly; the Play publishing target policy is not applicable.
        disable.add("ExpiredTargetSdkVersion")
    }

    buildTypes {
        getByName("debug") {
            // UI fixtures use a separate application and never touch the user's data.
            if (project.findProperty("isolatedUiTest") == "true") {
                val tag=providers.gradleProperty("isolatedTestTag").orNull.orEmpty()
                require(tag.isEmpty()||tag.matches(Regex("[a-z0-9]{1,30}")))
                applicationIdSuffix = (if(tag.isEmpty())"" else ".$tag")+".remotecheck"
            }
        }
        getByName("release") {
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            // Preserve update compatibility with the locally distributed APKs.
            signingConfig = signingConfigs.getByName("debug")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    packagingOptions {
        resources.excludes.add("META-INF/AL2.0")
        resources.excludes.add("META-INF/LGPL2.1")
    }

    sourceSets {
        getByName("main").assets.setSrcDirs(listOf("src/main/theme-assets"))
    }
}

dependencies {
    implementation("io.noties.markwon:core:4.6.2")
    implementation("io.noties.markwon:ext-tables:4.6.2")
    implementation("io.noties.markwon:ext-latex:4.6.2")
    implementation("io.noties.markwon:inline-parser:4.6.2")
    implementation("androidx.activity:activity-compose:1.4.0")
    implementation("androidx.compose.foundation:foundation:1.7.8")
    implementation("androidx.compose.material:material:1.7.8")
    implementation("androidx.compose.ui:ui:1.7.8")
    implementation("androidx.compose.ui:ui-tooling-preview:1.7.8")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.4.0")
    implementation("com.squareup.okhttp3:okhttp:4.9.3")
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.5.2")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4:1.7.8")
    androidTestImplementation("androidx.test:core:1.4.0")
    androidTestImplementation("androidx.test.ext:junit:1.1.3")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.4.0")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.9.3")
    debugImplementation("androidx.compose.ui:ui-tooling:1.7.8")
    debugImplementation("androidx.compose.ui:ui-test-manifest:1.7.8")
}
