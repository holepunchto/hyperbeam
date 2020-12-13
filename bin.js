#!/usr/bin/env node

const Hyperbeam = require('./')

if (process.argv.length < 3) {
  console.error('Usage: hyperbeam <topic>')
  process.exit(1)
}

const beam = new Hyperbeam(process.argv.slice(2).join(' '))

beam.on('remote-address', function ({ host, port }) {
  if (!host) console.error('[hyperbeam] Could not detect remote address')
  else console.error('[hyperbeam] Joined the DHT - remote address is ' + host + ':' + port)
  if (port) console.error('[hyperbeam] Network is holepunchable \\o/')
})

beam.on('connected', function () {
  console.error('[hyperbeam] Success! Encrypted tunnel established to remote peer')
})

beam.on('end', () => beam.end())

process.stdin.pipe(beam).pipe(process.stdout)
process.stdin.unref()

process.once('SIGINT', () => {
  if (!beam.connected) closeASAP()
  else beam.end()
})

function closeASAP () {
  console.error('[hyperbeam] Shutting down beam...')

  const timeout = setTimeout(() => process.exit(1), 2000)
  beam.destroy()
  beam.on('close', function () {
    clearTimeout(timeout)
  })
}
