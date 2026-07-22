/**
 * MQTT 5.0 报文构造/解析（1:1 移植 Android platform/qq/MqttProtocol.kt）。
 * 仅覆盖 QQ 音乐扫码登录用到的 CONNECT/SUBSCRIBE 构造与 CONNACK/SUBACK/PUBLISH 解析。
 * 全程用 Node Buffer，字符串按字节长度写 UTF-8。
 */

// Packet types（高 4 位）
const CONNECT = 0x10
const CONNACK = 0x20
const SUBSCRIBE = 0x82
const SUBACK = 0x90
const PUBLISH = 0x30

// Property IDs
const AUTH_METHOD = 0x15
const USER_PROPERTY = 0x26
const SERVER_REFERENCE = 0x1c
const REASON_STRING = 0x1f

export { CONNACK, SUBACK, PUBLISH }

type UserProp = [string, string]

/** 累积字节的小工具（对应 ByteArrayOutputStream + DataOutputStream 语义）。 */
class ByteWriter {
  private chunks: number[] = []
  u8(v: number): void {
    this.chunks.push(v & 0xff)
  }
  u16(v: number): void {
    this.chunks.push((v >> 8) & 0xff, v & 0xff)
  }
  bytes(b: Buffer): void {
    for (const x of b) this.chunks.push(x)
  }
  /** 写入 MQTT 变长整数（Variable Byte Integer）。 */
  varInt(value: number): void {
    let v = value
    do {
      let byte = v % 128
      v = Math.floor(v / 128)
      if (v > 0) byte = byte | 0x80
      this.chunks.push(byte)
    } while (v > 0)
  }
  toBuffer(): Buffer {
    return Buffer.from(this.chunks)
  }
  get size(): number {
    return this.chunks.length
  }
}

function utf8(s: string): Buffer {
  return Buffer.from(s, 'utf-8')
}

function buildProperties(authMethod: string | null, userProperties: UserProp[]): Buffer {
  const w = new ByteWriter()
  if (authMethod != null) {
    const b = utf8(authMethod)
    w.u8(AUTH_METHOD)
    w.u16(b.length)
    w.bytes(b)
  }
  for (const [key, value] of userProperties) {
    const kb = utf8(key)
    const vb = utf8(value)
    w.u8(USER_PROPERTY)
    w.u16(kb.length)
    w.bytes(kb)
    w.u16(vb.length)
    w.bytes(vb)
  }
  return w.toBuffer()
}

export function buildConnectPacket(opts: {
  clientId: string
  authMethod?: string | null
  userProperties?: UserProp[]
  keepAlive?: number
}): Buffer {
  const { clientId, authMethod = null, userProperties = [], keepAlive = 45 } = opts
  const payload = new ByteWriter()

  payload.u16(4)
  payload.bytes(utf8('MQTT'))
  payload.u8(5) // MQTT 5.0
  payload.u8(0x02) // Clean Start
  payload.u16(keepAlive)

  const props = buildProperties(authMethod, userProperties)
  payload.varInt(props.length)
  payload.bytes(props)

  const cid = utf8(clientId)
  payload.u16(cid.length)
  payload.bytes(cid)

  const variableAndPayload = payload.toBuffer()
  const packet = new ByteWriter()
  packet.u8(CONNECT)
  packet.varInt(variableAndPayload.length)
  packet.bytes(variableAndPayload)
  return packet.toBuffer()
}

export function buildSubscribePacket(opts: {
  packetId: number
  topic: string
  userProperties?: UserProp[]
}): Buffer {
  const { packetId, topic, userProperties = [] } = opts
  const payload = new ByteWriter()

  payload.u16(packetId)

  const props = buildProperties(null, userProperties)
  payload.varInt(props.length)
  payload.bytes(props)

  const tb = utf8(topic)
  payload.u16(tb.length)
  payload.bytes(tb)
  payload.u8(0) // QoS 0

  const variableAndPayload = payload.toBuffer()
  const packet = new ByteWriter()
  packet.u8(SUBSCRIBE)
  packet.varInt(variableAndPayload.length)
  packet.bytes(variableAndPayload)
  return packet.toBuffer()
}

export interface MqttMessage {
  type: number
  serverReference?: string
  userProperties: Record<string, string>
  payload?: Buffer
}

/** 顺序读取的 ByteBuffer 等价物。 */
class ByteReader {
  private pos = 0
  constructor(private buf: Buffer) {}
  get position(): number {
    return this.pos
  }
  get remaining(): number {
    return this.buf.length - this.pos
  }
  hasRemaining(): boolean {
    return this.pos < this.buf.length
  }
  u8(): number {
    return this.buf[this.pos++]
  }
  u16(): number {
    const v = this.buf.readUInt16BE(this.pos)
    this.pos += 2
    return v
  }
  read(n: number): Buffer {
    const b = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return b
  }
  varInt(): number {
    let value = 0
    let multiplier = 1
    let byte: number
    do {
      byte = this.u8() & 0xff
      value += (byte & 0x7f) * multiplier
      multiplier *= 128
    } while ((byte & 0x80) !== 0)
    return value
  }
  utf8String(): string {
    const len = this.u16()
    return this.read(len).toString('utf-8')
  }
}

export function parsePacket(data: Buffer): MqttMessage | null {
  if (data.length === 0) return null
  const buf = new ByteReader(data)
  const typeByte = buf.u8() & 0xf0
  buf.varInt() // 剩余长度

  switch (typeByte) {
    case CONNACK:
      return parseConnack(buf)
    case SUBACK:
      return { type: SUBACK, userProperties: {} }
    case PUBLISH:
      return parsePublish(buf)
    default:
      return { type: typeByte, userProperties: {} }
  }
}

function parseConnack(buf: ByteReader): MqttMessage {
  buf.u8() // Acknowledge Flags
  const reasonCode = buf.u8() & 0xff

  if (buf.remaining <= 0) return { type: CONNACK, userProperties: {} }

  const propsLen = buf.varInt()
  const propsEnd = buf.position + propsLen
  let serverRef: string | undefined

  while (buf.position < propsEnd && buf.hasRemaining()) {
    const id = buf.u8()
    if (id === SERVER_REFERENCE) serverRef = buf.utf8String()
    else if (id === REASON_STRING) buf.utf8String()
    else if (id === USER_PROPERTY) {
      buf.utf8String()
      buf.utf8String()
    } else break
  }

  if (reasonCode === 0x9d && serverRef != null) {
    return { type: CONNACK, serverReference: serverRef, userProperties: {} }
  }
  return { type: CONNACK, userProperties: {} }
}

function parsePublish(buf: ByteReader): MqttMessage {
  buf.utf8String() // topic
  const propsLen = buf.varInt()
  const propsEnd = buf.position + propsLen
  const userProps: Record<string, string> = {}

  while (buf.position < propsEnd && buf.hasRemaining()) {
    const id = buf.u8()
    if (id === USER_PROPERTY) {
      const key = buf.utf8String()
      const value = buf.utf8String()
      userProps[key] = value
    } else break
  }
  const payload = buf.read(buf.remaining)
  return { type: PUBLISH, userProperties: userProps, payload }
}
