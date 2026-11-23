;(function () {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const frame = n => n * 1000 / 24

  const FALLBACK_PHRASES = [
    'Pixie Pals', 'Wish Upon a Fairy', 'Impossible To Catch',
    'Where There’s Light, There’s a Fairy', 'Fairies Don’t Glitter - We Glow',
    'Fly by Attitude', 'We’re All About the Glow', 'Small Is the New Big',
    '“Happy Dustings!”', '“Friends are forever!”'
  ]

  const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
  const ease = t => t * t * (3 - 2 * t)
  const between = (t, from, to) => clamp((t - from) / (to - from))

  // sparkles

  // A four-pointed star: two thin crossed diamonds, gold with a bright core.
  function drawStar (ctx, x, y, radius, alpha, spin) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(spin)
    ctx.globalAlpha = alpha

    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
    glow.addColorStop(0, 'rgba(255, 240, 170, 0.9)')
    glow.addColorStop(1, 'rgba(255, 200, 60, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = '#ffd24a'
    ctx.beginPath()
    ctx.moveTo(0, -radius)
    ctx.quadraticCurveTo(radius * 0.12, -radius * 0.12, radius, 0)
    ctx.quadraticCurveTo(radius * 0.12, radius * 0.12, 0, radius)
    ctx.quadraticCurveTo(-radius * 0.12, radius * 0.12, -radius, 0)
    ctx.quadraticCurveTo(-radius * 0.12, -radius * 0.12, 0, -radius)
    ctx.fill()

    ctx.fillStyle = '#fffbe0'
    ctx.beginPath()
    ctx.arc(0, 0, radius * 0.16, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  function makeDust (host, pad) {
    const canvas = document.createElement('canvas')
    canvas.className = 'pdCanvas'
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.cssText = `position:absolute;left:${-pad}px;top:${-pad}px;pointer-events:none;z-index:2`
    host.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    const particles = []
    let width = 0
    let height = 0

    function resize () {
      const rect = host.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      width = rect.width + pad * 2
      height = rect.height + pad * 2
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    return {
      canvas,
      resize,
      pad,

      // n sparkles somewhere inside the box (x0..x1, y0..y1 relative to the host).
      emit (n, x0, x1, y0, y1) {
        for (let i = 0; i < n; i++) {
          particles.push({
            x: pad + x0 + Math.random() * (x1 - x0),
            y: pad + y0 + Math.random() * (y1 - y0),
            vx: (Math.random() - 0.5) * 14,
            vy: 6 + Math.random() * 22,
            life: 0,
            span: 500 + Math.random() * 700,
            r: 2.5 + Math.random() * 4.5,
            spin: Math.random() * Math.PI,
            turn: (Math.random() - 0.5) * 3
          })
        }
      },

      step (dt) {
        ctx.clearRect(0, 0, width, height)

        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i]
          p.life += dt

          if (p.life >= p.span) {
            particles.splice(i, 1)
            continue
          }

          p.x += p.vx * dt / 1000
          p.y += p.vy * dt / 1000
          p.spin += p.turn * dt / 1000

          const age = p.life / p.span
          const twinkle = 0.65 + 0.35 * Math.sin(p.life / 55)
          drawStar(ctx, p.x, p.y, p.r * (1 - age * 0.4), Math.sin(age * Math.PI) * twinkle, p.spin)
        }
      },

      get busy () { return particles.length > 0 }
    }
  }

  // runs `tick(elapsedMs, dtMs)` every animation frame until it returns false.
  function run (tick) {
    let last = performance.now()
    const start = last

    return new Promise(resolve => {
      function loop (now) {
        const keepGoing = tick(now - start, now - last)
        last = now
        if (keepGoing === false) resolve()
        else requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })
  }

  const setWipe = (el, p) => el.style.setProperty('--pdWipe', String(p))

  // the title: writes on once

  async function writeOn (el) {
    if (reduceMotion) {
      el.style.opacity = '1'
      return
    }

    const text = document.createElement('span')
    text.className = 'pdText'
    while (el.firstChild) text.appendChild(el.firstChild)
    el.appendChild(text)

    if (getComputedStyle(el).position === 'static') el.style.position = 'relative'

    setWipe(text, 0)
    el.style.opacity = '1'

    const dust = makeDust(el, 24)
    dust.resize()

    const total = frame(60)

    await run((t, dt) => {
      const p = ease(between(t, frame(6), frame(28)))
      setWipe(text, p * 1.15)

      const box = text.getBoundingClientRect()
      const host = el.getBoundingClientRect()
      const left = box.left - host.left
      const front = left + box.width * p

      if (p > 0 && p < 1) {
        dust.emit(Math.max(1, Math.round(dt / 8)), front - 14, front + 6, box.top - host.top, box.bottom - host.top)
      }

      dust.step(dt)
      return t < total || dust.busy
    })

    text.style.removeProperty('mask-image')
    text.style.removeProperty('-webkit-mask-image')
    text.classList.add('pdDone')
    dust.canvas.remove()
  }

  // the footer line: the whole timeline, on hover

  async function loadPhrases () {
    try {
      const res = await fetch('/franchise/fairies/xml/powered_footer.xml')
      const doc = new DOMParser().parseFromString(await res.text(), 'text/xml')
      const phrases = [...doc.querySelectorAll('phraseslist > phrase')].map(node => node.textContent.trim()).filter(Boolean)
      const item = name => {
        const node = [...doc.querySelectorAll('static > item')].find(n => n.getAttribute('name') === name)
        return node ? node.textContent.trim() : ''
      }

      return {
        phrases: phrases.length ? phrases : FALLBACK_PHRASES,
        powered: item('powered') || 'Powered by Pixie Dust',
        stayTuned: item('staytuned') || 'Stay tuned for more cool stuff'
      }
    } catch (e) {
      return { phrases: FALLBACK_PHRASES, powered: 'Powered by Pixie Dust', stayTuned: 'Stay tuned for more cool stuff' }
    }
  }

  function shuffled (list) {
    const copy = list.slice()

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }

    return copy
  }

  async function makePowered (footer) {
    const words = await loadPhrases()

    const box = document.createElement('div')
    box.className = 'pixiePowered'
    box.tabIndex = 0
    box.setAttribute('aria-label', words.powered)

    const line = (text, role) => {
      const el = document.createElement('span')
      el.className = 'pdLine ' + role
      el.setAttribute('aria-hidden', 'true')
      el.textContent = text
      box.appendChild(el)
      return el
    }

    const powered = line(words.powered, 'pdPowered')
    const phrase = line('', 'pdPhrase')
    const stayTuned = line(words.stayTuned, 'pdTuned')

    footer.insertBefore(box, footer.firstChild)

    const dust = makeDust(box, 24)
    dust.resize()
    window.addEventListener('resize', dust.resize)

    if (reduceMotion) {
      phrase.hidden = true
      stayTuned.hidden = true
      return
    }

    phrase.style.opacity = '0'
    stayTuned.style.opacity = '0'

    let order = shuffled(words.phrases)
    let index = 0
    let playing = false

    const spanOf = el => {
      const b = el.getBoundingClientRect()
      const h = box.getBoundingClientRect()
      return { x0: b.left - h.left, x1: b.right - h.left, y0: b.top - h.top, y1: b.bottom - h.top }
    }

    // one sparkle now and then while idle, the single spark on the original's first frame.
    let idleAt = performance.now() + 2500
    let lastIdle = performance.now()

    function idle (now) {
      if (!playing) {
        dust.step(now - lastIdle)

        if (now > idleAt) {
          const s = spanOf(powered)
          dust.emit(1, s.x0, s.x1, s.y0, s.y1)
          idleAt = now + 2500 + Math.random() * 3500
        }
      }

      lastIdle = now
      requestAnimationFrame(idle)
    }
    requestAnimationFrame(idle)

    async function play () {
      if (playing) return
      playing = true

      phrase.textContent = order[index]
      index = (index + 1) % order.length
      if (index === 0) order = shuffled(words.phrases)

      const showPhrase = { from: frame(6), to: frame(28) }
      const hold = frame(70)
      const burst = frame(85)
      const away = frame(104)
      const tunedIn = frame(120)
      const tunedHold = frame(170)
      const tunedOut = frame(190)
      const end = frame(213)

      let lastBurst = 0

      await run((t, dt) => {
        // powered by Pixie Dust steps aside for the phrase, and comes back at the end.
        powered.style.opacity = String(t < frame(6) ? 1 - between(t, 0, frame(6)) : between(t, tunedOut, end))

        // the phrase writes on with dust at the front...
        const p = ease(between(t, showPhrase.from, showPhrase.to))
        setWipe(phrase, p * 1.15)
        const fadeOut = between(t, hold, away)
        phrase.style.opacity = t < showPhrase.from ? '0' : String(1 - fadeOut)
        phrase.style.filter = fadeOut ? `blur(${fadeOut * 7}px)` : 'none'

        const s = spanOf(phrase)

        if (p > 0 && p < 1) {
          dust.emit(Math.max(1, Math.round(dt / 8)), s.x0 + (s.x1 - s.x0) * p - 14, s.x0 + (s.x1 - s.x0) * p + 6, s.y0, s.y1)
        }

        // ...sparkles across it again before it goes...
        if (t > hold && t < burst && t - lastBurst > 30) {
          dust.emit(4, s.x0, s.x1, s.y0, s.y1)
          lastBurst = t
        }

        // ...and it blurs away into "Stay tuned".
        const tunedShow = between(t, away, tunedIn)
        const tunedHide = between(t, tunedHold, tunedOut)
        stayTuned.style.opacity = String(tunedShow * (1 - tunedHide))
        stayTuned.style.filter = `blur(${((1 - tunedShow) + tunedHide) * 7}px)`

        dust.step(dt)
        return t < end || dust.busy
      })

      phrase.style.opacity = '0'
      stayTuned.style.opacity = '0'
      powered.style.opacity = '1'
      playing = false
    }

    for (const type of ['mouseenter', 'focus', 'touchstart']) box.addEventListener(type, play, { passive: true })
  }

  function start () {
    for (const el of document.querySelectorAll('[data-pixie-write]')) writeOn(el)
    for (const footer of document.querySelectorAll('.siteFooter')) makePowered(footer)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
