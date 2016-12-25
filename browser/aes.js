import { AES as SjclAES } from './sjcl'
import { EventEmitter } from 'events'

export function simpleEncryptAES (key, plaintext) {
  return new SjclAES(key).encrypt(plaintext)
}

class AES {
  constructor (key) {
    const a32 = []
    for (let i = 0; i < 4; i++) a32[i] = key.readInt32BE(i * 4)
    this.aes = new SjclAES(a32)
  }

  encryptCBC (buffer) {
    let iv = [0, 0, 0, 0]
    let d = Array(4)
    let i
    let j

    for (i = 0; i < buffer.length; i += 16) {
      for (j = 0; j < 4; j++) {
        d[j] = buffer.readUInt32BE(i + j * 4, false) ^ iv[j]
      }
      iv = this.aes.encrypt(d)

      for (j = 0; j < 4; j++) {
        buffer.writeInt32BE(iv[j], i + j * 4, false)
      }
    }
  }

  decryptCBC (buffer) {
    let iv = [0, 0, 0, 0]
    let d = Array(4)
    let t = Array(4)
    let i
    let j

    for (i = 0; i < buffer.length; i += 16) {
      for (j = 0; j < 4; j++) {
        d[j] = buffer.readUInt32BE(i + j * 4, false)
      }
      t = d

      d = this.aes.decrypt(d)

      for (j = 0; j < 4; j++) {
        buffer.writeInt32BE(d[j] ^ iv[j], i + j * 4, false)
      }
      iv = t
    }
  }

  stringhash (buffer) {
    let h32 = [0, 0, 0, 0]
    for (let i = 0; i < buffer.length; i += 4) {
      h32[(i / 4) & 3] ^= buffer.readInt32BE(i, true)
    }
    for (let i = 16384; i--;) h32 = this.aes.encrypt(h32)

    const b = new Buffer(8)
    b.writeInt32BE(h32[0], 0, true)
    b.writeInt32BE(h32[2], 4, true)
    return b
  }

  decryptECB (key) {
    let d = []
    for (let i = 0; i < key.length; i += 16) {
      d[0] = key.readInt32BE(i, false)
      d[1] = key.readInt32BE(i + 4, false)
      d[2] = key.readInt32BE(i + 8, false)
      d[3] = key.readInt32BE(i + 12, false)

      d = this.aes.decrypt(d)

      key.writeInt32BE(d[0], i, false)
      key.writeInt32BE(d[1], i + 4, false)
      key.writeInt32BE(d[2], i + 8, false)
      key.writeInt32BE(d[3], i + 12, false)
    }
    return key
  }

  encryptECB (key) {
    let d = []
    for (let i = 0; i < key.length; i += 16) {
      d[0] = key.readInt32BE(i, false)
      d[1] = key.readInt32BE(i + 4, false)
      d[2] = key.readInt32BE(i + 8, false)
      d[3] = key.readInt32BE(i + 12, false)

      d = this.aes.encrypt(d)

      key.writeInt32BE(d[0], i, false)
      key.writeInt32BE(d[1], i + 4, false)
      key.writeInt32BE(d[2], i + 8, false)
      key.writeInt32BE(d[3], i + 12, false)
    }
    return key
  }
}

class CTR extends EventEmitter {
  constructor (aes, nonce) {
    super()
    this.aes = aes.aes
    this.nonce = nonce

    this.posNext = this.increment = 131072 // 2**17
    this.pos = 0

    this.encrypt = this._process.bind(this, true)
    this.decrypt = this._process.bind(this, false)

    this.ctr = [this.nonce[0], this.nonce[1], 0, 0]
    this.mac = [this.ctr[0], this.ctr[1], this.ctr[0], this.ctr[1]]

    this.macs = []

    this.on('mac', m => {
      this.macs.push(m)
    })
  }

  condensedMac () {
    if (this.mac) {
      this.macs.push(this.mac)
      this.mac = undefined
    }
    let i
    let j
    let mac = [0, 0, 0, 0]

    for (i = 0; i < this.macs.length; i++) {
      for (j = 0; j < 4; j++) mac[j] ^= this.macs[i][j]
      mac = this.aes.encrypt(mac)
    }
    return mac
  }

  _process (encrypt, buffer) {
    for (let i = 0; i < buffer.length; i += 16) {
      let d = []
      let enc

      if (encrypt) {
        d[0] = buffer.readInt32BE(i, true)
        d[1] = buffer.readInt32BE(i + 4, true)
        d[2] = buffer.readInt32BE(i + 8, true)
        d[3] = buffer.readInt32BE(i + 12, true)

        // compute MAC
        this.mac[0] ^= d[0]
        this.mac[1] ^= d[1]
        this.mac[2] ^= d[2]
        this.mac[3] ^= d[3]
        this.mac = this.aes.encrypt(this.mac)

        // encrypt using CTR
        enc = this.aes.encrypt(this.ctr)
        buffer.writeInt32BE(d[0] ^ enc[0], i, true)
        buffer.writeInt32BE(d[1] ^ enc[1], i + 4, true)
        buffer.writeInt32BE(d[2] ^ enc[2], i + 8, true)
        buffer.writeInt32BE(d[3] ^ enc[3], i + 12, true)
      } else {
        enc = this.aes.encrypt(this.ctr)

        d[0] = buffer.readInt32BE(i, true) ^ enc[0]
        d[1] = buffer.readInt32BE(i + 4, true) ^ enc[1]
        d[2] = buffer.readInt32BE(i + 8, true) ^ enc[2]
        d[3] = buffer.readInt32BE(i + 12, true) ^ enc[3]

        buffer.writeInt32BE(d[0], i, true)
        buffer.writeInt32BE(d[1], i + 4, true)
        buffer.writeInt32BE(d[2], i + 8, true)
        buffer.writeInt32BE(d[3], i + 12, true)

        this.mac[0] ^= buffer.readInt32BE(i, true)
        this.mac[1] ^= buffer.readInt32BE(i + 4, true)
        this.mac[2] ^= buffer.readInt32BE(i + 8, true)
        this.mac[3] ^= buffer.readInt32BE(i + 12, true)

        this.mac = this.aes.encrypt(this.mac)
      }

      if (!(++this.ctr[3])) this.ctr[2]++

      this.pos += 16
      if (this.pos >= this.posNext) {
        this.emit('mac', this.mac)
        this.ctr[2] = (this.pos / 0x1000000000) >>> 0
        this.ctr[3] = (this.pos / 0x10) >>> 0
        this.mac = [this.ctr[0], this.ctr[1], this.ctr[0], this.ctr[1]]
        if (this.increment < 1048576) this.increment += 131072
        this.posNext += this.increment
      }
    }
  }
}

export {AES, CTR}
