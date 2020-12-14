const { Duplex } = require('streamx')
const BeamSwarm = require('./swarm')

module.exports = class Hyperbeam extends Duplex {
  constructor(key) {
    super()

    this._key = key
    this._out = null
    this._inc = null
    this._now = Date.now()
    this._ondrain = null
    this._onopen = null
    this._onread = null

    this._swarm = new BeamSwarm(this._key)
    this._swarm.on('remote-address', addr => this.emit('remote-address', addr))
    this._swarm.once('connected', () => this.emit('connected'))
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

  _open(cb) {
    this._onopen = cb
    this._swarm.open()
    this._swarm.on('connection', (s, info) => {
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
        this._swarm.leave()
        this.emit('connected')
        this._onopenDone(null)
      }
    })
  }

  _read(cb) {
    this._onread = cb
    if (this._inc) this._inc.resume()
  }

  _push(data) {
    const res = this.push(data)
    process.nextTick(() => this._onreadDone(null))
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
    if (this._inc) this._inc.destroy()
    if (this._out) this._out.destroy()
    const err = new Error('Destroyed')
    this._onopenDone(err)
    this._onreadDone(err)
    this._ondrainDone(err)
  }

  _destroy(cb) {
    return this._swarm.destroy(cb)
  }
}

