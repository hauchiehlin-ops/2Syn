import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 檔案路徑定義
const files = {
  packageJson: path.join(rootDir, 'desktop', 'package.json'),
  tauriConf: path.join(rootDir, 'desktop', 'src-tauri', 'tauri.conf.json'),
  tauriClientConf: path.join(rootDir, 'desktop', 'src-tauri', 'tauri.client.conf.json'),
  tauriCargo: path.join(rootDir, 'desktop', 'src-tauri', 'Cargo.toml'),
  coreCargo: path.join(rootDir, 'core', 'Cargo.toml'),
  signalingCargo: path.join(rootDir, 'signaling', 'Cargo.toml')
};

// 讀取目前 package.json 的版次
const pkgData = JSON.parse(fs.readFileSync(files.packageJson, 'utf-8'));
const currentVersion = pkgData.version;
console.log(`[Version Bump] Current version: ${currentVersion}`);

const arg = process.argv[2];
if (!arg) {
  console.error('Please specify target version or type: major, minor, patch, or x.y.z');
  process.exit(1);
}

let nextVersion = arg;
if (['major', 'minor', 'patch'].includes(arg)) {
  const parts = currentVersion.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    console.error('Invalid current version format. Must be x.y.z');
    process.exit(1);
  }
  if (arg === 'major') {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
  } else if (arg === 'minor') {
    parts[1] += 1;
    parts[2] = 0;
  } else if (arg === 'patch') {
    parts[2] += 1;
  }
  nextVersion = parts.join('.');
}

// 驗證新版次格式
if (!/^\d+\.\d+\.\d+$/.test(nextVersion)) {
  console.error(`Invalid version format: ${nextVersion}. Must be x.y.z`);
  process.exit(1);
}

console.log(`[Version Bump] Target version: ${nextVersion}`);

// 1. 更新 package.json
pkgData.version = nextVersion;
fs.writeFileSync(files.packageJson, JSON.stringify(pkgData, null, 2) + '\n');
console.log(`Updated: ${files.packageJson}`);

// 2. 更新 tauri.conf.json
const tauriConfData = JSON.parse(fs.readFileSync(files.tauriConf, 'utf-8'));
tauriConfData.version = nextVersion;
fs.writeFileSync(files.tauriConf, JSON.stringify(tauriConfData, null, 2) + '\n');
console.log(`Updated: ${files.tauriConf}`);

// 3. 更新 tauri.client.conf.json
const tauriClientConfData = JSON.parse(fs.readFileSync(files.tauriClientConf, 'utf-8'));
tauriClientConfData.version = nextVersion;
fs.writeFileSync(files.tauriClientConf, JSON.stringify(tauriClientConfData, null, 2) + '\n');
console.log(`Updated: ${files.tauriClientConf}`);

// 4. 更新 Cargo.toml 檔案們
const updateCargoVersion = (filePath) => {
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(/^version\s*=\s*"[^"]*"/m, `version = "${nextVersion}"`);
  fs.writeFileSync(filePath, content);
  console.log(`Updated: ${filePath}`);
};

updateCargoVersion(files.tauriCargo);
updateCargoVersion(files.coreCargo);
updateCargoVersion(files.signalingCargo);

console.log(`[Version Bump] Successfully bumped version to ${nextVersion} in all files!`);
