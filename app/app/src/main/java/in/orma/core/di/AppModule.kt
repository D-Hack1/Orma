package `in`.orma.core.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import `in`.orma.data.*
import kotlinx.serialization.json.Json
import javax.inject.Singleton
import `in`.orma.BuildConfig

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides @Singleton fun provideApi(@ApplicationContext context: Context): OrmaApi {
        if (!BuildConfig.USE_STUB_API) return SupabaseOrmaApi(context)
        val json = Json { ignoreUnknownKeys = true }
        val fixture = json.decodeFromString<DemoFixture>(context.assets.open("demo-fixture.json").bufferedReader().use { it.readText() })
        val prefs = context.getSharedPreferences("orma-demo", Context.MODE_PRIVATE)
        val saved = prefs.getString("records", null)?.let {
            runCatching { json.decodeFromString<LocalState>(it) }.getOrElse { LocalState(storageError = true) }
        } ?: LocalState()
        return StubOrmaApi(fixture, saved, persist = {
            check(prefs.edit().putString("records", json.encodeToString(LocalState.serializer(), it)).commit()) { "Could not save this record. Please try again." }
        })
    }
}
