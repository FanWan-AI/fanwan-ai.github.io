
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_ROOT = path.join(__dirname, '../data/ai/airadar/audio');
const RETENTION_DAYS = 14; // Keep last 14 days

function getDirectories(srcPath) {
  try {
    return fs.readdirSync(srcPath).filter(file => fs.statSync(path.join(srcPath, file)).isDirectory());
  } catch (e) {
    return [];
  }
}

function main() {
  if (!fs.existsSync(AUDIO_ROOT)) {
    console.log('Audio root does not exist, skipping cleanup.');
    return;
  }

  const dirs = getDirectories(AUDIO_ROOT);
  const now = new Date();
  let deletedCount = 0;
  let keptCount = 0;

  dirs.forEach(dir => {
    // dir name is YYYY-MM-DD
    const parts = dir.split('-');
    if (parts.length !== 3) return;

    const dirDate = new Date(dir);
    if (isNaN(dirDate.getTime())) return;

    const diffTime = Math.abs(now - dirDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > RETENTION_DAYS) {
      const targetPath = path.join(AUDIO_ROOT, dir);
      console.log(`Deleting old audio directory: ${dir} (${diffDays} days old)`);
      fs.rmSync(targetPath, { recursive: true, force: true });
      deletedCount++;
    } else {
      keptCount++;
    }
  });

  console.log(`Cleanup complete. Deleted ${deletedCount} directories. Kept ${keptCount} directories.`);
}

main();
