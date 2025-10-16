#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';

function printUsage(message) {
  if (message) {
    console.error(`Error: ${message}`);
  }
  console.error('Usage: node tools/secure-post/encrypt-post.mjs --input <file> --output <file> --password <secret> [--selector main] [--inner]');
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      printUsage(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (key === 'inner' || key === 'help') {
      out[key] = true;
      continue;
    }
    if (i + 1 >= argv.length) {
      printUsage(`Missing value for ${arg}`);
    }
    out[key] = argv[i + 1];
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv);
if (args.help) {
  printUsage();
}
const inputPath = args.input ? resolve(process.cwd(), args.input) : null;
const outputPath = args.output ? resolve(process.cwd(), args.output) : null;
const password = args.password || process.env.SECURE_POST_PASSWORD;
const selector = args.selector || null;
const onlyInner = Boolean(args.inner);

if (!inputPath) {
  printUsage('Missing --input');
}
if (!outputPath) {
  printUsage('Missing --output');
}
if (!password) {
  printUsage('Missing --password or SECURE_POST_PASSWORD');
}

const raw = readFileSync(inputPath, 'utf8');
let payload = raw;
if (selector) {
  const regex = new RegExp(`<${selector}[^>]*>[\\s\\S]*?<\\/${selector}>`, 'i');
  const match = raw.match(regex);
  if (!match) {
    printUsage(`Could not locate <${selector}> block in ${inputPath}`);
  }
  payload = match[0];
  if (onlyInner) {
    const openIdx = payload.indexOf('>');
    const closeTag = new RegExp(`<\\/${selector}>`, 'i');
    const closeMatch = payload.match(closeTag);
    if (!closeMatch) {
      printUsage('Malformed HTML block while extracting inner content');
    }
    const closeIdx = payload.toLowerCase().lastIndexOf(`</${selector}>`);
    payload = payload.slice(openIdx + 1, closeIdx);
  }
}

const iterations = 210000; // around ~200ms on modern desktop browsers
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
const authTag = cipher.getAuthTag();

const record = {
  version: 1,
  algorithm: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations,
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  tag: authTag.toString('base64'),
  ciphertext: encrypted.toString('base64'),
  encoding: 'utf8',
  producedAt: new Date().toISOString(),
  source: selector ? `${selector}${onlyInner ? ':inner' : ''}` : 'file',
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(record, null, 2), 'utf8');

console.log(`Encrypted payload written to ${outputPath}`);
