// builds datagrams for the otp message director

class Datagram {
  constructor() {
    this.chunks = []
  }

  addBytes(buffer) {
    this.chunks.push(buffer)
    return this
  }

  addUint8(value) {
    const buffer = Buffer.alloc(1)
    buffer.writeUInt8(value)
    return this.addBytes(buffer)
  }

  addInt16(value) {
    const buffer = Buffer.alloc(2)
    buffer.writeInt16LE(value)
    return this.addBytes(buffer)
  }

  addUint16(value) {
    const buffer = Buffer.alloc(2)
    buffer.writeUInt16LE(value)
    return this.addBytes(buffer)
  }

  addUint32(value) {
    const buffer = Buffer.alloc(4)
    buffer.writeUInt32LE(value)
    return this.addBytes(buffer)
  }

  addChannel(value) {
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64LE(BigInt(value))
    return this.addBytes(buffer)
  }

  addServerHeader(channel, sender, msgType) {
    this.addUint8(1)
    this.addChannel(channel)
    this.addChannel(sender)
    this.addUint16(msgType)
    return this
  }

  body() {
    return Buffer.concat(this.chunks)
  }

  toBuffer() {
    const body = this.body()
    const header = Buffer.alloc(2)
    header.writeUInt16LE(body.length)
    return Buffer.concat([header, body])
  }
}

module.exports = Datagram
