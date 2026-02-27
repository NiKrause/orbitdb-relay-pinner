import fs from 'node:fs'
import path from 'node:path'

const cliPath = path.resolve('dist', 'cli.js')
const shebang = '#!/usr/bin/env node\n'

if (!fs.existsSync(cliPath)) {
  // Build artifacts not present; nothing to do.
  process.exit(0)
}

const data = fs.readFileSync(cliPath, 'utf8')
if (!data.startsWith(shebang)) {
  fs.writeFileSync(cliPath, shebang + data, 'utf8')
}

// Ensure npm package bin target is executable for systemd/env execution.
fs.chmodSync(cliPath, 0o755)
