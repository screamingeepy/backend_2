const fs = require('fs')
const path = require('path')
const { XMLParser } = require('fast-xml-parser')

// global lookup maps populated once at boot
const itemMap = new Map()   // itemId (number) -> { name: string, gender: number }
const colorMap = new Map()  // colorId (number) -> colorName: string

function initItemNames() {
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

    // 1. Load avatarAssets.xml (item names & gender)
    const avatarXmlPath = path.join(__dirname, '../../web/xml/avatarAssets.xml')
    if (fs.existsSync(avatarXmlPath)) {
      const xmlData = fs.readFileSync(avatarXmlPath, 'utf-8')
      const parsed = parser.parse(xmlData)
      const root = parsed.avatarAssets || {}

      for (const [key, val] of Object.entries(root)) {
        if (key.startsWith('item')) {
          const itemIdStr = key.replace('item', '')
          const itemId = parseInt(itemIdStr, 10)
          if (!isNaN(itemId)) {
            const name = typeof val === 'object' ? (val['#text'] || '') : String(val || '')
            const gender = typeof val === 'object' && val['@_g'] ? parseInt(val['@_g'], 10) : 0
            itemMap.set(itemId, { name: name.trim(), gender })
          }
        }
      }
      console.log(`[itemNames] Loaded ${itemMap.size} item names from avatarAssets.xml`)
    }

    // 2. Load colorAssets.xml (color names)
    const colorXmlPath = path.join(__dirname, '../../web/xml/colorAssets.xml')
    if (fs.existsSync(colorXmlPath)) {
      const xmlData = fs.readFileSync(colorXmlPath, 'utf-8')
      const parsed = parser.parse(xmlData)
      const colorNodes = parsed.colors?.color || []
      const list = Array.isArray(colorNodes) ? colorNodes : [colorNodes]

      for (const c of list) {
        const colorId = parseInt(c['@_color_id'], 10)
        const colorName = c['@_color_name'] || ''
        if (!isNaN(colorId) && colorName) {
          colorMap.set(colorId, colorName.trim())
        }
      }
      console.log(`[itemNames] Loaded ${colorMap.size} color names from colorAssets.xml`)
    }
  } catch (err) {
    console.error('[itemNames] Error initializing item/color maps:', err)
  }
}

function getItemInfo(itemId) {
  return itemMap.get(Number(itemId)) || { name: `Item #${itemId}`, gender: 0 }
}

function getColorName(colorId) {
  if (!colorId || Number(colorId) === 0) return ''
  return colorMap.get(Number(colorId)) || ''
}

// call on module import
initItemNames()

module.exports = { getItemInfo, getColorName }
