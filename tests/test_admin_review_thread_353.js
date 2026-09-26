const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', filePath), 'utf8');
}

test('initLoginGate immediately refreshes restored sessions before interval refresh loop', () => {
  const source = read('auth.js');
  assert.match(
    source,
    /if \(isLoggedIn\(\)\) \{[\s\S]*refreshToken\(\)\.catch\(err => console\.warn\("Auto-refresh error:", err\)\);[\s\S]*startAutoRefresh\(\);[\s\S]*\}/
  );
});
