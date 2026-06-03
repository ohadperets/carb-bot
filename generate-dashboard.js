#!/usr/bin/env node
'use strict';

/**
 * CLI tool — generates dashboard.html from data/users.json.
 * Usage: node generate-dashboard.js
 */

const fs = require('fs');
const path = require('path');
const { generateHTML } = require('./src/dashboard');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const OUTPUT_FILE = path.join(__dirname, 'dashboard.html');

function loadJSON(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return {}; }
}

const users = loadJSON(USERS_FILE);
if (!Object.keys(users).length) {
  console.error('❌  No users found in', USERS_FILE);
  process.exit(1);
}

const html = generateHTML(users);
fs.writeFileSync(OUTPUT_FILE, html, 'utf8');
console.log(`✅  Dashboard generated → ${OUTPUT_FILE}`);
console.log(`    Users: ${Object.values(users).map(u => u.firstName).join(', ')}`);
