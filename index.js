const { Duplex } = require('streamx')
const crypto = require('crypto')
const b32 = require('hi-base32')
const sodium = require('sodium-native')
const DHT = require('@hyperswarm/dht')

module.exports = class Hyperbeam extends Duplex {
  constructor (key) {
    super()

    let announce = false
    if (!key) {
      key = toBase32(crypto.randomBytes(32))
      announce = true
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

  async _open (cb) {
    try {
      const keyPair = DHT.keyPair(fromBase32(this.key))

      this._onopen = cb
      this._node = new DHT({ ephemeral: true })

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
          this.emit('connected')
          this._onopenDone(null)
        }
      }

      if (this._announce) {
        this._server = this._node.createServer({
          firewall (remotePublicKey) {
            return !remotePublicKey.equals(keyPair.publicKey)
          }
        })
        this._server.on('connection', onConnection)
        await this._server.listen(keyPair)
        this.emit('remote-address', this._server.address() || {host: null, port: 0})
      } else {
        this.emit('remote-address', this._node.address() || {host: null, port: 0})
        const connection = this._node.connect(keyPair.publicKey, {keyPair})
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

async function toArray (iterable) {
  const result = []
  for await (const data of iterable) result.push(data)
  return result
}

function toBase32 (buf) {
  return b32.encode(buf).replace(/=/g, '').toLowerCase()
}

function fromBase32 (str) {
  return Buffer.from(b32.decode.asBytes(str.toUpperCase()))
}