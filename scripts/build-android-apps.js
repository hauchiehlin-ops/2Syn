import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const target = process.argv[2]; // '--client' or '--host'

if (target !== '--client' && target !== '--host') {
  console.error("Usage: node build-android-apps.js [--client | --host]");
  process.exit(1);
}

const isClient = target === '--client';
const appName = isClient ? '2syn Client' : '2syn';
const appId = isClient ? 'com.twosyn.app' : 'com.twosyn.host';
const iconSource = isClient ? 'src-tauri/icons-client/icon.png' : 'src-tauri/icons/icon.png';
const configArg = isClient ? ' --config src-tauri/tauri.client.conf.json' : '';

const desktopDir = path.join(__dirname, '../desktop');
const gradlePath = path.join(desktopDir, 'src-tauri/gen/android/app/build.gradle.kts');
const stringsPath = path.join(desktopDir, 'src-tauri/gen/android/app/src/main/res/values/strings.xml');

// Helper to update file content
function updateFile(filePath, regex, replacement) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf-8');
    content = content.replace(regex, replacement);
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Updated ${path.basename(filePath)}`);
  } else {
    console.warn(`Warning: ${filePath} not found. Skipping.`);
  }
}

try {
  console.log(`\n--- Preparing Android Build: ${appName} ---`);

  // 1. Set application ID
  console.log(`Setting applicationId to: ${appId}`);
  updateFile(
    gradlePath,
    /applicationId\s*=\s*".*?"/,
    `applicationId = "${appId}"`
  );

  // 2. Set app name in strings.xml
  console.log(`Setting app_name to: ${appName}`);
  updateFile(
    stringsPath,
    /<string name="app_name">.*?<\/string>/,
    `<string name="app_name">${appName}</string>`
  );

  // 3. Inject icons
  console.log(`Injecting Android icons from ${iconSource}...`);
  // Note: tauri icon command updates the res/mipmap folders in gen/android
  execSync(`npx tauri icon ${iconSource}`, { cwd: desktopDir, stdio: 'inherit' });

  // 4. Build APK
  console.log(`Building APK for ${target}...`);
  // Always build with --apk to generate the installable APK file
  execSync(`npx tauri android build --apk${configArg}`, { cwd: desktopDir, stdio: 'inherit' });

  // 5. Copy and rename APK
  const version = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf-8')).version;
  const buildType = 'release'; 
  const apkSourcePath = path.join(desktopDir, 'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk');
  
  if (fs.existsSync(apkSourcePath)) {
    const finalApkName = `2syn_${version}_Android_${isClient ? 'client' : 'host'}.apk`;
    const finalApkPath = path.join(__dirname, '..', finalApkName);
    fs.copyFileSync(apkSourcePath, finalApkPath);
    console.log(`\n✅ Successfully created: ${finalApkName}`);
  } else {
    console.error(`\n❌ Error: Built APK not found at ${apkSourcePath}`);
    // Might be in arm64-v8a instead if universal is disabled
    console.log('Checking other paths...');
    const archPath = path.join(desktopDir, 'src-tauri/gen/android/app/build/outputs/apk/arm64-v8a/release/app-arm64-v8a-release.apk');
    if (fs.existsSync(archPath)) {
      const finalApkName = `2syn_${version}_Android_${isClient ? 'client' : 'host'}.apk`;
      const finalApkPath = path.join(__dirname, '..', finalApkName);
      fs.copyFileSync(archPath, finalApkPath);
      console.log(`\n✅ Successfully created from arch path: ${finalApkName}`);
    } else {
      process.exit(1);
    }
  }

} catch (e) {
  console.error("Build failed:", e.message);
  process.exit(1);
}
