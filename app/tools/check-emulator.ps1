param(
    [string]$Device = 'emulator-5554',
    [string]$BuildRoot,
    [string]$GradleHome,
    [switch]$Build,
    [switch]$DeviceTests
)

$appRoot = Split-Path -Parent $PSScriptRoot
Push-Location $appRoot
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
try {
    $gradleArgs = @(':app:assembleDebug', ':app:testDebugUnitTest', ':app:assembleDebugAndroidTest', '--console=plain', '--no-daemon')
    $moduleBuild = Join-Path $appRoot 'app/build'
    if ($BuildRoot) {
        $gradleArgs += "-PormaBuildRoot=$BuildRoot"
        $moduleBuild = Join-Path $BuildRoot 'app'
    }
    if ($GradleHome) {
        $gradleArgs += @('-g', $GradleHome, '--project-cache-dir', (Join-Path $GradleHome 'project-cache'))
        $scratchTemp = Join-Path $GradleHome 'tmp'
        New-Item -ItemType Directory -Force $scratchTemp | Out-Null
        $env:TEMP = $scratchTemp
        $env:TMP = $scratchTemp
    }
    if ($Build) {
        & .\gradlew.bat @gradleArgs
        if ($LASTEXITCODE -ne 0) { throw 'Gradle checks failed.' }
    }
    & adb -s $Device get-state
    if ($LASTEXITCODE -ne 0) { throw "Device $Device is not connected." }
    & adb -s $Device install -r (Join-Path $moduleBuild 'outputs/apk/debug/app-debug.apk')
    if ($LASTEXITCODE -ne 0) { throw 'App install failed.' }
    if ($DeviceTests) {
        & adb -s $Device shell pm grant in.orma android.permission.RECORD_AUDIO
        & adb -s $Device install -r (Join-Path $moduleBuild 'outputs/apk/androidTest/debug/app-debug-androidTest.apk')
        if ($LASTEXITCODE -ne 0) { throw 'Test APK install failed.' }
        $deviceTestResult = & adb -s $Device shell am instrument -w in.orma.test/androidx.test.runner.AndroidJUnitRunner
        $deviceTestResult | Write-Output
        if ($LASTEXITCODE -ne 0 -or ($deviceTestResult -join "`n") -notmatch 'OK \(\d+ tests?\)') {
            throw 'Device smoke tests did not pass.'
        }
    }
    & adb -s $Device shell am force-stop in.orma
    & adb -s $Device shell am start -W -f 0x10008000 -n in.orma/.MainActivity
    if ($LASTEXITCODE -ne 0) { throw 'App launch failed.' }
    New-Item -ItemType Directory -Force artifacts | Out-Null
    $uiReady = $false
    foreach ($attempt in 1..3) {
        $uiResult = & adb -s $Device shell uiautomator dump /sdcard/orma-verification-ui.xml 2>&1
        if (($uiResult -join "`n") -match 'dumped to:') { $uiReady = $true; break }
    }
    if (-not $uiReady) { throw 'The app UI did not become ready for a screenshot.' }
    & adb -s $Device shell screencap -p /sdcard/orma-verification.png
    & adb -s $Device pull /sdcard/orma-verification.png artifacts/verification.png 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Screenshot transfer failed.' }
    Write-Output 'Emulator verification complete. Screenshot: artifacts/verification.png'
} finally {
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
    Pop-Location
}
exit 0
