const { spawn } = require('child_process')
const path = require('path')
const { once } = require('events')
const process = require('process')
const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const NewlineDecoder = require('newline-decoder')
const b4a = require('b4a')
const DHT = require('hyperdht')

const Hyperbeam = require('.')

const EXECUTABLE = path.join(__dirname, 'bin.js')

test('basic happy path', async (t) => {
  const { bootstrap } = await createTestnet(10, t.teardown)
  const bootstrapArg = `${bootstrap[0].host}:${bootstrap[0].port}`

  const server = spawnHyperbeam(t, bootstrapArg)

  const serverSetupProm = waitForOutput(server.stderr, 'Joined the DHT')
  const keyLine = await waitForOutput(server.stderr, 'Run hyperbeam')
  const key = keyLine.match(/Run hyperbeam (\S+)/)[1]
  await serverSetupProm

  const client = spawnHyperbeam(t, bootstrapArg, key)

  const received = waitForOutput(server.stdout, 'hello from client')
  client.stdin.write('hello from client\n')

  t.is((await received).trim(), 'hello from client', 'message arrives')

  const serverExit = once(server, 'exit')
  const clientExit = once(client, 'exit')
  client.stdin.end()

  const [clientCode] = await clientExit
  const [serverCode] = await serverExit

  t.is(clientCode, 0, 'client exits cleanly')
  t.is(serverCode, 0, 'server exits cleanly')
})

test('-r announces with an existing key', async (t) => {
  const { bootstrap } = await createTestnet(10, t.teardown)
  const bootstrapArg = `${bootstrap[0].host}:${bootstrap[0].port}`

  const key = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbby'

  const server = spawnHyperbeam(t, bootstrapArg, key, '-r')

  const serverSetupProm = waitForOutput(server.stderr, 'Joined the DHT')
  const keyLine = await waitForOutput(server.stderr, 'Run hyperbeam')
  t.is(keyLine.match(/Run hyperbeam (\S+)/)[1], key, 'correctkey')
  await serverSetupProm

  const client = spawnHyperbeam(t, bootstrapArg, key)

  const received = waitForOutput(server.stdout, 'hello from client')
  client.stdin.write('hello from client\n')

  t.is((await received).trim(), 'hello from client', 'message arrives')
})

function spawnHyperbeam(t, bootstrap, ...args) {
  const proc = spawn(process.execPath, [EXECUTABLE, ...args], {
    stdio: 'pipe',
    env: { ...process.env, HYPERBEAM_BOOTSTRAP: bootstrap }
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

test('hyperbeam basic happy path', async function (t) {
  t.plan(4)

  const testnet = await createTestnet(10)

  const dhtA = new DHT({ bootstrap: testnet.bootstrap })
  const dhtB = new DHT({ bootstrap: testnet.bootstrap })

  const a = new Hyperbeam(dhtA)
  a.once('data', function (data) {
    t.alike(data, b4a.from('hello from b'), 'a received data from b')
  })
  await once(a, 'remote-address')

  const b = new Hyperbeam(dhtB, a.key)
  b.once('data', function (data) {
    t.alike(data, b4a.from('hello from a'), 'b received data from a')
  })

  t.ok(a.announce, 'announces when no key is passed')
  t.absent(b.announce, 'does not announce when key is passed')

  t.teardown(async () => {
    const closed = Promise.all([once(a, 'close'), once(b, 'close')])
    a.destroy()
    b.destroy()
    await closed
    await dhtA.destroy()
    await dhtB.destroy()
    await testnet.destroy()
  })

  a.write(b4a.from('hello from a'))
  b.write(b4a.from('hello from b'))
})

function waitForOutput(stream, text, timeout = 10000) {
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
