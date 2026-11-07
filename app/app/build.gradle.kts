plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.kapt)
    alias(libs.plugins.hilt)
}

android {
    namespace = "in.orma"
    compileSdk = 36
    defaultConfig {
        applicationId = "in.orma"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("boolean", "USE_STUB_API", providers.gradleProperty("ormaStub").getOrElse("false"))
        buildConfigField("String", "ORMA_API_URL", "\"${providers.gradleProperty("ormaApiUrl").getOrElse("")}\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    bundle { language { enableSplit = false } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    testOptions { unitTests.isReturnDefaultValues = true }
    sourceSets.getByName("test").resources.srcDir("src/main/assets")
}
kapt { correctErrorTypes = true }

// Optional scratch drive for machines with a full system disk.
providers.gradleProperty("ormaBuildRoot").orNull?.let {
    layout.buildDirectory.set(file("$it/app"))
}

dependencies {
    implementation(libs.androidx.core)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.lifecycle)
    implementation(libs.androidx.viewmodel)
    implementation(libs.androidx.navigation)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.preview)
    implementation(libs.compose.material)
    implementation(libs.compose.icons)
    implementation(libs.hilt.android)
    kapt(libs.hilt.compiler)
    implementation(libs.serialization)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    androidTestImplementation(libs.androidx.test)
    androidTestImplementation(libs.androidx.runner)
    androidTestImplementation(libs.espresso)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.test)
    debugImplementation(libs.compose.test.manifest)
    debugImplementation(libs.compose.tooling)
}
