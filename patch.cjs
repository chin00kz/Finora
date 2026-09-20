const fs = require('fs');
let file = fs.readFileSync('src/sync/syncEngine.ts', 'utf8');
file = file.replace(/console\.warn\(`\[sync\] pushDirtyRecords failed for \$\{table\}:`, error\.message\);/, "console.warn(`[sync] pushDirtyRecords failed for ${table}:`, error);");
fs.writeFileSync('src/sync/syncEngine.ts', file, 'utf8');
console.log('patched');
