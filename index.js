const { Duplex } = require('streamx')
const sodium = require('sodium-native')
const generatePassphrase = require('eff-diceware-passphrase')
const DHT = require('@hyperswarm/dht')

const MAX_DRIFT = 60e3 * 30 // thirty min
const KEY_DRIFT = 60e3 * 2 // two min

module.exports = class Hyperbeam extends Duplex {
  constructor (key) {
    super()

    let announce = false
    if (!key) {
      key = generatePassphrase(3).join(' ')
      announce = true
    } else {
      for (const word of key.split(' ')) {
        if (!generatePassphrase.words.includes(word)) {
          throw new PassphraseError(`Invalid passphrase word: "${word}". Check your spelling and try again.`)
        }
      }
    }

    this.key = key
    this._announce = announce
    this._node = null
    this._server = null
    this._out = null
    this._inc = null
    this._now = Date.now()
    this._ondrain = null
    this._onopen = null
    this._onread = null
  }

  get connected () {
    return !!this._out
  }

  _ondrainDone (err) {
    if (this._ondrain) {
      const cb = this._ondrain
      this._ondrain = null
      cb(err)
    }
  }

  _onreadDone (err) {
    if (this._onread) {
      const cb = this._onread
      this._onread = null
      cb(err)
    }
  }

  _onopenDone (err) {
    if (this._onopen) {
      const cb = this._onopen
      this._onopen = null
      cb(err)
    }
  }

  _keys (role) {
    const now = Date.now()
    const then = now - (now % KEY_DRIFT)

    const key = `${role} ${this.key}`
    return [
      DHT.keyPair(hash(encode(then, key))),
      DHT.keyPair(hash(encode(then + KEY_DRIFT, key))),
      DHT.keyPair(hash(encode(then + 2 * KEY_DRIFT, key)))
    ]
  }

  _dkeys () {
    const then = this._now - (this._now % MAX_DRIFT)

    return [
      hash('hyperbeam', hash(encode(then, this.key))),
      hash('hyperbeam', hash(encode(then + MAX_DRIFT, this.key)))
    ]
  }

  async _open (cb) {
    try {
      const [a, b] = this._dkeys()

      this._onopen = cb
      this._node = new DHT({ ephemeral: true })
      await this._node.ready()

      const serverKeys = this._keys('server')
      const clientKeys = this._keys('client')
      const myKeyPair = this._announce ? serverKeys[1] : clientKeys[1]

      const onConnection = s => {
        s.on('data', (data) => {
          if (!this._inc) {
            this._inc = s
            this._inc.on('error', (err) => this.destroy(err))
            this._inc.on('end', () => this._push(null))
          }

          if (s !== this._inc) return
          if (this._push(data) === false) s.pause()
        })

        s.on('end', () => {
          if (this._inc) return
          this._push(null)
        })

        if (!this._out) {
          this._out = s
          this._out.on('error', (err) => this.destroy(err))
          this._out.on('drain', () => this._ondrain(null))
          if (this._announce) {
            this._node.unannounce(a, myKeyPair)
            this._node.unannounce(b, myKeyPair)
          }
          this.emit('connected')
          this._onopenDone(null)
        }
      }

      if (this._announce) {
        this._server = this._node.createServer({
          firewall (remotePublicKey) {
            for (const { publicKey } of clientKeys) {
              if (publicKey.equals(remotePublicKey)) return false
            }
            return true
          }
        })
        this._server.on('connection', onConnection)
        await this._server.listen(myKeyPair)
        this.emit('remote-address', this._server.address() || {host: null, port: 0})
        await this._node.announce(a, myKeyPair).finished()
        await this._node.announce(b, myKeyPair).finished()
      } else {
        const [stream1, stream2] = await Promise.all([
          toArray(this._node.lookup(a)),
          toArray(this._node.lookup(b))
        ])
        const peers = stream1.concat(stream2).reduce((acc, hit) => acc.concat(hit.peers), [])
        const peer = peers.find(p => serverKeys.find(kp => kp.publicKey.equals(p.publicKey)))
        if (!peer) {
          throw new PeerNotFoundError('No device was found. They may not be online anymore, or the passphrase may have expired.')
        }
        this.emit('remote-address', this._node.address() || {host: null, port: 0})
        const connection = this._node.connect(peer.publicKey, {
          nodes: peer.nodes,
          keyPair: myKeyPair
        })
        await new Promise((resolve, reject) => {
          connection.once('open', resolve)
          connection.once('close', reject)
          connection.once('error', reject)
        })
        onConnection(connection)
      }
    } catch (e) {
      cb(e)
    }
  }

  _read (cb) {
    this._onread = cb
    if (this._inc) this._inc.resume()
  }

  _push (data) {
    const res = this.push(data)
    process.nextTick(() => this._onreadDone(null))
    return res
  }

  _write (data, cb) {
    if (this._out.write(data) !== false) return cb(null)
    this._ondrain = cb
  }

  _final (cb) {
    const done = () => {
      this._out.removeListener('finish', done)
      this._out.removeListener('error', done)
      cb(null)
    }

    this._out.end()
    this._out.on('finish', done)
    this._out.on('error', done)
  }

  _predestroy () {
    if (this._inc) this._inc.destroy()
    if (this._out) this._out.destroy()
    const err = new Error('Destroyed')
    this._onopenDone(err)
    this._onreadDone(err)
    this._ondrainDone(err)
  }

  async _destroy (cb) {
    if (!this._node) return cb(null)
    if (this._server) await this._server.close().catch(e => undefined)
    await this._node.destroy().catch(e => undefined)
    cb(null)
  }
}

function encode (num, key) {
  const buf = Buffer.alloc(8 + Buffer.byteLength(key))
  buf.writeDoubleBE(num)
  buf.write(key, 8)
  return buf
}

function hash (data, seed) {
  const out = Buffer.alloc(32)
  if (seed) sodium.crypto_generichash(out, Buffer.from(data), seed)
  else sodium.crypto_generichash(out, Buffer.from(data))
  return out
}

class PeerNotFoundError extends Error {
  constructor(msg) {
    super(msg)
    this.name = this.constructor.name
    this.message = msg
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor)
    } else {
      this.stack = (new Error(msg)).stack
    }
  }
}


class PassphraseError extends Error {
  constructor(msg) {
    super(msg)
    this.name = this.constructor.name
    this.message = msg
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor)
    } else {
      this.stack = (new Error(msg)).stack
    }
  }
}

async function toArray (iterable) {
  const result = []
  for await (const data of iterable) result.push(data)
  return result
}