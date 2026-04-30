"use strict";
const electronModule = require('electron');
console.log('[launcher] electron type:', typeof electronModule, '| keys:', electronModule ? Object.keys(electronModule).slice(0,5) : 'null');

const app = electronModule && electronModule.app;
if (app && app.commandLine) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.REMOTE_DEBUG_PORT || '9222');
  console.log('[launcher] CDP enabled on port', process.env.REMOTE_DEBUG_PORT || '9222');
} else {
  console.error('[launcher] WARNING: app.commandLine not available — electron module was:', typeof electronModule);
}

require('C:\\Users\\Public\\Documents\\ExpressPoint\\resources\\app\\src\\main\\index.js');
