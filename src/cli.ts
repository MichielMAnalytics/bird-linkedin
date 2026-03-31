#!/usr/bin/env node

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createProgram } from './cli/program.js';

// Simple .env loader (no dependency needed)
function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), '.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed.substring(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // No .env file, that's fine
  }
}

loadEnv();

const program = createProgram();
program.parse(process.argv);
