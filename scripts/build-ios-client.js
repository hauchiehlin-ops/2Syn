import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tauriConfPath = path.join(__dirname, '../desktop/src-tauri/tauri.conf.json');
const tauriClientConfPath = path.join(__dirname, '../desktop/src-tauri/tauri.client.conf.json');
const tauriConfBackupPath = path.join(__dirname, '../desktop/src-tauri/tauri.conf.json.backup');

console.log('[Build] Starting iOS Client release build with temp config switch...');

let backupCreated = false;

try {
  // 1. 備份 tauri.conf.json
  if (fs.existsSync(tauriConfPath)) {
    fs.copyFileSync(tauriConfPath, tauriConfBackupPath);
    backupCreated = true;
    console.log('[Build] Backup of tauri.conf.json created.');
  }

  // 2. 將 tauri.client.conf.json 覆蓋至 tauri.conf.json
  fs.copyFileSync(tauriClientConfPath, tauriConfPath);
  console.log('[Build] Temporarily overwritten tauri.conf.json with tauri.client.conf.json.');

  // 3. 執行 tauri ios build
  console.log('[Build] Running tauri ios build...');
  const extraArgs = process.argv.slice(2).join(' ');
  execSync(`npx tauri ios build ${extraArgs}`, {
    cwd: path.join(__dirname, '../desktop'),
    stdio: 'inherit'
  });
  console.log('[Build] Build completed successfully.');

} catch (error) {
  console.error('[Build] Build failed:', error.message);
  process.exitCode = 1;
} finally {
  // 4. 還原備份
  if (backupCreated && fs.existsSync(tauriConfBackupPath)) {
    fs.copyFileSync(tauriConfBackupPath, tauriConfPath);
    fs.unlinkSync(tauriConfBackupPath);
    console.log('[Build] Restored original tauri.conf.json.');
  }
}
