const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', filePath), 'utf8');
}

test('DataTables loader waits for jQuery before loading DataTables', () => {
  const source = read('admin/js/module-loader.js');
  assert.match(source, /if \(!window\.jQuery\)\s*\{\s*await loadExternalScript\('https:\/\/code\.jquery\.com\/jquery-3\.7\.1\.min\.js'\);/);
  assert.match(source, /Promise\.all\(\[\s*loadExternalScript\('https:\/\/cdn\.jsdelivr\.net\/npm\/datatables\.net\/js\/jquery\.dataTables\.min\.js'\),\s*loadExternalCSS\('https:\/\/cdn\.jsdelivr\.net\/npm\/datatables\.net-dt\/css\/jquery\.dataTables\.min\.css'\)\s*\]\)/);
});

test('users management validates decoded JSON and create-user required fields', () => {
  const source = read('api/admin/users_management.php');
  assert.match(source, /if \(!is_array\(\$body\)\) \{\s*http_response_code\(400\);\s*echo json_encode\(\['error' => 'Invalid JSON body'\]\);\s*exit;\s*\}/);
  assert.match(source, /echo json_encode\(\['error' => 'username, password, and email are required'\]\);/);
});
