const fs = require('fs');
const os = require('os');
const Module = require('module');
const logFile = os.tmpdir() + '\\probe2.log';
fs.writeFileSync(logFile, '');
function log(m) { try { fs.appendFileSync(logFile, m + '\n'); } catch(_){} }
log('probe2 started. process.type=' + process.type + ' electron=' + (process.versions && process.versions.electron));

var rfSrc = Module._resolveFilename.toString();
log('_resolveFilename length=' + rfSrc.length + ' snippet=' + rfSrc.slice(0, 100).replace(/\n/g, ' '));

try {
  var resolved = require.resolve('electron');
  log('require.resolve("electron") = ' + resolved);
} catch(e) { log('require.resolve error: ' + e.message); }

log('module.paths[0]=' + (module.paths[0] || 'none'));
log('module.paths[1]=' + (module.paths[1] || 'none'));

for (var k in require.cache) {
  if (k.indexOf('electron') >= 0 && k.indexOf('index.js') >= 0) {
    delete require.cache[k];
    log('deleted cache: ' + k);
  }
}

try {
  var resolved2 = require.resolve('electron');
  log('after cache clear resolve = ' + resolved2);
} catch(e2) { log('after cache clear resolve error: ' + e2.message); }

try {
  var e = require('electron');
  log('require("electron") type=' + typeof e + ' keys=' + JSON.stringify(Object.keys(e || {}).slice(0, 10)));
} catch(ex) { log('require threw: ' + ex.message); }

setTimeout(function() { process.exit(0); }, 2000);
