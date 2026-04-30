"use strict";
const Module = require('module');
const fs     = require('fs');
const os     = require('os');

const CDP_PORT = process.env.REMOTE_DEBUG_PORT || '9222';

const logFile = os.tmpdir() + '\\cdp-setup-log.txt';
fs.writeFileSync(logFile, '');
function log(msg) { try { fs.appendFileSync(logFile, msg + '\n'); } catch(_) {} }

log('preload start. process.type=' + process.type + ' electron=' + (process.versions && process.versions.electron));

function tryAppSwitch(label) {
  try {
    // Clear module cache so require('electron') is re-resolved after Electron bootstrapper patches it
    const electronResolved = require.resolve('electron');
    delete require.cache[electronResolved];
  } catch(_) {}

  try {
    const electron = require('electron');
    const keys = Object.keys(electron || {}).slice(0, 8);
    log(label + ' require("electron") keys=' + JSON.stringify(keys));
    const app = electron && electron.app;
    if (app && app.commandLine) {
      app.commandLine.appendSwitch('remote-debugging-port', CDP_PORT);
      log(label + ' SUCCESS — CDP enabled on port ' + CDP_PORT);
      return true;
    }
    log(label + ' app or commandLine not available');
  } catch(e) { log(label + ' require("electron") error: ' + e.message); }

  try {
    const _b = process.electronBinding || process.atomBinding;
    if (_b) {
      const _app = _b('app');
      if (_app && _app.commandLine) {
        _app.commandLine.appendSwitch('remote-debugging-port', CDP_PORT);
        log(label + ' SUCCESS via electronBinding — CDP enabled');
        return true;
      }
    }
    log(label + ' electronBinding not available: ' + typeof process.electronBinding);
  } catch(e) { log(label + ' electronBinding error: ' + e.message); }

  return false;
}

// Try immediately (will likely fail — Electron not bootstrapped yet)
tryAppSwitch('immediate');

// Try in setImmediate — fires after Electron bootstrapper runs
setImmediate(function si1() {
  log('setImmediate 1 fired. process.type=' + process.type
    + ' electronBinding=' + typeof process.electronBinding);
  if (!tryAppSwitch('setImmediate-1')) {
    setImmediate(function si2() {
      log('setImmediate 2 fired. process.type=' + process.type);
      if (!tryAppSwitch('setImmediate-2')) {
        setTimeout(function t100() {
          log('setTimeout 100ms fired. process.type=' + process.type);
          tryAppSwitch('setTimeout-100');
        }, 100);
      }
    });
  }
});
