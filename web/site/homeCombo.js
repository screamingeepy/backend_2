// a fairy beside the play button
;(function () {
  const DEFAULTS = {
    1: '/site/img/default/defaultFairyFull.png',
    2: '/site/img/default/defaultSparrowManFull.png'
  }

  async function init () {
    const img = document.querySelector('.comboHeroFairy')
    if (!img) return

    const prev = document.querySelector('.comboFairyPrev')
    const next = document.querySelector('.comboFairyNext')

    const me = await window.site.loadMe()
    const fairies = me && me.fairies && me.fairies.length ? me.fairies : []

    const slides = fairies.length
      ? fairies.map(f => ({ src: '/fairies-render/render/' + f.id + '/full?scale=2', alt: f.name, gender: f.gender }))
      : [{ src: DEFAULTS[1], alt: 'Fairy', gender: 1 }]

    let index = Math.max(0, fairies.findIndex(f => f.name === me.fairyName))

    function show () {
      const slide = slides[index]
      img.onerror = () => {
        img.onerror = null
        img.src = DEFAULTS[slide.gender === 2 ? 2 : 1]
      }
      img.src = slide.src
      img.alt = slide.alt
      img.hidden = false
    }

    function step (by) {
      index = (index + by + slides.length) % slides.length
      show()
    }

    if (slides.length > 1 && prev && next) {
      prev.hidden = false
      next.hidden = false
      prev.addEventListener('click', () => step(-1))
      next.addEventListener('click', () => step(1))
    }

    show()
  }

  init()
})()
