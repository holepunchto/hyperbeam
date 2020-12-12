#!/usr/bin/env node

const Hyperbeam = require('./')

if (process.argv.length < 3) {
  console.error('Usage: hyperbeam <topic>')
  process.exit(1)
}

const beam = new Hyperbeam(process.argv.slice(2).join(' '))
beam.on('end', () => beam.end())

process.stdin.pipe(beam).pipe(process.stdout)
process.stdin.unref()

process.once('SIGINT', () => {
  if (!beam.connected) process.exit()
  beam.end()
})
