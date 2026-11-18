# hyperbeam

A 1-1 end-to-end encrypted internet pipe powered by [Hyperswarm](https://github.com/holepunchto/hyperswarm) and Noise.

Warning: the z32 encoding changed between v3 and v4, and they are NOT compatible. When using the CLI, V4 hyperbeams cannot connect with v3 hyperbeams and vice versa.

```
npm install hyperbeam
```

## Usage

```js
const Hyperbeam = require('hyperbeam')

// '734x69cki46bkbbz75f4c3wh8xicx5zfhajfbhrgnquki66imafo' is a 32-byte unique passphrase
// to find the other side of your pipe.
// Use a different, random passphrase.
// once the other peer is discovered it is used to derive a noise keypair as well.
const beam = new Hyperbeam('734x69cki46bkbbz75f4c3wh8xicx5zfhajfbhrgnquki66imafo')

// to generate a passphrase, leave the constructor empty and hyperbeam will generate one for you
// const beam = new Hyperbeam()
// beam.key // <-- your passphrase

// make a little chat app
process.stdin.pipe(beam).pipe(process.stdout)
```

## CLI

First install it

```sh
npm install -g hyperbeam
```

Then on one machine run

```sh
echo 'hello world' | hyperbeam
```

This will generate a phrase, eg "734x69cki46bkbbz75f4c3wh8xicx5zfhajfbhrgnquki66imafo". Then on another machine run

```sh
# will print "hello world"
hyperbeam 734x69cki46bkbbz75f4c3wh8xicx5zfhajfbhrgnquki66imafo
```

To start a hyperbeam with a predefined key, use -r:

```
hyperbeam 734x69cki46bkbbz75f4c3wh8xicx5zfhajfbhrgnquki66imafo -r
```

That's it! Happy piping.

## API

#### `const stream = new Hyperbeam([key][, options])`

Make a new Hyperbeam duplex stream.

Will auto connect to another peer using the same key with an end to end encrypted tunnel.

When the other peer writes it's emitted as `data` on this stream.

Likewise when you write to this stream it's emitted as `data` on the other peers stream.

If you do not pass a `key` into the constructor (the passphrase), one will be generated and put on `stream.key`.

`options` include:

- `dht`: A DHT instance. Defaults to a new instance.
- `announce`: set true to announce on the dht (initiator side). Default false
-

#### `stream.key`

The passphrase used by the stream for connection.

## License

MIT
