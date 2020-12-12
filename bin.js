#!/usr/bin/env node

const Hyperbeam = require('hyperbeam')

if (process.argv.length < 3) {
  console.error('Usage: hyperbeam <topic>')
  process.exit(1)
}

const beam = new Hyperbeam(process.argv.slice(2).join(' '))
process.stdin.pipe(beam).pipe(process.stdout)
