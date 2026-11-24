/**
 * @file public/js/cocina.js
 * @description Controlador Frontend (ES6+) para el Monitor Mural de Produccion (Cocina).
 * Opera en estricto modo Solo Lectura, renderiza barras horizontales dinamicas en CSS3
 * puro, proyecta gramos diarios de espesante para Liquidos Nivel 2 (Poco Espeso),
 * despliega la matriz de despacho por Sala/Cama y escucha el canal WebSocket Socket.IO
 * ('actualizacion_minuta') para reflejar cambios clinicos en < 2.0 segundos con destello visual.
 */

(function initMonitorCocina() {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. VALIDACION DE TOKEN JWT Y CONFIGURACION DE ROL DE SOLO LECTURA
  // ---------------------------------------------------------------------------
  const token =
    sessionStorage.getItem('capredena_jwt') || localStorage.getItem('capredena_jwt');
  const rawUser =
    sessionStorage.getItem('capredena_user') || localStorage.getItem('capredena_user');

  if (!token || !rawUser) {
    window.location.replace('/login.html');
    return;
  }

  let currentUser;
  try {
    currentUser = JSON.parse(rawUser);
  } catch (_err) {
    window.location.replace('/login.html');
    return;
  }

  // Decodifica entidades HTML escapadas en backend de forma pura (sin innerHTML)
  // para garantizar renderizado inerte via textContent ante vectores XSS (CP10).
  function decodeHtmlEntities(str) {
    if (!str) return '';
    return String(str)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  // Si un Nutricionista Clinico supervisa el monitor, habilita enlace de retorno seguro
  if (currentUser.rol === 'CLINICO') {
    document.getElementById('link-volver-clinico').classList.remove('u-hidden');
    document.getElementById('role-badge-cocina').textContent =
      'Supervisión Clínica (Vista Monitor Cocina)';
  }

  document.getElementById('cocina-user-info').textContent =
    `${decodeHtmlEntities(currentUser.nombre_completo)} • Modo Estricto Solo Lectura`;

  function cerrarSesion() {
    sessionStorage.removeItem('capredena_jwt');
    sessionStorage.removeItem('capredena_user');
    localStorage.removeItem('capredena_jwt');
    localStorage.removeItem('capredena_user');
    window.location.replace('/login.html');
  }

  document.getElementById('btn-logout-cocina').addEventListener('click', cerrarSesion);

  // ---------------------------------------------------------------------------
  // 2. RELOJ INSTITUCIONAL EN TIEMPO REAL
  // ---------------------------------------------------------------------------
  const clockEl = document.getElementById('live-clock');
  function actualizarReloj() {
    const ahora = new Date();
    clockEl.textContent = ahora.toLocaleTimeString('es-CL', { hour12: false });
  }
  actualizarReloj();
  setInterval(actualizarReloj, 1000);

  // Estado local del monitor de cocina
  const state = {
    mapaSalas: [],
    salaActiva: 1,
    ultimoIdHistorialDestacado: null
  };

  // Notificacion flotante de alerta temprana para personal de cocina
  const toastEl = document.getElementById('toast-cocina');
  let toastTimeout = null;
  function mostrarAvisoMural(mensaje, variante = 'violet') {
    if (toastTimeout) clearTimeout(toastTimeout);
    toastEl.textContent = mensaje;
    toastEl.className =
      variante === 'danger'
        ? 'toast toast--error'
        : variante === 'success'
        ? 'toast toast--success'
        : 'toast';
    toastTimeout = setTimeout(() => {
      toastEl.className = 'toast u-hidden';
    }, 5500);
  }

  // ---------------------------------------------------------------------------
  // 3. CONMUTACION ENTRE BARRAS BIG DATA Y MAPA POR SALA / CAMA
  // ---------------------------------------------------------------------------
  const tabBarras = document.getElementById('cocina-tab-barras');
  const tabMapa = document.getElementById('cocina-tab-mapa');
  const subviewBarras = document.getElementById('subview-barras');
  const subviewMapa = document.getElementById('subview-mapa');

  tabBarras.addEventListener('click', () => {
    subviewBarras.classList.remove('u-hidden');
    subviewMapa.classList.add('u-hidden');
    tabBarras.classList.add('tabs__btn--active');
    tabMapa.classList.remove('tabs__btn--active');
  });

  tabMapa.addEventListener('click', () => {
    subviewBarras.classList.add('u-hidden');
    subviewMapa.classList.remove('u-hidden');
    tabMapa.classList.add('tabs__btn--active');
    tabBarras.classList.remove('tabs__btn--active');
    renderMapaSalaActiva();
  });

  document.getElementById('sala-selector-buttons').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-sala]');
    if (!btn) return;
    state.salaActiva = Number(btn.getAttribute('data-sala'));
    document
      .querySelectorAll('#sala-selector-buttons button')
      .forEach((b) => b.classList.toggle('tabs__btn--active', b === btn));
    renderMapaSalaActiva();
  });

  // ---------------------------------------------------------------------------
  // 4. RENDERIZADO DE KPIS, BARRAS CSS3 PURO, MAPA DE SALAS Y ALERTAS 24H
  // ---------------------------------------------------------------------------

  /**
   * Construye barras horizontales dinamicas en CSS3 puro sin librerias externas.
   * @param {HTMLElement} container Nodo contenedor.
   * @param {Array<Object>} items Serie agregada SQL con cantidad y porcentaje.
   * @param {Function} labelFn Formateador del titulo de cada barra.
   * @param {boolean} [isSuccess=false] Usa variante verde en lugar de violeta.
   */
  function renderBarrasCss(container, items, labelFn, isSuccess = false) {
    container.innerHTML = '';
    const frag = document.createDocumentFragment();

    items.forEach((item) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'bar-item';

      const head = document.createElement('div');
      head.className = 'bar-item__head';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = labelFn(item);

      const statsSpan = document.createElement('span');
      statsSpan.className = 'bar-item__stats';
      statsSpan.textContent = `${item.cantidad} bandejas (${item.porcentaje}%)`;

      head.appendChild(nameSpan);
      head.appendChild(statsSpan);

      const track = document.createElement('div');
      track.className = 'bar-item__track';

      const fill = document.createElement('div');
      fill.className = isSuccess
        ? 'bar-item__fill bar-item__fill--success'
        : 'bar-item__fill';
      fill.style.width = `${Math.min(100, Math.max(0, item.porcentaje))}%`;

      track.appendChild(fill);
      wrapper.appendChild(head);
      wrapper.appendChild(track);
      frag.appendChild(wrapper);
    });

    container.appendChild(frag);
  }

  /**
   * Renderiza la cuadricula fisica de 20 camas correspondiente a la Sala seleccionada
   * (Salas 1 a 4), destacando con borde violeta de alto contraste aquellas camas que
   * requieren preparacion especial por disfagia (IDDSI Solido < 7 o Liquido > 0).
   */
  function renderMapaSalaActiva() {
    const container = document.getElementById('room-beds-container');
    const resumenEl = document.getElementById('mapa-sala-resumen');
    container.innerHTML = '';

    const infoSala = state.mapaSalas.find((s) => s.numero_sala === state.salaActiva);
    if (!infoSala) return;

    resumenEl.textContent =
      `Sala ${infoSala.numero_sala}: ${infoSala.camas_ocupadas} bandejas activas • ${infoSala.camas_libres} camas libres`;

    const frag = document.createDocumentFragment();
    infoSala.camas.forEach((c) => {
      const card = document.createElement('article');
      // Cama disponible sin paciente hospitalizado activo
      if (!c.ocupada) {
        card.className = 'bed-card bed-card--free';
        const head = document.createElement('div');
        head.className = 'bed-card__head';
        head.textContent = `Cama ${c.numero_cama}`;
        const libre = document.createElement('div');
        libre.className = 'panel__subtitle';
        libre.textContent = 'Cama libre — Sin bandeja';
        card.appendChild(head);
        card.appendChild(libre);
      } else {
        card.className = c.requiere_alerta_disfagia
          ? 'bed-card bed-card--dysphagia'
          : 'bed-card';

        const head = document.createElement('div');
        head.className = 'bed-card__head';
        const spanCama = document.createElement('span');
        spanCama.textContent = `Cama ${c.numero_cama}`;
        const spanFicha = document.createElement('span');
        spanFicha.textContent = decodeHtmlEntities(c.codigo_ficha);
        head.appendChild(spanCama);
        head.appendChild(spanFicha);

        const regDiv = document.createElement('div');
        regDiv.style.fontWeight = '600';
        regDiv.textContent = c.nombre_regimen;

        const solDiv = document.createElement('div');
        solDiv.textContent = `Sólido: IDDSI ${c.nivel_iddsi_solido} (${c.nombre_iddsi_solido})`;

        const liqDiv = document.createElement('div');
        liqDiv.textContent = `Líquido: IDDSI ${c.nivel_iddsi_liquido} (${c.nombre_iddsi_liquido})`;

        card.appendChild(head);
        card.appendChild(regDiv);
        card.appendChild(solDiv);
        card.appendChild(liqDiv);

        // Despliega observaciones clinicas / alergias exclusivamente via textContent (anti-XSS)
        if (c.observacion_alergias) {
          const obsDiv = document.createElement('div');
          obsDiv.className = 'panel__subtitle';
          obsDiv.textContent = decodeHtmlEntities(c.observacion_alergias);
          card.appendChild(obsDiv);
        }
      }
      frag.appendChild(card);
    });

    container.appendChild(frag);
  }

  /**
   * Renderiza el panel derecho de Alertas Clinicas Tempranas de las ultimas 24 horas
   * aplicando codificacion cromatica normativa:
   *  - Verde (--success): Nuevos ingresos hospitalarios
   *  - Violeta (--violet-primary): Modificaciones de regimen o textura IDDSI
   *  - Rojo (--danger): Altas clinicas confirmadas ("Suspender preparacion de bandeja")
   * @param {Array<Object>} alertas Lista cronologica de eventos < 24h.
   * @param {number|null} [highlightId=null] Identificador recien emitido por Socket.IO para destello.
   */
  function renderAlertas24h(alertas, highlightId = null) {
    const feed = document.getElementById('alerts-feed');
    feed.innerHTML = '';

    if (!alertas || alertas.length === 0) {
      const p = document.createElement('p');
      p.className = 'panel__subtitle';
      p.textContent = 'Sin novedades registradas en las últimas 24 horas.';
      feed.appendChild(p);
      return;
    }

    const frag = document.createDocumentFragment();
    alertas.forEach((alerta) => {
      const article = document.createElement('article');
      const modifier =
        alerta.tipo_movimiento === 'INGRESO'
          ? 'alert-card--ingreso'
          : alerta.tipo_movimiento === 'ALTA'
          ? 'alert-card--alta'
          : 'alert-card--modificacion';

      const flashClass =
        highlightId && alerta.id_historial === highlightId ? ' alert-card--flash' : '';
      article.className = `alert-card ${modifier}${flashClass}`;

      const top = document.createElement('div');
      top.className = 'alert-card__top';

      const title = document.createElement('div');
      title.className = 'alert-card__title';
      const prefijoAccion =
        alerta.tipo_movimiento === 'ALTA'
          ? 'ALTA CLÍNICA (SUSPENDER BANDEJA)'
          : alerta.tipo_movimiento === 'INGRESO'
          ? 'NUEVO INGRESO HOSPITALARIO'
          : 'CAMBIO DE MINUTA / IDDSI';
      title.textContent =
        `${prefijoAccion} • ${decodeHtmlEntities(alerta.codigo_ficha)} (Sala ${alerta.numero_sala}, Cama ${alerta.numero_cama})`;

      const time = document.createElement('span');
      time.className = 'alert-card__time';
      time.textContent = `${alerta.fecha_hora_registro} UTC`;

      top.appendChild(title);
      top.appendChild(time);

      const detail = document.createElement('p');
      detail.className = 'alert-card__detail';
      detail.textContent = decodeHtmlEntities(alerta.detalle_clinico || '');

      const tagsWrap = document.createElement('div');
      tagsWrap.style.display = 'flex';
      tagsWrap.style.gap = '0.4rem';
      tagsWrap.style.flexWrap = 'wrap';

      const tReg = document.createElement('span');
      tReg.className = 'tag';
      tReg.textContent = alerta.nombre_regimen;

      const tSol = document.createElement('span');
      tSol.className = 'tag tag--violet';
      tSol.textContent = `Sólido IDDSI ${alerta.nivel_iddsi_solido}: ${alerta.nombre_iddsi_solido}`;

      const tLiq = document.createElement('span');
      tLiq.className = 'tag tag--violet';
      tLiq.textContent = `Líquido IDDSI ${alerta.nivel_iddsi_liquido}: ${alerta.nombre_iddsi_liquido}`;

      tagsWrap.appendChild(tReg);
      tagsWrap.appendChild(tSol);
      tagsWrap.appendChild(tLiq);

      article.appendChild(top);
      article.appendChild(detail);
      article.appendChild(tagsWrap);
      frag.appendChild(article);
    });

    feed.appendChild(frag);
  }

  /**
   * Actualiza de forma integral todos los componentes del Monitor Mural de Cocina.
   * @param {Object} data Respuesta consolidada de /api/cocina/dashboard o Socket.IO.
   * @param {number|null} [highlightHistorialId=null] ID de nueva alerta para destello.
   */
  function pintarDashboardCompleto(data, highlightHistorialId = null) {
    const kpis = data.kpis;

    document.getElementById('kpi-bandejas').textContent = String(
      kpis.total_bandejas_activas
    );
    document.getElementById('kpi-disfagia').textContent =
      `${kpis.pacientes_disfagia} (${kpis.porcentaje_disfagia}%)`;
    document.getElementById('kpi-poco-espeso').textContent =
      `${kpis.raciones_liquido_poco_espeso} pac.`;
    document.getElementById('kpi-espesante-gramos').textContent =
      `Espesante hoy: ${kpis.gramos_espesante_diario} g (${kpis.gramos_espesante_por_racion}g × ${kpis.servicios_diarios} serv.)`;
    document.getElementById('kpi-novedades-24h').textContent = String(kpis.novedades_24h);
    document.getElementById('kpi-ultima-sinc').textContent =
      `Sincronizado: ${new Date().toLocaleTimeString('es-CL', { hour12: false })}`;

    renderBarrasCss(
      document.getElementById('bars-regimenes'),
      data.series.por_regimen,
      (r) => r.nombre_regimen
    );

    renderBarrasCss(
      document.getElementById('bars-iddsi-solido'),
      data.series.por_iddsi_solido,
      (c) => `IDDSI ${c.nivel_iddsi} — ${c.nombre_oficial}`
    );

    renderBarrasCss(
      document.getElementById('bars-iddsi-liquido'),
      data.series.por_iddsi_liquido,
      (c) => `IDDSI ${c.nivel_iddsi} — ${c.nombre_oficial}`,
      true
    );

    state.mapaSalas = data.mapa_salas || [];
    renderMapaSalaActiva();
    renderAlertas24h(data.alertas_24h || [], highlightHistorialId);
  }

  /**
   * Realiza la carga HTTP inicial del consolidado operativo de cocina al abrir la pantalla.
   * Las actualizaciones posteriores llegan en tiempo real mediante eventos WebSockets.
   */
  async function cargarDashboardInicial() {
    try {
      const response = await fetch('/api/cocina/dashboard', {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Si el token JWT expiro o fue revocado, redirige limpiamente al portal de acceso
      if (response.status === 401) {
        cerrarSesion();
        return;
      }

      const data = await response.json();
      if (response.ok && data.ok) {
        pintarDashboardCompleto(data, null);
      }
    } catch (_err) {
      mostrarAvisoMural('Reintentando conexión con servidor central...', 'danger');
    }
  }

  // ---------------------------------------------------------------------------
  // 5. CONEXION WEBSOCKETS DE BAJA LATENCIA (< 2.0s) CON SOCKET.IO
  // ---------------------------------------------------------------------------
  // Establece sesion persistente full-duplex enviando el JWT en el handshake de autenticacion
  const wsPill = document.getElementById('ws-status-pill');
  const wsText = document.getElementById('ws-status-text');

  if (typeof window.io === 'function') {
    const socket = window.io({
      auth: { token }
    });

    socket.on('connect', () => {
      wsPill.classList.remove('topbar__live--offline');
      wsText.textContent = 'EN VIVO (WebSockets)';
    });

    socket.on('disconnect', () => {
      wsPill.classList.add('topbar__live--offline');
      wsText.textContent = 'RECONECTANDO...';
    });

    socket.on('actualizacion_minuta', (payload) => {
      const ev = payload && payload.evento ? payload.evento : null;
      const idNuevo = ev ? ev.id_historial : null;

      if (payload && payload.dashboard) {
        pintarDashboardCompleto(payload.dashboard, idNuevo);
      } else {
        cargarDashboardInicial();
      }

      if (ev) {
        const tipoMsg =
          ev.tipo_movimiento === 'ALTA'
            ? `ALERTA ROJA: Alta confirmada ${decodeHtmlEntities(ev.codigo_ficha)} (Sala ${ev.numero_sala} Cama ${ev.numero_cama}). Suspender bandeja.`
            : ev.tipo_movimiento === 'INGRESO'
            ? `NUEVO INGRESO: ${decodeHtmlEntities(ev.codigo_ficha)} en Sala ${ev.numero_sala} Cama ${ev.numero_cama}.`
            : `CAMBIO IDDSI/MINUTA: ${decodeHtmlEntities(ev.codigo_ficha)} (Sala ${ev.numero_sala} Cama ${ev.numero_cama}).`;

        const variante =
          ev.tipo_movimiento === 'ALTA'
            ? 'danger'
            : ev.tipo_movimiento === 'INGRESO'
            ? 'success'
            : 'violet';

        mostrarAvisoMural(tipoMsg, variante);
      }
    });
  }

  cargarDashboardInicial();
})();
