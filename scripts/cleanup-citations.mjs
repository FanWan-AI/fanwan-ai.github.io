import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const dir = 'data/ai/scholarpush/milestones/tasks';
const pattern = /【\d+†L\d+(?:-L\d+)?】/g;

const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
let total = 0;

for (const file of files) {
  const filePath = join(dir, file);
  const content = readFileSync(filePath, 'utf8');
  const cleaned = content.replace(pattern, '');
  if (cleaned !== content) {
    writeFileSync(filePath, cleaned);
    total += 1;
    console.log(`cleaned ${file}`);
  }
}

console.log(`Done. Updated ${total} files.`);
