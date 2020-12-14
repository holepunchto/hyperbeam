const { Duplex } = require('streamx')
const sodium = require('sodium-native')
const hyperswarm = require('hyperswarm')
const noise = require('noise-peer')
const generatePassphrase = require('eff-diceware-passphrase')

const MAX_DRIFT = 60e3 * 30 // thirty min
const KEY_DRIFT = 60e3 * 2 // two min

module.exports = class Hyperbeam extends Duplex {
  constructor (key) {
    super()

    var announce = false
    if (!key) {
      key = generatePassphrase(3).join(' ')
      announce = true
    } else {
      for (let word of key.split(' ')) {
        if (!generatePassphrase.includes(word)) {
          throw new PassPhraseError(`Invalid pass-phrase word: "${word}". Check your spelling and try again.`)
        }
      }
    }

    this.key = key
    this._announce = announce
    this._swarm = null
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

  _keys () {
    const now = Date.now()
    const then = now - (now % KEY_DRIFT)

    return [
      noise.seedKeygen(hash(encode(then, this.key))),
      noise.seedKeygen(hash(encode(then + KEY_DRIFT, this.key))),
      noise.seedKeygen(hash(encode(then + 2 * KEY_DRIFT, this.key)))
    ]
  }

  _dkeys () {
    const then = this._now - (this._now % MAX_DRIFT)

    return [
      hash('hyperbeam', hash(encode(then, this.key))),
      hash('hyperbeam', hash(encode(then + MAX_DRIFT, this.key)))
    ]
  }

  _open (cb) {
    const [a, b] = this._dkeys()

    this._onopen = cb
    this._swarm = hyperswarm({ preferredPort: 49737, ephemeral: true, queue: { multiplex: true } })

    this._swarm.on('listening', () => {
      this._swarm.network.discovery.dht.on('initial-nodes', () => {
        this.emit('remote-address', this._swarm.network.discovery.dht.remoteAddress() || { host: null, port: 0 })
      })
    })
    this._swarm.on('connection', (connection, info) => {
      if (info.type === 'tcp') connection.allowHalfOpen = true
      connection.on('error', () => {})

      const staticKeyPairs = this._keys()

      const s = noise(connection, info.client, {
        pattern: 'XX',
        staticKeyPair: staticKeyPairs[1],
        onstatickey (remotePublicKey, cb) {
          for (const { publicKey } of staticKeyPairs) {
            if (publicKey.equals(remotePublicKey)) return cb(null)
          }

          cb(new Error('Remote public key did not match'))
        }
      })

      s.on('handshake', () => {
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
          this._swarm.leave(a)
          this._swarm.leave(b)
          this.emit('connected')
          this._onopenDone(null)
        }
      })
    })

    this._swarm.join(a, { lookup: true, announce: this._announce })
    this._swarm.join(b, { lookup: true, announce: this._announce })
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

  _destroy (cb) {
    if (!this._swarm) return cb(null)
    this._swarm.on('close', () => cb(null))
    this._swarm.destroy()
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

class PassPhraseError extends Error {
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