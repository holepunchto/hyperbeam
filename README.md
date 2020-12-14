# hyperbeam

A 1-1 end-to-end encrypted internet pipe powered by [Hyperswarm](https://github.com/hyperswarm/hyperswarm) and Noise

```
npm install hyperbeam
```

## Usage

``` js
const Hyperbeam = require('hyperbeam')

// 'fraying stopping granular' is a somewhat unique passphrase used to derive a discovery key
// to find the other side of your pipe. it's seemed with a determistic timestamp from ~+-30min for better privacy
// once the other peer is discovered it is used to derive a noise keypair as well.
const beam = new Hyperbeam('fraying stopping granular')

// to generate a passphrase, leave the constructor empty and hyperbeam will generate one for you
// const beam = new Hyperbeam()
// beam.key // <-- your passphrase

// make a little chat app
process.stdin.pipe(beam).pipe(process.stdout)
```

## CLI

Part of the [Hyperspace CLI, hyp](https://github.com/hypercore-protocol/cli)

Provided here as a standalone CLI as well.

First install it

```sh
npm install -g hyperbeam
```

Then on one machine run

```sh
echo 'hello world' | hyperbeam
```

This will generate a phrase, eg "fraying stopping granular". Then on another machine run

```sh
# will print "hello world"
hyperbeam fraying stopping granular
```

That's it! Happy piping.

## API

#### `const stream = new Hyperbeam([key])`

Make a new Hyperbeam duplex stream.
 
Will auto connect to another peer making using the same key within ~30 min with an end to end encrypted tunnel.

When the other peer writes it's emitted as `data` on this stream.

Likewise when you write to this stream it's emitted as `data` on the other peers stream.

If you do not pass a `key` into the constructor (the passphrase), one will be generated and put on `stream.key`.

#### `stream.key`

The passphrase used by the stream for connection.

## License

MIT
