#!/usr/bin/env node
'use strict';

/**
 * CLI tool — generates dashboard.html from the active datastore.
 *   • MongoDB when MONGODB_URI is set (run with: node --use-system-ca generate-dashboard.js)
 *   • else local data/users.json
 * Usage: node generate-dashboard.js   |   npm run dashboard
 */

const fs = require('fs');
const path = require('path');
const { generateHTML } = require('./src/dashboard');
const datastore = require('./src/datastore');

const OUTPUT_FILE = path.join(__dirname, 'dashboard.html');

async function main() {
  await datastore.init();
  const users = datastore.read('users', {});

  if (!Object.keys(users).length) {
    console.error('❌  No users found in the datastore.');
    await datastore.close();
    process.exit(1);
  }

  const html = generateHTML(users);
  fs.writeFileSync(OUTPUT_FILE, html, 'utf8');
  console.log(`✅  Dashboard generated → ${OUTPUT_FILE}`);
  console.log(`    Users: ${Object.values(users).map((u) => u.firstName).join(', ')}`);
  await datastore.close();
}

main().catch((err) => {
  console.error('❌  Failed to generate dashboard:', err.message);
  process.exit(1);
});
