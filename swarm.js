const { EventEmitter } = require('events')
const sodium = require('sodium-native')
const hyperswarm = require('hyperswarm')
const noise = require('noise-peer')

const MAX_DRIFT = 60e3 * 30 // thirty min
const KEY_DRIFT = 60e3 * 2 // two min

module.exports = class BeamSwarm extends EventEmitter {
  constructor (key) {
    super()
    this._key = key
    this._now = Date.now()
    this._swarm = null
    this._topics = null
  }

  _keys () {
    const now = Date.now()
    const then = now - (now % KEY_DRIFT)

    return [
      noise.seedKeygen(hash(encode(then, this._key))),
      noise.seedKeygen(hash(encode(then + KEY_DRIFT, this._key))),
      noise.seedKeygen(hash(encode(then + 2 * KEY_DRIFT, this._key)))
    ]
  }

  _dkeys () {
    const then = this._now - (this._now % MAX_DRIFT)

    this._topics = [
      hash('hyperbeam', hash(encode(then, this._key))),
      hash('hyperbeam', hash(encode(then + MAX_DRIFT, this._key)))
    ]

    return this._topics
  }

  open () {
    this._dkeys()
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
        this.emit('connection', s, connection, info)
      })
    })

    this._swarm.join(this._topics[0], { lookup: true, announce: true })
    this._swarm.join(this._topics[1], { lookup: true, announce: true })
  }

  leave () {
    if (!this._topics) return
    this._swarm.leave(this._topics[0])
    this._swarm.leave(this._topics[1])
  }

  destroy (cb) {
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
