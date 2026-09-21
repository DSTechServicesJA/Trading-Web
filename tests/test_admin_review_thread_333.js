const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(filePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', filePath), 'utf8');
}

test('DataTables loader waits for jQuery before loading DataTables', async () => {
  const source = read('admin/js/module-loader.js');
  const datatablesScript = 'https://cdn.jsdelivr.net/npm/datatables.net/js/jquery.dataTables.min.js';
  const jqueryScript = 'https://code.jquery.com/jquery-3.7.1.min.js';
  const datatablesCss = 'https://cdn.jsdelivr.net/npm/datatables.net-dt/css/jquery.dataTables.min.css';

  function runLoad(hasJquery = false) {
    const loadedScripts = new Set();
    const loadedLinks = new Set();
    const scriptLoadOrder = [];
    const context = {
      window: {
        DataTable: undefined,
        jQuery: hasJquery ? {} : undefined
      },
      document: {
        readyState: 'complete',
        addEventListener: () => {},
        querySelectorAll: () => [],
        querySelector: (selector) => {
          const scriptMatch = selector.match(/^script\[src="(.+)"\]$/);
          if (scriptMatch) return loadedScripts.has(scriptMatch[1]) ? {} : null;
          const linkMatch = selector.match(/^link\[href="(.+)"\]$/);
          if (linkMatch) return loadedLinks.has(linkMatch[1]) ? {} : null;
          return null;
        },
        createElement: (tagName) => ({ tagName, onload: null, onerror: null }),
        head: {
          appendChild: (element) => {
            if (element.tagName === 'script') {
              loadedScripts.add(element.src);
              scriptLoadOrder.push(element.src);
              if (element.src === jqueryScript) {
                context.window.jQuery = {};
              }
            } else if (element.tagName === 'link') {
              loadedLinks.add(element.href);
            }
            setTimeout(() => element.onload && element.onload(), 0);
          }
        }
      },
      performance: { now: (() => { let t = 0; return () => ++t; })() },
      console,
      setTimeout,
      Date,
      Promise,
      module: { exports: {} }
    };

    vm.createContext(context);
    vm.runInContext(`${source}\nmodule.exports = AdminModuleLoader;`, context);
    return context.module.exports.load('datatables').then(() => ({
      scriptLoadOrder,
      loadedLinks
    }));
  }

  const firstLoad = await runLoad(false);
  const jqueryIndex = firstLoad.scriptLoadOrder.indexOf(jqueryScript);
  const datatablesIndex = firstLoad.scriptLoadOrder.indexOf(datatablesScript);
  assert.ok(jqueryIndex >= 0, 'jQuery should load when absent');
  assert.ok(datatablesIndex > jqueryIndex, 'DataTables should load after jQuery');
  assert.equal(firstLoad.loadedLinks.has(datatablesCss), true);

  const secondLoad = await runLoad(true);
  assert.equal(secondLoad.scriptLoadOrder.includes(jqueryScript), false, 'jQuery should not reload when already present');
  assert.equal(secondLoad.scriptLoadOrder.includes(datatablesScript), true);
  assert.equal(secondLoad.loadedLinks.has(datatablesCss), true);
});

test('users management validates decoded JSON and create-user required fields', () => {
  const source = read('api/admin/users_management.php');
  const postBranchStart = source.indexOf("elseif ($method === 'POST')");
  const putBranchStart = source.indexOf("elseif ($method === 'PUT')");
  assert.ok(postBranchStart >= 0);
  assert.ok(putBranchStart > postBranchStart);
  assert.ok(source.indexOf("if (!is_array($body))", postBranchStart) > postBranchStart);
  assert.ok(source.indexOf("echo json_encode(['error' => 'username, password, and email are required']);", postBranchStart) > postBranchStart);
  assert.ok(source.indexOf("if (!is_array($body))", putBranchStart) > putBranchStart);
});
