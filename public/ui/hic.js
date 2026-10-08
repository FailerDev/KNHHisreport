/* HIC shell behaviour: theme toggle, dropdown menus, mobile drawer. */
(function () {
  var root = document.documentElement

  function storeTheme(value) {
    try { localStorage.setItem('hic-theme', value) } catch (e) {}
  }

  function syncThemeIcons() {
    var dark = root.classList.contains('dark')
    document.querySelectorAll('[data-theme-icon]').forEach(function (el) {
      el.className = dark ? 'fas fa-sun' : 'fas fa-moon'
    })
  }

  document.addEventListener('click', function (e) {
    var themeBtn = e.target.closest('[data-theme-toggle]')
    if (themeBtn) {
      var dark = !root.classList.contains('dark')
      root.classList.toggle('dark', dark)
      storeTheme(dark ? 'dark' : 'light')
      syncThemeIcons()
      document.dispatchEvent(new CustomEvent('hic:theme', { detail: { dark: dark } }))
      return
    }

    var menuBtn = e.target.closest('[data-menu-toggle]')
    var openMenus = document.querySelectorAll('.hic-menu.open')
    if (menuBtn) {
      var menu = menuBtn.closest('.hic-menu')
      var willOpen = !menu.classList.contains('open')
      openMenus.forEach(function (m) { closeMenu(m) })
      if (willOpen) {
        menu.classList.add('open')
        menuBtn.setAttribute('aria-expanded', 'true')
      }
      return
    }
    openMenus.forEach(function (m) { if (!m.contains(e.target)) closeMenu(m) })

    var drawerBtn = e.target.closest('[data-drawer-toggle]')
    var drawer = document.getElementById('hicDrawer')
    if (drawerBtn && drawer) {
      var open = drawer.classList.toggle('open')
      drawerBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
      var icon = drawerBtn.querySelector('i')
      if (icon) icon.className = open ? 'fas fa-xmark' : 'fas fa-bars'
    }
  })

  function closeMenu(menu) {
    menu.classList.remove('open')
    var btn = menu.querySelector('[data-menu-toggle]')
    if (btn) btn.setAttribute('aria-expanded', 'false')
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.hic-menu.open').forEach(closeMenu)
      var drawer = document.getElementById('hicDrawer')
      if (drawer) drawer.classList.remove('open')
    }
  })

  syncThemeIcons()

  /* Thai date for elements marked data-today */
  document.querySelectorAll('[data-today]').forEach(function (el) {
    try {
      el.textContent = new Date().toLocaleDateString('th-TH', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    } catch (e) {}
  })

  /* Greeting by time of day for elements marked data-greet */
  document.querySelectorAll('[data-greet]').forEach(function (el) {
    var h = new Date().getHours()
    el.textContent = h < 12 ? 'สวัสดีตอนเช้า' : h < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น'
  })
})()
