const { spawn } = require('child_process')
const path = require('path')
const { once } = require('events')
const process = require('process')
const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const NewlineDecoder = require('newline-decoder')

const EXECUTABLE = path.join(__dirname, 'bin.js')

test('pipes stdin of one process to stdout of the other', async (t) => {
  const { bootstrap } = await createTestnet(10, t.teardown)
  const bootstrapArg = `${bootstrap[0].host}:${bootstrap[0].port}`

  const server = spawnHyperbeam(t, '--bootstrap', bootstrapArg)

  const serverSetupProm = waitForOutput(server.stderr, 'Joined the DHT')
  const keyLine = await waitForOutput(server.stderr, 'Run hyperbeam')
  const key = keyLine.match(/Run hyperbeam (\S+)/)[1]
  await serverSetupProm

  const client = spawnHyperbeam(t, key, '--bootstrap', bootstrapArg)

  await waitForOutput(client.stderr, 'Connecting pipe')

  const received = waitForOutput(server.stdout, 'hello from client')
  client.stdin.write('hello from client\n')

  t.is((await received).trim(), 'hello from client', 'message arrives')
})

function spawnHyperbeam(t, ...args) {
  const proc = spawn(process.execPath, [EXECUTABLE, ...args], {
    stdio: 'pipe'
  })

  t.teardown(async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      const killedP = once(proc, 'exit')
      proc.kill('SIGKILL')
      await killedP
    }
  }, 10)

  process.once('exit', () => {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  })

  return proc
}

function waitForOutput(stream, text, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for "${text}"`))
    }, timeout)

    const dec = new NewlineDecoder('utf-8')
    stream.on('data', (data) => {
      for (const line of dec.push(data)) {
        if (line.includes(text)) {
          clearTimeout(timer)
          resolve(line)
        }
      }
    })
  })
}
