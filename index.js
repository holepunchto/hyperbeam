const { Duplex } = require('streamx')
const sodium = require('sodium-universal')
const b4a = require('b4a')
const queueTick = require('queue-tick')
const IdEnc = require('hypercore-id-encoding')
const DHT = require('hyperdht')
const isOptions = require('is-options')

module.exports = class Hyperbeam extends Duplex {
  constructor(dht, key, options) {
    super()

    if (isOptions(key)) {
      options = key
      key = null
    }

    if (key) key = IdEnc.normalize(key)
    if (!options) options = {}

    let announce = !!options.announce

    if (!key) {
      key = IdEnc.encode(randomBytes(32))
      announce = true
    }

    this.key = key
    this.announce = announce
    this.dht = dht

    this._server = null
    this._connection = null
    this._out = null
    this._inc = null
    this._now = Date.now()
    this._ondrain = null
    this._onopen = null
    this._onread = null
  }

  get connected() {
    return !!this._out
  }

  _ondrainDone(err) {
    if (this._ondrain) {
      const cb = this._ondrain
      this._ondrain = null
      cb(err)
    }
  }

  _onreadDone(err) {
    if (this._onread) {
      const cb = this._onread
      this._onread = null
      cb(err)
    }
  }

  _onopenDone(err) {
    if (this._onopen) {
      const cb = this._onopen
      this._onopen = null
      cb(err)
    }
  }

  async _open(cb) {
    const keyPair = DHT.keyPair(IdEnc.decode(this.key))

    this._onopen = cb

    const onConnection = (s) => {
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

    if (this.announce) {
      this._server = this.dht.createServer({
        firewall(remotePublicKey) {
          return !b4a.equals(remotePublicKey, keyPair.publicKey)
        }
      })
      this._server.on('connection', onConnection)
      try {
        await this._server.listen(keyPair)
      } catch (err) {
        this._onopenDone(err)
        return
      }
      this.emit('remote-address', { host: this.dht.host, port: this.dht.port })
      return
    }

    const connection = this.dht.connect(keyPair.publicKey, { keyPair })
    this._connection = connection
    try {
      await new Promise((resolve, reject) => {
        connection.once('open', resolve)
        connection.once('close', reject)
        connection.once('error', reject)
      })
    } catch (err) {
      this._onopenDone(err)
      return
    }
    this.emit('remote-address', { host: this.dht.host, port: this.dht.port })
    onConnection(connection)
  }

  _read(cb) {
    this._onread = cb
    if (this._inc) this._inc.resume()
  }

  _push(data) {
    const res = this.push(data)
    queueTick(() => this._onreadDone(null))
    return res
  }

  _write(data, cb) {
    if (this._out.write(data) !== false) return cb(null)
    this._ondrain = cb
  }

  _final(cb) {
    const done = () => {
      this._out.removeListener('finish', done)
      this._out.removeListener('error', done)
      cb(null)
    }

    this._out.end()
    this._out.on('finish', done)
    this._out.on('error', done)
  }

  _predestroy() {
    if (this._connection) this._connection.destroy()
    if (this._inc) this._inc.destroy()
    if (this._out) this._out.destroy()
    const err = new Error('Destroyed')
    this._onopenDone(err)
    this._onreadDone(err)
    this._ondrainDone(err)
  }

  async _destroy(cb) {
    if (this._server) await this._server.close().catch((e) => undefined)
    cb(null)
  }
}

function randomBytes(length) {
  const buffer = b4a.alloc(length)
  sodium.randombytes_buf(buffer)
  return buffer
}
