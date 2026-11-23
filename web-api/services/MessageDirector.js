
const net = require('net')

const Datagram = require('../utils/datagram')

// see game-server/game/otp/ai/AIMsgTypes.py
const STATESERVER_OBJECT_UPDATE_FIELD = 2004

const FIELD_SET_BIO        = 485
const FIELD_SET_GOLD       = 556  // setGold(int32), ownrequired broadcast db ownrecv
const FIELD_WARDROBE_ITEM  = 404  // wardrobeItem(uint32 avId, InvItemExt)
const FIELD_WARDROBE_REMOVE = 406 // wardrobeRemove(uint32 avId, uint64 invId)

// our own channel on the cluster
const WEB_API_CHANNEL = 4010

const RECONNECT_DELAY = 5000

function toInt16(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return 0
  }

  return Math.max(-32768, Math.min(32767, Math.trunc(number)))
}

class MessageDirector {
  constructor(host, port) {
    this.host = host || process.env.MD_HOST || '127.0.0.1'
    this.port = parseInt(process.env.MD_PORT) || port || 6666

    this.socket = null
    this.connected = false
    this.reconnectTimer = null

    this.connect()
  }

  connect() {
    this.reconnectTimer = null

    this.socket = net.createConnection({ host: this.host, port: this.port })

    this.socket.on('connect', () => {
      this.connected = true
      console.log(`Connected to the message director at ${this.host}:${this.port}!`)
    })

    this.socket.on('data', () => {})

    this.socket.on('error', (err) => {
      console.error('Message director connection error:', err.message)
    })

    this.socket.on('close', () => {
      if (this.connected) {
        console.warn('Lost the message director connection, reconnecting...')
      }

      this.connected = false
      this.scheduleReconnect()
    })
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return
    }

    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY)
  }

  // sends are best effort, a lost one only means the cluster keeps a stale copy until
  send(dg) {
    if (!this.connected) {
      console.warn('Not connected to the message director, dropping datagram.')
      return false
    }

    try {
      this.socket.write(dg.toBuffer())
      return true
    } catch (err) {
      console.error('Failed to write to the message director:', err.message)
      return false
    }
  }

  sendUpdateField(doId, fieldId, value) {
    const dg = new Datagram()

    dg.addServerHeader(doId, WEB_API_CHANNEL, STATESERVER_OBJECT_UPDATE_FIELD)
    dg.addUint32(doId)
    dg.addUint16(fieldId)
    dg.addBytes(value)

    return this.send(dg)
  }

  sendFairyBio(doId, bio) {
    const answers = new Datagram()

    for (const answer of bio || []) {
      answers.addInt16(toInt16(answer.id))
      answers.addInt16(toInt16(answer.answer))
    }

    const packed = answers.body()

    const value = new Datagram()
    value.addUint16(packed.length)
    value.addBytes(packed)

    return this.sendUpdateField(doId, FIELD_SET_BIO, value.body())
  }

  sendGold(doId, gold) {
    const value = new Datagram()
    value.addInt32(Math.max(0, Math.min(2147483647, Math.trunc(Number(gold) || 0))))
    return this.sendUpdateField(doId, FIELD_SET_GOLD, value.body())
  }

  // wardrobeRemove(uint32 avId, uint64 invId), removes the item from the client's inventory panel
  // doId is the FairyInventoryMgr global object
  sendWardrobeRemove(inventoryMgrDoId, avId, invId) {
    const value = new Datagram()
    value.addUint32(avId)
    value.addUint64(BigInt(invId))
    return this.sendUpdateField(inventoryMgrDoId, FIELD_WARDROBE_REMOVE, value.body())
  }

  sendWardrobeAdd(inventoryMgrDoId, avId, item) {
    const value = new Datagram()
    value.addUint32(avId)

    // invItemExt fields (order must match fairy.dc struct InvItemExt)
    value.addUint64(BigInt(item.inv_id))
    value.addInt32(item.item_id)
    value.addInt16(item.slot ?? -1)
    value.addUint32(item.giftedById ?? 0)
    value.addString(item.giftedByName ?? '')
    value.addUint32(item.createdById ?? 0)
    value.addString(item.createdByName ?? '')
    value.addInt8(item.quality ?? 0)
    value.addInt16(item.color1 ?? 0)
    value.addInt16(item.color2 ?? 0)
    value.addInt8(item.howAcquired ?? 14)  // 14 = gifted

    return this.sendUpdateField(inventoryMgrDoId, FIELD_WARDROBE_ITEM, value.body())
  }
}

module.exports = MessageDirector
