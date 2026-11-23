// ---------------------------------------------------------------------------
// Build aliased copies of swf/fonts.swf
//
//   node render/src/aliasFonts.js
//
// WHY
//
// fonts.swf defines four fonts, each exported to a class:
//
//   DefineFont3 "Arial 4FRTL"                     -> class SharedFont2
//   DefineFont3 "pixie_font.v01d"                 -> class SharedFont3
//   DefineFont3 "Pristina-4FRTL"                  -> class SharedFont0
//   DefineFont3 "HelveticaRounded LT Bold 4FRTL"  -> class SharedFont1
//
// FontManager does `new SharedFontN()` and builds a TextFormat from the Font
// object's `fontName`. Under Ruffle that comes back as the *class* name, so
// every TextField ends up asking for a font literally called "SharedFont0",
// with embedFonts = true. Nothing by that name exists, so the text falls back
// to a default face with the wrong metrics -- which is why labels look like
// Arial and names lose their last letter to a field sized for the real font.
//
// Ruffle's `fontSources` adds a SWF's fonts as device fonts, matched by the
// name in the DefineFont3 tag. So this rewrites those names to the ones the
// client actually asks for, and the page lists the results in fontSources
// alongside the original.
//
// Nothing here touches fonts.swf itself: the glyphs, layout and kerning are
// copied through untouched and only the name field changes.
// ---------------------------------------------------------------------------

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const SWF_DIR = path.join(__dirname, '..', '..', 'web', 'swf')
const SOURCE = path.join(SWF_DIR, 'fonts.swf')

const DEFINE_FONT3 = 75

// fontId -> the name to write, per output file.
const OUTPUTS = [
  {
    file: 'fonts-sharedname.swf',
    // What FontManager ends up asking for under Ruffle: the class names.
    names: { 1: 'SharedFont2', 2: 'SharedFont3', 3: 'SharedFont0', 4: 'SharedFont1' }
  },
  {
    file: 'fonts-unmangled.swf',
    // The DefineFontName values, which the authored TextFields use. The 4FRTL
    // suffix was the original build's mangling.
    names: { 1: 'Arial', 2: 'pixie_font', 3: 'Pristina', 4: 'HelveticaRounded LT Bold' }
  },
  {
    file: 'fonts-variants.swf',
    // Further spellings seen in Ruffle's "Unknown device font" warnings. The
    // client is not consistent about which form it asks for, and a name that
    // does not resolve costs the wrong metrics -- so every observed spelling
    // gets an entry rather than being argued with.
    names: { 1: 'Arial Bold', 2: 'pixie_font.v01', 3: 'Pristina Regular', 4: 'HelveticaRounded Bold' }
  }
]

function readSwf (file) {
  const raw = fs.readFileSync(file)
  const signature = raw.toString('ascii', 0, 3)
  const version = raw[3]

  if (signature === 'FWS') return { version, body: raw.slice(8), compressed: false }
  if (signature === 'CWS') return { version, body: zlib.inflateSync(raw.slice(8)), compressed: true }

  throw new Error(`${path.basename(file)} is not a SWF (signature ${signature})`)
}

function writeSwf (file, version, body) {
  // fileLength counts the 8-byte header plus the uncompressed body.
  const header = Buffer.alloc(8)
  header.write('CWS', 0, 'ascii')
  header[3] = version
  header.writeUInt32LE(8 + body.length, 4)

  fs.writeFileSync(file, Buffer.concat([header, zlib.deflateSync(body, { level: 9 })]))
}

/** Skip the RECT that opens the body, so tag walking starts in the right place. */
function afterHeader (body) {
  const bits = body[0] >> 3           // nbits for each of the four fields
  const totalBits = 5 + bits * 4
  const rectBytes = Math.ceil(totalBits / 8)

  return rectBytes + 2 + 2            // + frameRate (UI16) + frameCount (UI16)
}

/**
 * Rewrite the font name of every DefineFont3 whose id is in `names`.
 *
 * The name is length-prefixed *and* null-terminated, and the prefix counts the
 * terminator. Replacement names are rarely the same length as the originals, so
 * the tag's own length has to be rewritten too -- which is why this rebuilds the
 * body rather than patching it in place.
 */
function alias (body, names) {
  const out = []
  let offset = afterHeader(body)

  out.push(body.slice(0, offset))

  while (offset < body.length) {
    const codeAndLength = body.readUInt16LE(offset)
    const code = codeAndLength >> 6
    let length = codeAndLength & 0x3f
    let headerSize = 2

    if (length === 0x3f) {
      length = body.readUInt32LE(offset + 2)
      headerSize = 6
    }

    const bodyStart = offset + headerSize
    const tagBody = body.slice(bodyStart, bodyStart + length)

    if (code === DEFINE_FONT3) {
      const fontId = tagBody.readUInt16LE(0)
      const replacement = names[fontId]

      if (replacement) {
        // UI16 id, UI8 flags, UI8 language, UI8 nameLen, then the name.
        const nameLen = tagBody[4]
        const rest = tagBody.slice(5 + nameLen)

        const name = Buffer.from(replacement + '\0', 'ascii')
        const head = Buffer.from(tagBody.slice(0, 5))
        head[4] = name.length

        const rebuilt = Buffer.concat([head, name, rest])
        out.push(tagHeader(code, rebuilt.length), rebuilt)

        offset = bodyStart + length
        continue
      }
    }

    out.push(body.slice(offset, bodyStart + length))
    offset = bodyStart + length
  }

  return Buffer.concat(out)
}

function tagHeader (code, length) {
  // Always the long form: these tags are far past the 62-byte short limit, and
  // a uniform header keeps the arithmetic honest.
  const header = Buffer.alloc(6)
  header.writeUInt16LE((code << 6) | 0x3f, 0)
  header.writeUInt32LE(length, 2)
  return header
}

const source = readSwf(SOURCE)
console.log(`read ${path.basename(SOURCE)} (v${source.version}, ${source.body.length} bytes uncompressed)`)

for (const target of OUTPUTS) {
  const body = alias(source.body, target.names)
  const file = path.join(SWF_DIR, target.file)

  writeSwf(file, source.version, body)

  const renamed = Object.values(target.names).join(', ')
  console.log(`wrote ${target.file} (${fs.statSync(file).size} bytes) -> ${renamed}`)
}
