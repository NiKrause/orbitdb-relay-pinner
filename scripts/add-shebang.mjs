import fs from 'node:fs'
import path from 'node:path'

const cliPath = path.resolve('dist', 'cli.js')
const shebang = '#!/usr/bin/env node\n'

if (!fs.existsSync(cliPath)) {
  // Build artifacts not present; nothing to do.
  process.exit(0)
}

const data = fs.readFileSync(cliPath, 'utf8')
if (data.startsWith(shebang)) process.exit(0)

fs.writeFileSync(cliPath, shebang + data, 'utf8')
