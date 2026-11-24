/**
 * @file public/js/clinico.js
 * @description Controlador Frontend (ES6+) del Modulo Clinico (Perfil Nutricionista).
 * Implementa:
 *  - Verificacion RBAC en cliente: redirige inmediatamente a /cocina.html si el rol es PRODUCCION.
 *  - Temporizador de cierre automatico de sesion tras 15 min de inactividad (RF10) con aviso previo.
 *  - Buscador reactivo en tiempo real sobre el censo activo (~70 pacientes).
 *  - Ejecucion de las 3 operaciones CRUD transaccionales en un maximo estricto de 3 clics.
 *  - Explorador filtrable y paginado del repositorio Big Data Historial_Minutas.
 */

(function initModuloClinico() {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. VERIFICACION DE SESION JWT Y GUARDIA RBAC ESTRICTO
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
  } catch (_e) {
    window.location.replace('/login.html');
    return;
  }

  // Regla de seguridad de interfaz: Cocina JAMAS puede permanecer en /clinico.html
  if (currentUser.rol !== 'CLINICO') {
    window.location.replace('/cocina.html');
    return;
  }

  // Decodifica entidades HTML escapadas en backend de forma pura (sin innerHTML)
  // para renderizar texto literal seguro exclusivamente mediante textContent (CP10 Anti-XSS).
  function decodeHtmlEntities(str) {
    if (!str) return '';
    return String(str)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  // Estado reactivo local del modulo clinico
  const state = {
    pacientes: [],
    camasLibresPorSala: { 1: [], 2: [], 3: [], 4: [] },
    codigoSugerido: 'Pac. #071',
    regimenes: [],
    iddsiSolidos: [],
    iddsiLiquidos: [],
    selectedPacienteId: null,
    histPagina: 1,
    histTotalPaginas: 1
  };

  // Referencias al DOM
  const userNameEl = document.getElementById('clinico-user-name');
  userNameEl.textContent = `${decodeHtmlEntities(currentUser.nombre_completo)} • ${currentUser.correo_institucional}`;

  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  /**
   * Muestra una notificacion accesible en la esquina inferior derecha.
   * @param {string} msg Mensaje al usuario.
   * @param {'violet'|'success'|'error'} [variant='violet'] Estilo visual.
   */
  function showToast(msg, variant = 'violet') {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className =
      variant === 'error'
        ? 'toast toast--error'
        : variant === 'success'
        ? 'toast toast--success'
        : 'toast';
    toastTimer = setTimeout(() => {
      toastEl.className = 'toast u-hidden';
    }, 4200);
  }

  /**
   * Limpia las credenciales JWT del navegador y redirige de forma segura al portal.
   * @param {string} [motivo=''] Parametro informativo opcional.
   */
  function cerrarSesionSegura(motivo = '') {
    sessionStorage.removeItem('capredena_jwt');
    sessionStorage.removeItem('capredena_user');
    localStorage.removeItem('capredena_jwt');
    localStorage.removeItem('capredena_user');
    const suffix = motivo ? `?motivo=${encodeURIComponent(motivo)}` : '';
    window.location.replace(`/login.html${suffix}`);
  }

  document.getElementById('btn-logout').addEventListener('click', () => cerrarSesionSegura());

  // ---------------------------------------------------------------------------
  // 2. CIERRE AUTOMATICO POR INACTIVIDAD TRAS 15 MINUTOS (RF10 / CP11)
  // ---------------------------------------------------------------------------
  const INACTIVITY_LIMIT_MS = 15 * 60 * 1000; // 15 minutos exactos
  const WARNING_BEFORE_MS = 90 * 1000;        // Aviso preventivo 90 segundos antes
  let lastActivityTimestamp = Date.now();
  let simulationLockUntil = 0;                // Evita que el clic del boton demo cancele la cuenta regresiva

  const inactivityBanner = document.getElementById('inactivity-banner');
  const inactivityMsg = document.getElementById('inactivity-message');
  const btnKeepAlive = document.getElementById('btn-keep-alive');
  const btnSimularInactividad = document.getElementById('btn-simular-inactividad');

  function registrarActividadHumana() {
    if (Date.now() < simulationLockUntil) return;
    lastActivityTimestamp = Date.now();
    if (!inactivityBanner.classList.contains('u-hidden')) {
      inactivityBanner.classList.add('u-hidden');
    }
  }

  /**
   * Acelera temporalmente el reloj de inactividad (ultimos 10 segundos) para
   * demostrar CP11 / RF10 en revision sin esperar 15 minutos reales.
   */
  function activarDemoInactividad() {
    simulationLockUntil = Date.now() + 2500;
    lastActivityTimestamp = Date.now() - (INACTIVITY_LIMIT_MS - 10000);
    inactivityMsg.textContent =
      'Aviso de Seguridad Clínica (RF10): Su sesión se cerrará automáticamente por inactividad en 10 segundos.';
    inactivityBanner.classList.remove('u-hidden');
    showToast('Demostración RF10 activa: no mueva el cursor para observar el cierre en 10s.', 'violet');
  }

  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((evtName) => {
    window.addEventListener(evtName, registrarActividadHumana, { passive: true });
  });

  // Atajo de teclado QA (Alt + Shift + I) y boton discreto para demostrar CP11
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      activarDemoInactividad();
    }
  });

  if (btnSimularInactividad) {
    btnSimularInactividad.addEventListener('click', (e) => {
      e.stopPropagation();
      activarDemoInactividad();
    });
  }

  btnKeepAlive.addEventListener('click', () => {
    simulationLockUntil = 0;
    registrarActividadHumana();
    showToast('Sesión clínica renovada correctamente.', 'success');
  });

  setInterval(() => {
    const elapsed = Date.now() - lastActivityTimestamp;
    const remaining = INACTIVITY_LIMIT_MS - elapsed;

    if (remaining <= 0) {
      cerrarSesionSegura('inactividad');
      return;
    }

    if (remaining <= WARNING_BEFORE_MS) {
      const segs = Math.ceil(remaining / 1000);
      inactivityMsg.textContent =
        `Aviso de Seguridad Clínica (RF10): Su sesión se cerrará automáticamente por inactividad en ${segs} segundos.`;
      inactivityBanner.classList.remove('u-hidden');
    }
  }, 1000);

  // ---------------------------------------------------------------------------
  // 3. CLIENTE HTTP AUTENTICADO (FETCH API ASINCRONA)
  // ---------------------------------------------------------------------------
  async function apiFetch(url, options = {}) {
    const headers = Object.assign(
      {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      options.headers || {}
    );

    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      cerrarSesionSegura();
      throw new Error('Sesión expirada.');
    }
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Error en la operación clínica.');
    }
    return payload;
  }

  // ---------------------------------------------------------------------------
  // 4. NAVEGACION ENTRE VISTAS Y MODOS CRUD (<= 3 CLICS)
  // ---------------------------------------------------------------------------
  const viewTabCenso = document.getElementById('view-tab-censo');
  const viewTabHistorial = document.getElementById('view-tab-historial');
  const sectionCenso = document.getElementById('section-censo');
  const sectionHistorial = document.getElementById('section-historial');

  const modeBtnEditar = document.getElementById('mode-btn-editar');
  const modeBtnIngreso = document.getElementById('mode-btn-ingreso');
  const modeBtnAlta = document.getElementById('mode-btn-alta');

  const formEditar = document.getElementById('form-crud-editar');
  const formIngreso = document.getElementById('form-crud-ingreso');
  const formAlta = document.getElementById('form-crud-alta');

  function activarVistaPrincipal(vista) {
    if (vista === 'censo') {
      sectionCenso.classList.remove('u-hidden');
      sectionHistorial.classList.add('u-hidden');
      viewTabCenso.classList.add('tabs__btn--active');
      viewTabHistorial.classList.remove('tabs__btn--active');
    } else {
      sectionCenso.classList.add('u-hidden');
      sectionHistorial.classList.remove('u-hidden');
      viewTabHistorial.classList.add('tabs__btn--active');
      viewTabCenso.classList.remove('tabs__btn--active');
      cargarHistorialBigData(1);
    }
  }

  function activarModoCrud(modo) {
    activarVistaPrincipal('censo');
    formEditar.classList.toggle('u-hidden', modo !== 'editar');
    formIngreso.classList.toggle('u-hidden', modo !== 'ingreso');
    formAlta.classList.toggle('u-hidden', modo !== 'alta');

    modeBtnEditar.classList.toggle('tabs__btn--active', modo === 'editar');
    modeBtnIngreso.classList.toggle('tabs__btn--active', modo === 'ingreso');
    modeBtnAlta.classList.toggle('tabs__btn--active', modo === 'alta');
  }

  viewTabCenso.addEventListener('click', () => activarVistaPrincipal('censo'));
  viewTabHistorial.addEventListener('click', () => activarVistaPrincipal('historial'));

  modeBtnEditar.addEventListener('click', () => activarModoCrud('editar'));
  modeBtnIngreso.addEventListener('click', () => prepararNuevoIngreso());
  modeBtnAlta.addEventListener('click', () => activarModoCrud('alta'));
  document
    .getElementById('btn-quick-ingreso')
    .addEventListener('click', () => prepararNuevoIngreso());

  // ---------------------------------------------------------------------------
  // 5. CARGA Y RENDERIZADO DEL CENSO ACTIVO + SELECTORES ESTANDARIZADOS 3FN
  // ---------------------------------------------------------------------------
  /**
   * Rellena los elementos <select> con los catalogos maestros en Tercera Forma Normal
   * separando estrictamente niveles IDDSI Solidos (3 a 7) de Liquidos (0 a 4) para
   * garantizar cero errores humanos al prescribir consistencias de disfagia.
   */
  function poblarSelectoresCatalogo() {
    const fillSelect = (selectEl, items, labelFn) => {
      selectEl.innerHTML = '';
      items.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = String(item.id_regimen || item.id_iddsi);
        opt.textContent = labelFn(item);
        selectEl.appendChild(opt);
      });
    };

    fillSelect(
      document.getElementById('edit-regimen'),
      state.regimenes,
      (r) => r.nombre_regimen
    );
    fillSelect(
      document.getElementById('ing-regimen'),
      state.regimenes,
      (r) => r.nombre_regimen
    );

    // Solo niveles SOLIDOS (3 al 7) en selectores solidos
    const labelIddsi = (c) => `Nivel ${c.nivel_iddsi} — ${c.nombre_oficial}`;
    fillSelect(document.getElementById('edit-iddsi-solido'), state.iddsiSolidos, labelIddsi);
    fillSelect(document.getElementById('ing-iddsi-solido'), state.iddsiSolidos, labelIddsi);

    // Solo niveles LIQUIDOS (0 al 4) en selectores liquidos
    fillSelect(document.getElementById('edit-iddsi-liquido'), state.iddsiLiquidos, labelIddsi);
    fillSelect(document.getElementById('ing-iddsi-liquido'), state.iddsiLiquidos, labelIddsi);

    // Preselecciona valores estandar seguros en Nuevo Ingreso (Solido 7 Normal, Liquido 0 Fino)
    const solNormal = state.iddsiSolidos.find((c) => c.nivel_iddsi === 7);
    const liqFino = state.iddsiLiquidos.find((c) => c.nivel_iddsi === 0);
    if (solNormal) document.getElementById('ing-iddsi-solido').value = String(solNormal.id_iddsi);
    if (liqFino) document.getElementById('ing-iddsi-liquido').value = String(liqFino.id_iddsi);
  }

  /**
   * Actualiza dinamicamente el selector de camas libres segun la sala hospitalaria
   * elegida por el Nutricionista Clinico, impidiendo colisiones fisicas de cama.
   */
  function actualizarSelectCamasLibres() {
    const sala = document.getElementById('ing-sala').value;
    const selectCama = document.getElementById('ing-cama');
    const libres = state.camasLibresPorSala[sala] || [];
    selectCama.innerHTML = '';

    // Si la sala tiene sus 20 camas ocupadas, informa claramente sin permitir envio invalido
    if (libres.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Sin camas disponibles en esta sala';
      selectCama.appendChild(opt);
      return;
    }

    libres.forEach((cama) => {
      const opt = document.createElement('option');
      opt.value = String(cama);
      opt.textContent = `Cama ${cama} (Disponible)`;
      selectCama.appendChild(opt);
    });
  }

  document
    .getElementById('ing-sala')
    .addEventListener('change', actualizarSelectCamasLibres);

  /**
   * Prepara en 1 clic el Formulario CRUD #2 (Nuevo Ingreso Hospitalario) sugiriendo
   * el siguiente codigo_ficha correlativo y la primera sala con camas disponibles.
   */
  function prepararNuevoIngreso() {
    activarModoCrud('ingreso');
    document.getElementById('ing-ficha').value = state.codigoSugerido;

    // Selecciona automaticamente la primera sala que posea camas libres
    for (const s of ['1', '2', '3', '4']) {
      if ((state.camasLibresPorSala[s] || []).length > 0) {
        document.getElementById('ing-sala').value = s;
        break;
      }
    }
    actualizarSelectCamasLibres();
    document.getElementById('crud-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Renderiza reactivamente la tabla del censo activo aplicando en tiempo real
   * los filtros de texto libre (ficha, sala, cama, dieta, alergias) y de disfagia.
   * Emplea textContent puro en cada nodo para neutralizar cualquier vector XSS.
   */
  function renderTablaCenso() {
    const tbody = document.getElementById('tbody-censo');
    const query = document.getElementById('search-censo').value.trim().toLowerCase();
    const salaFiltro = document.getElementById('filter-sala').value;

    const filtrados = state.pacientes.filter((p) => {
      if (salaFiltro === 'DISFAGIA' && !p.tiene_disfagia) return false;
      if (salaFiltro && salaFiltro !== 'DISFAGIA' && String(p.numero_sala) !== salaFiltro) {
        return false;
      }

      if (!query) return true;
      const textoBusqueda = [
        p.codigo_ficha,
        `sala ${p.numero_sala}`,
        `cama ${p.numero_cama}`,
        `${p.numero_sala}-${p.numero_cama}`,
        p.nombre_regimen,
        p.nombre_iddsi_solido,
        p.nombre_iddsi_liquido,
        p.observacion_alergias
      ]
        .join(' ')
        .toLowerCase();

      return textoBusqueda.includes(query);
    });

    tbody.innerHTML = '';

    if (filtrados.length === 0) {
      const trEmpty = document.createElement('tr');
      const tdEmpty = document.createElement('td');
      tdEmpty.colSpan = 6;
      tdEmpty.textContent = 'No se encontraron pacientes activos para el criterio ingresado.';
      trEmpty.appendChild(tdEmpty);
      tbody.appendChild(trEmpty);
      return;
    }

    const fragment = document.createDocumentFragment();

    filtrados.forEach((p) => {
      const tr = document.createElement('tr');
      if (state.selectedPacienteId === p.id_paciente) {
        tr.className = 'data-table__row--selected';
      }

      // 1. Ficha
      const tdFicha = document.createElement('td');
      const strongFicha = document.createElement('strong');
      strongFicha.textContent = decodeHtmlEntities(p.codigo_ficha);
      tdFicha.appendChild(strongFicha);

      // 2. Ubicacion Sala / Cama
      const tdUbic = document.createElement('td');
      tdUbic.textContent = `Sala ${p.numero_sala} • Cama ${p.numero_cama}`;

      // 3. Regimen + observacion resumida
      const tdReg = document.createElement('td');
      const divReg = document.createElement('div');
      divReg.textContent = p.nombre_regimen;
      const smallObs = document.createElement('div');
      smallObs.className = 'panel__subtitle';
      smallObs.textContent = decodeHtmlEntities(p.observacion_alergias);
      tdReg.appendChild(divReg);
      tdReg.appendChild(smallObs);

      // 4. IDDSI Solido
      const tdSol = document.createElement('td');
      const spanSol = document.createElement('span');
      spanSol.className = p.nivel_iddsi_solido < 7 ? 'tag tag--violet' : 'tag';
      spanSol.textContent = `IDDSI ${p.nivel_iddsi_solido}: ${p.nombre_iddsi_solido}`;
      tdSol.appendChild(spanSol);

      // 5. IDDSI Liquido
      const tdLiq = document.createElement('td');
      const spanLiq = document.createElement('span');
      spanLiq.className = p.nivel_iddsi_liquido > 0 ? 'tag tag--violet' : 'tag';
      spanLiq.textContent = `IDDSI ${p.nivel_iddsi_liquido}: ${p.nombre_iddsi_liquido}`;
      tdLiq.appendChild(spanLiq);

      // 6. Acciones directas en 1 clic (Editar / Alta)
      const tdAcc = document.createElement('td');
      const divAcc = document.createElement('div');
      divAcc.className = 'data-table__actions';

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn btn--primary btn--sm';
      btnEdit.textContent = 'Editar';
      btnEdit.setAttribute('aria-label', `Editar minuta de ${p.codigo_ficha}`);
      btnEdit.addEventListener('click', () => seleccionarParaEditar(p));

      const btnAlta = document.createElement('button');
      btnAlta.type = 'button';
      btnAlta.className = 'btn btn--danger btn--sm';
      btnAlta.textContent = 'Alta';
      btnAlta.setAttribute('aria-label', `Gestionar alta de ${p.codigo_ficha}`);
      btnAlta.addEventListener('click', () => seleccionarParaAlta(p));

      divAcc.appendChild(btnEdit);
      divAcc.appendChild(btnAlta);
      tdAcc.appendChild(divAcc);

      tr.appendChild(tdFicha);
      tr.appendChild(tdUbic);
      tr.appendChild(tdReg);
      tr.appendChild(tdSol);
      tr.appendChild(tdLiq);
      tr.appendChild(tdAcc);
      fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);
  }

  /**
   * Autocompleta en 1 clic el formulario CRUD #1 para el paciente seleccionado.
   * @param {Object} paciente Registro del paciente activo.
   */
  function seleccionarParaEditar(paciente) {
    state.selectedPacienteId = paciente.id_paciente;
    activarModoCrud('editar');

    document.getElementById('edit-id-paciente').value = String(paciente.id_paciente);
    document.getElementById('edit-patient-banner').textContent =
      `Editando ${decodeHtmlEntities(paciente.codigo_ficha)} — Sala ${paciente.numero_sala}, Cama ${paciente.numero_cama}`;
    document.getElementById('edit-regimen').value = String(paciente.id_regimen_actual);
    document.getElementById('edit-iddsi-solido').value = String(paciente.id_iddsi_solido);
    document.getElementById('edit-iddsi-liquido').value = String(paciente.id_iddsi_liquido);
    document.getElementById('edit-alergias').value = decodeHtmlEntities(
      paciente.observacion_alergias
    );

    renderTablaCenso();
    document.getElementById('crud-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Autocompleta en 1 clic el formulario CRUD #3 de confirmacion de Alta Clinica.
   * @param {Object} paciente Registro del paciente activo a egresar.
   */
  function seleccionarParaAlta(paciente) {
    state.selectedPacienteId = paciente.id_paciente;
    activarModoCrud('alta');

    document.getElementById('alta-id-paciente').value = String(paciente.id_paciente);
    document.getElementById('alta-patient-summary').textContent =
      `Confirmar egreso de ${decodeHtmlEntities(paciente.codigo_ficha)} (Sala ${paciente.numero_sala}, Cama ${paciente.numero_cama} • ${paciente.nombre_regimen}).`;

    renderTablaCenso();
    document.getElementById('crud-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Consulta al backend GET /api/pacientes/censo para sincronizar el listado 3FN,
   * la disponibilidad fisica de las 80 camas institucionales y los catalogos IDDSI.
   */
  async function cargarCensoActivo() {
    try {
      const data = await apiFetch('/api/pacientes/censo');
      state.pacientes = data.pacientes || [];
      state.camasLibresPorSala = data.camas_libres_por_sala || { 1: [], 2: [], 3: [], 4: [] };
      state.codigoSugerido = data.codigo_ficha_sugerido || 'Pac. #074';

      if (state.regimenes.length === 0 && data.catalogos) {
        state.regimenes = data.catalogos.regimenes || [];
        const allIddsi = data.catalogos.consistencias_iddsi || [];
        state.iddsiSolidos = allIddsi.filter((c) => c.aplica_a_tipo === 'SOLIDO');
        state.iddsiLiquidos = allIddsi.filter((c) => c.aplica_a_tipo === 'LIQUIDO');
        poblarSelectoresCatalogo();
      }

      document.getElementById('badge-count-activos').textContent = String(data.total_activos);

      const resumenSalas = [1, 2, 3, 4]
        .map((s) => `S${s}: ${(state.camasLibresPorSala[s] || []).length} libres`)
        .join(' | ');
      document.getElementById('camas-resumen-bar').textContent =
        `Disponibilidad física (${data.total_camas_libres} camas libres): ${resumenSalas}`;

      document.getElementById('ing-ficha').value = state.codigoSugerido;
      actualizarSelectCamasLibres();

      // Precarga el primer paciente en el editor para agilidad inmediata si no hay seleccion previa
      if (!state.selectedPacienteId && state.pacientes.length > 0) {
        const primero = state.pacientes[0];
        state.selectedPacienteId = primero.id_paciente;
        document.getElementById('edit-id-paciente').value = String(primero.id_paciente);
        document.getElementById('edit-patient-banner').textContent =
          `Editando ${decodeHtmlEntities(primero.codigo_ficha)} — Sala ${primero.numero_sala}, Cama ${primero.numero_cama}`;
        document.getElementById('edit-regimen').value = String(primero.id_regimen_actual);
        document.getElementById('edit-iddsi-solido').value = String(primero.id_iddsi_solido);
        document.getElementById('edit-iddsi-liquido').value = String(primero.id_iddsi_liquido);
        document.getElementById('edit-alergias').value = decodeHtmlEntities(
          primero.observacion_alergias
        );
      }

      renderTablaCenso();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  document.getElementById('search-censo').addEventListener('input', renderTablaCenso);
  document.getElementById('filter-sala').addEventListener('change', renderTablaCenso);

  // ---------------------------------------------------------------------------
  // 6. EJECUCION DE LAS 3 TRANSACCIONES CRUD (POST / PUT / PATCH)
  // ---------------------------------------------------------------------------

  // CRUD #1: Modificar Prescripcion / Minuta
  formEditar.addEventListener('submit', async (event) => {
    event.preventDefault();
    const idPac = document.getElementById('edit-id-paciente').value;
    if (!idPac) {
      showToast('Seleccione primero un paciente de la tabla.', 'error');
      return;
    }

    try {
      const resp = await apiFetch(`/api/pacientes/${idPac}/minuta`, {
        method: 'PUT',
        body: JSON.stringify({
          id_regimen_actual: Number(document.getElementById('edit-regimen').value),
          id_iddsi_solido: Number(document.getElementById('edit-iddsi-solido').value),
          id_iddsi_liquido: Number(document.getElementById('edit-iddsi-liquido').value),
          observacion_alergias: document.getElementById('edit-alergias').value
        })
      });
      showToast(`${resp.mensaje} Alerta enviada a Cocina en vivo.`, 'success');
      await cargarCensoActivo();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // CRUD #2: Nuevo Ingreso Hospitalario
  formIngreso.addEventListener('submit', async (event) => {
    event.preventDefault();
    const camaVal = document.getElementById('ing-cama').value;
    if (!camaVal) {
      showToast('No hay camas disponibles en la sala seleccionada.', 'error');
      return;
    }

    try {
      const resp = await apiFetch('/api/pacientes/ingreso', {
        method: 'POST',
        body: JSON.stringify({
          codigo_ficha: document.getElementById('ing-ficha').value.trim(),
          numero_sala: Number(document.getElementById('ing-sala').value),
          numero_cama: Number(camaVal),
          id_regimen_actual: Number(document.getElementById('ing-regimen').value),
          id_iddsi_solido: Number(document.getElementById('ing-iddsi-solido').value),
          id_iddsi_liquido: Number(document.getElementById('ing-iddsi-liquido').value),
          observacion_alergias: document.getElementById('ing-alergias').value.trim()
        })
      });

      state.selectedPacienteId = resp.paciente.id_paciente;
      showToast(`${resp.mensaje} Notificado en tiempo real a Cocina.`, 'success');
      await cargarCensoActivo();
      seleccionarParaEditar(resp.paciente);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // CRUD #3: Confirmacion de Alta Clinica
  formAlta.addEventListener('submit', async (event) => {
    event.preventDefault();
    const idPac = document.getElementById('alta-id-paciente').value;
    if (!idPac) {
      showToast('Seleccione primero el botón Alta en la fila del paciente.', 'error');
      return;
    }

    try {
      const resp = await apiFetch(`/api/pacientes/${idPac}/alta`, {
        method: 'PATCH',
        body: JSON.stringify({
          motivo_alta: document.getElementById('alta-motivo').value
        })
      });

      state.selectedPacienteId = null;
      showToast(`${resp.mensaje} Alerta roja emitida a Cocina.`, 'success');
      await cargarCensoActivo();
      activarModoCrud('editar');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ---------------------------------------------------------------------------
  // 7. REPOSITORIO BIG DATA E HISTORIAL INMUTABLE (GET /api/historial)
  // ---------------------------------------------------------------------------
  /**
   * Consulta de forma paginada y filtrada la Tabla de Hechos Historial_Minutas,
   * actualizando tanto las tarjetas de volumen acumulado como la grilla de auditoria.
   * @param {number} [pagina=1] Numero de pagina a consultar.
   */
  async function cargarHistorialBigData(pagina = 1) {
    try {
      const params = new URLSearchParams({
        pagina: String(pagina),
        limite: '20'
      });

      const pac = document.getElementById('hist-paciente').value.trim();
      const tipo = document.getElementById('hist-tipo').value;
      const desde = document.getElementById('hist-desde').value;
      const hasta = document.getElementById('hist-hasta').value;

      if (pac) params.set('paciente', pac);
      if (tipo) params.set('tipo_movimiento', tipo);
      if (desde) params.set('fecha_desde', desde);
      if (hasta) params.set('fecha_hasta', hasta);

      const data = await apiFetch(`/api/historial?${params.toString()}`);

      const stats = data.estadisticas_acumuladas;
      document.getElementById('hist-kpi-total').textContent = String(
        stats.total_transacciones_historicas
      );
      document.getElementById('hist-kpi-ingresos').textContent = String(stats.total_ingresos);
      document.getElementById('hist-kpi-modificaciones').textContent = String(
        stats.total_modificaciones
      );
      document.getElementById('hist-kpi-altas').textContent = String(stats.total_altas);
      document.getElementById('hist-kpi-top-regimen').textContent =
        `Régimen líder: ${stats.regimen_mas_prescrito} (${stats.asignaciones_regimen_lider})`;

      state.histPagina = data.paginacion.pagina_actual;
      state.histTotalPaginas = data.paginacion.total_paginas;

      document.getElementById('hist-paginacion-info').textContent =
        `Página ${state.histPagina} de ${state.histTotalPaginas} • ${data.paginacion.total_registros_filtrados} eventos encontrados`;

      const tbody = document.getElementById('tbody-historial');
      tbody.innerHTML = '';

      if (!data.registros || data.registros.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.textContent = 'No existen transacciones históricas para los filtros seleccionados.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      const frag = document.createDocumentFragment();
      data.registros.forEach((h) => {
        const tr = document.createElement('tr');

        const tdId = document.createElement('td');
        tdId.textContent = `#${h.id_historial}`;

        const tdFecha = document.createElement('td');
        tdFecha.textContent = h.fecha_hora_registro;

        const tdTipo = document.createElement('td');
        const tag = document.createElement('span');
        tag.className =
          h.tipo_movimiento === 'INGRESO'
            ? 'tag tag--success'
            : h.tipo_movimiento === 'ALTA'
            ? 'tag tag--danger'
            : 'tag tag--violet';
        tag.textContent = h.tipo_movimiento;
        tdTipo.appendChild(tag);

        const tdPac = document.createElement('td');
        tdPac.textContent =
          `${decodeHtmlEntities(h.codigo_ficha)} (Sala ${h.numero_sala}, Cama ${h.numero_cama})`;

        const tdPresc = document.createElement('td');
        tdPresc.textContent =
          `${h.nombre_regimen} | Sólido ${h.nivel_iddsi_solido} (${h.nombre_iddsi_solido}) | Líquido ${h.nivel_iddsi_liquido} (${h.nombre_iddsi_liquido})`;

        const tdDet = document.createElement('td');
        const divDet = document.createElement('div');
        divDet.textContent = decodeHtmlEntities(h.detalle_clinico || '');
        const divAutor = document.createElement('div');
        divAutor.className = 'panel__subtitle';
        divAutor.textContent = `Autor: ${decodeHtmlEntities(h.profesional_autor)}`;
        tdDet.appendChild(divDet);
        tdDet.appendChild(divAutor);

        tr.appendChild(tdId);
        tr.appendChild(tdFecha);
        tr.appendChild(tdTipo);
        tr.appendChild(tdPac);
        tr.appendChild(tdPresc);
        tr.appendChild(tdDet);
        frag.appendChild(tr);
      });

      tbody.appendChild(frag);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Eventos de paginacion y filtrado reactivo sobre la tabla Historial_Minutas
  document.getElementById('form-filtros-historial').addEventListener('submit', (e) => {
    e.preventDefault();
    cargarHistorialBigData(1);
  });

  // Restaura todos los criterios de busqueda del repositorio Big Data a su estado inicial
  document.getElementById('btn-limpiar-historial').addEventListener('click', () => {
    document.getElementById('hist-paciente').value = '';
    document.getElementById('hist-tipo').value = '';
    document.getElementById('hist-desde').value = '';
    document.getElementById('hist-hasta').value = '';
    cargarHistorialBigData(1);
  });

  // Navegacion hacia pagina previa del historial auditado
  document.getElementById('btn-hist-prev').addEventListener('click', () => {
    if (state.histPagina > 1) cargarHistorialBigData(state.histPagina - 1);
  });

  // Navegacion hacia pagina siguiente del historial auditado
  document.getElementById('btn-hist-next').addEventListener('click', () => {
    if (state.histPagina < state.histTotalPaginas) cargarHistorialBigData(state.histPagina + 1);
  });

  // Boton discreto QA: Restaura escenario demo base de 70 pacientes (CP04-CP08)
  const btnRestaurarDemo = document.getElementById('btn-restaurar-demo');
  if (btnRestaurarDemo) {
    btnRestaurarDemo.addEventListener('click', async () => {
      const confirmado = window.confirm(
        '¿Restaurar el Censo Demo institucional a su estado inicial (70 pacientes activos, Sala 1 Cama 8 libre, Pac. #042 en S2-C14 y Pac. #033 en S3-C19)?'
      );
      if (!confirmado) return;
      try {
        const resp = await apiFetch('/api/pacientes/restaurar-demo', { method: 'POST' });
        state.selectedPacienteId = null;
        showToast(resp.mensaje, 'success');
        await cargarCensoActivo();
        activarModoCrud('editar');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Inicializacion al abrir el modulo clinico
  cargarCensoActivo();
})();
