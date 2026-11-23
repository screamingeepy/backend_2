const crypto = require('crypto')

const hourMs = 60 * 60 * 1000
const dayMs = 24 * hourMs

function makeLimiter (max, windowMs) {
  const hits = new Map()

  function recent (key) {
    const cutoff = Date.now() - windowMs
    const times = (hits.get(key) || []).filter(time => time > cutoff)
    if (times.length) hits.set(key, times)
    else hits.delete(key)
    return times
  }

  setInterval(() => {
    for (const key of [...hits.keys()]) recent(key)
  }, Math.min(windowMs, hourMs)).unref()

  return {
    hasRoom: key => recent(key).length < max,
    record (key) {
      const times = recent(key)
      times.push(Date.now())
      hits.set(key, times)
    }
  }
}

function allowAll (checks) {
  if (!checks.every(([limiter, key]) => limiter.hasRoom(key))) return false
  checks.forEach(([limiter, key]) => limiter.record(key))
  return true
}

function makeRepeatGuard (windowMs) {
  const seen = new Map()

  function clean () {
    const cutoff = Date.now() - windowMs
    for (const [key, time] of seen) {
      if (time <= cutoff) seen.delete(key)
    }
  }

  setInterval(clean, Math.min(windowMs, hourMs)).unref()

  return function isRepeat (actor, text) {
    clean()
    const words = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const key = actor + ':' + crypto.createHash('sha1').update(words).digest('hex')
    if (seen.has(key)) return true
    seen.set(key, Date.now())
    return false
  }
}

module.exports = { makeLimiter, allowAll, makeRepeatGuard, hourMs, dayMs }
