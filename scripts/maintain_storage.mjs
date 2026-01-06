// scripts/maintain_storage.mjs
/**
 * Maintenance script to clean up old audio files and temporary data 
 * to prevent "No space left on device" errors in CI/CD.
 * 
 * Policy:
 * 1. Delete __tts_tmp__ content entirely.
 * 2. Delete data/ai/airadar/audio folders older than 30 days.
 * 3. Delete assets/audio/daily files older than 30 days.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const DAYS_TO_KEEP = 30;
const DRY_RUN = process.argv.includes('--dry-run');

const TARGETS = [
  {
    name: 'TTS Temp',
    path: path.join(root, 'data/ai/daily-academy/__tts_tmp__'),
    mode: 'clean-all'
  },
  {
    name: 'Airadar Daily Audio',
    path: path.join(root, 'data/ai/airadar/audio'),
    mode: 'subfolders-date' // Expects YYYY-MM-DD folder names
  },
  {
    name: 'Academy Assets Audio',
    path: path.join(root, 'assets/audio/daily'),
    mode: 'files-date' // Expects YYYY-MM-DD-*.mp3
  }
];

async function getItems(dirPath) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function parseDateFromIy(name) {
  // Matches YYYY-MM-DD at start of string
  const match = name.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return new Date(match[1]);
  return null;
}

async function recursiveDelete(itemPath) {
  if (DRY_RUN) {
    console.log(`[DRY] Would delete: ${itemPath}`);
    return;
  }
  try {
    const stat = await fs.stat(itemPath);
    if (stat.isDirectory()) {
      await fs.rm(itemPath, { recursive: true, force: true });
    } else {
      await fs.unlink(itemPath);
    }
    console.log(`Deleted: ${itemPath}`);
  } catch (e) {
    console.error(`Failed to delete ${itemPath}:`, e.message);
  }
}

async function main() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_KEEP);
  console.log(`Maintenance: Cleaning items older than ${DAYS_TO_KEEP} days (${cutoffDate.toISOString().split('T')[0]})`);
  if (DRY_RUN) console.log('--- DRY RUN MODE ---');

  for (const target of TARGETS) {
    console.log(`Processing ${target.name} (${target.path})...`);
    
    const items = await getItems(target.path);
    if (items.length === 0) {
      console.log('  Empty or not found.');
      continue;
    }

    for (const item of items) {
      const itemPath = path.join(target.path, item.name);
      
      if (target.mode === 'clean-all') {
        // Just delete everything in temp
        await recursiveDelete(itemPath);
        continue;
      }

      // Date based checks
      const itemDate = parseDateFromIy(item.name);
      if (!itemDate) {
        // console.log(`  Skipping non-dated item: ${item.name}`);
        continue;
      }

      if (itemDate < cutoffDate) {
        if (target.mode === 'subfolders-date' && item.isDirectory()) {
          await recursiveDelete(itemPath);
        } else if (target.mode === 'files-date' && item.isFile()) {
           await recursiveDelete(itemPath);
        }
      }
    }
  }
  console.log('Maintenance complete.');
}

main().catch(console.error);
