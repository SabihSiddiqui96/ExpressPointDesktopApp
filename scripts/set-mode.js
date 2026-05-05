// Updates TEST_MODE in .env. The webhook reporter loads .env at start,
// so flipping this value before running tests changes whether the webhook fires.
const fs = require('fs');
const path = require('path');

const mode = (process.argv[2] || '').toLowerCase();
if (mode !== 'qa' && mode !== 'regression') {
  console.error('Usage: node scripts/set-mode.js <qa|regression>');
  process.exit(2);
}

const envPath = path.resolve(__dirname, '..', '.env');
let contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

if (/^TEST_MODE=.*$/m.test(contents)) {
  contents = contents.replace(/^TEST_MODE=.*$/m, `TEST_MODE=${mode}`);
} else {
  if (contents.length > 0 && !contents.endsWith('\n')) contents += '\n';
  contents += `TEST_MODE=${mode}\n`;
}

fs.writeFileSync(envPath, contents);
console.log(`✓ TEST_MODE set to "${mode}" in .env`);
console.log(mode === 'regression'
  ? '  Webhook WILL be sent on the next test run.'
  : '  Webhook will NOT be sent on test runs.');
