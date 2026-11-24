/**
 * @file public/js/login.js
 * @description Controlador cliente (ES6+) del Portal de Autenticacion Institucional.
 * Gestiona el inicio de sesion sin estado (JWT), redireccion automatica segun rol RBAC
 * ('CLINICO' -> /clinico.html | 'PRODUCCION' -> /cocina.html) y el flujo completo de
 * recuperacion y restablecimiento de contrasena mediante token temporal (15 minutos).
 */

(function initAuthPortal() {
  'use strict';

  // Referencias semanticas al DOM
  const tabBtnLogin = document.getElementById('tab-btn-login');
  const tabBtnRecovery = document.getElementById('tab-btn-recovery');
  const formLogin = document.getElementById('form-login');
  const panelRecovery = document.getElementById('panel-recovery');
  const formSolicitarToken = document.getElementById('form-solicitar-token');
  const formRestablecerClave = document.getElementById('form-restablecer-clave');
  const feedbackBox = document.getElementById('auth-feedback');

  const inputLoginCorreo = document.getElementById('login-correo');
  const inputLoginPassword = document.getElementById('login-password');
  const inputRecCorreo = document.getElementById('rec-correo');
  const inputResToken = document.getElementById('res-token');
  const inputResPassword = document.getElementById('res-password');

  const btnDemoClinico = document.getElementById('demo-clinico');
  const btnDemoCocina = document.getElementById('demo-cocina');

  /**
   * Despliega mensajes accesibles en el contenedor aria-live del portal.
   * @param {string} mensaje Texto informativo o alerta de error.
   * @param {'violet'|'danger'|'success'} [tipo='violet'] Variante cromatica BEM.
   */
  function mostrarFeedback(mensaje, tipo = 'violet') {
    feedbackBox.textContent = mensaje;
    feedbackBox.className = `form__notice form__notice--${tipo}`;
  }

  /**
   * Alterna entre el formulario de inicio de sesion y el flujo de recuperacion.
   * @param {'login'|'recovery'} modo Vista activa seleccionada.
   */
  function cambiarModoVista(modo) {
    feedbackBox.className = 'form__notice u-hidden';
    if (modo === 'login') {
      formLogin.classList.remove('u-hidden');
      panelRecovery.classList.add('u-hidden');
      tabBtnLogin.classList.add('tabs__btn--active');
      tabBtnRecovery.classList.remove('tabs__btn--active');
      tabBtnLogin.setAttribute('aria-selected', 'true');
      tabBtnRecovery.setAttribute('aria-selected', 'false');
    } else {
      formLogin.classList.add('u-hidden');
      panelRecovery.classList.remove('u-hidden');
      tabBtnRecovery.classList.add('tabs__btn--active');
      tabBtnLogin.classList.remove('tabs__btn--active');
      tabBtnRecovery.setAttribute('aria-selected', 'true');
      tabBtnLogin.setAttribute('aria-selected', 'false');
      if (inputLoginCorreo.value && !inputRecCorreo.value) {
        inputRecCorreo.value = inputLoginCorreo.value;
      }
    }
  }

  /**
   * Persiste la sesion JWT en sessionStorage (permitiendo abrir perfiles distintos
   * en pestanas paralelas para demostracion en vivo) y respalda en localStorage.
   * @param {string} token Token JWT firmado por el backend.
   * @param {Object} usuario Datos verificados del usuario y su rol RBAC.
   */
  function guardarSesion(token, usuario) {
    const payloadStr = JSON.stringify(usuario);
    sessionStorage.setItem('capredena_jwt', token);
    sessionStorage.setItem('capredena_user', payloadStr);
    localStorage.setItem('capredena_jwt', token);
    localStorage.setItem('capredena_user', payloadStr);
  }

  // Notifica si el usuario llego redirigido por cierre automatico de inactividad (RF10)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('motivo') === 'inactividad') {
    mostrarFeedback(
      'Por seguridad clínica (RF10), su sesión se cerró automáticamente tras 15 minutos de inactividad.',
      'danger'
    );
  }

  tabBtnLogin.addEventListener('click', () => cambiarModoVista('login'));
  tabBtnRecovery.addEventListener('click', () => cambiarModoVista('recovery'));

  // ===========================================================================
  // EVENTOS DE ACCESO RAPIDO Y FLUJOS ASINCRONOS FETCH API (ES6+)
  // ===========================================================================
  // Selectores rapidos de credenciales de prueba institucionales para evaluacion
  btnDemoClinico.addEventListener('click', () => {
    cambiarModoVista('login');
    inputLoginCorreo.value = 'nutricion.clinica@capredena.gob.cl';
    inputLoginPassword.value = 'Clinica2026!';
    mostrarFeedback(
      'Credenciales de Nutricionista Clínico cargadas. Pulse "Ingresar al Sistema Seguro".',
      'violet'
    );
  });

  // Autocompleta credenciales del perfil de Produccion Cocina (Modo Solo Lectura)
  btnDemoCocina.addEventListener('click', () => {
    cambiarModoVista('login');
    inputLoginCorreo.value = 'produccion.cocina@capredena.gob.cl';
    inputLoginPassword.value = 'Cocina2026!';
    mostrarFeedback(
      'Credenciales de Producción Cocina (Solo Lectura) cargadas. Pulse "Ingresar al Sistema Seguro".',
      'violet'
    );
  });

  // Envio asincrono de autenticacion JWT (POST /api/auth/login)
  formLogin.addEventListener('submit', async (event) => {
    event.preventDefault();
    const correo = inputLoginCorreo.value.trim();
    const password = inputLoginPassword.value;

    if (!correo || !password) {
      mostrarFeedback('Por favor complete su correo institucional y contraseña.', 'danger');
      return;
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo_institucional: correo, password })
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        mostrarFeedback(data.error || 'No fue posible iniciar sesión.', 'danger');
        return;
      }

      guardarSesion(data.token, data.usuario);
      window.location.href =
        data.redirect_to ||
        (data.usuario.rol === 'CLINICO' ? '/clinico.html' : '/cocina.html');
    } catch (_err) {
      mostrarFeedback('Error de conexión con el servidor institucional.', 'danger');
    }
  });

  // Solicitud de token temporal de recuperacion (POST /api/auth/recuperar)
  formSolicitarToken.addEventListener('submit', async (event) => {
    event.preventDefault();
    const correo = inputRecCorreo.value.trim();
    if (!correo) {
      mostrarFeedback('Ingrese su correo institucional para generar el token.', 'danger');
      return;
    }

    try {
      const response = await fetch('/api/auth/recuperar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo_institucional: correo })
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        mostrarFeedback(data.error || 'Error al generar el token de recuperación.', 'danger');
        return;
      }

      if (data.dev_token_preview) {
        inputResToken.value = data.dev_token_preview;
        mostrarFeedback(
          `${data.mensaje} [Modo Demo sin SMTP: Token autocompletado -> ${data.dev_token_preview}]`,
          'success'
        );
      } else {
        mostrarFeedback(data.mensaje, 'success');
      }
    } catch (_err) {
      mostrarFeedback('No fue posible contactar al servicio de recuperación.', 'danger');
    }
  });

  // Restablecimiento definitivo de contrasena (POST /api/auth/restablecer)
  formRestablecerClave.addEventListener('submit', async (event) => {
    event.preventDefault();
    const correo = inputRecCorreo.value.trim();
    const token = inputResToken.value.trim();
    const nuevaPassword = inputResPassword.value;

    if (!correo || !token || !nuevaPassword) {
      mostrarFeedback(
        'Complete el correo institucional, el token temporal y su nueva contraseña.',
        'danger'
      );
      return;
    }

    try {
      const response = await fetch('/api/auth/restablecer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correo_institucional: correo,
          token_recuperacion: token,
          nueva_password: nuevaPassword
        })
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        mostrarFeedback(data.error || 'No se pudo restablecer la contraseña.', 'danger');
        return;
      }

      inputLoginCorreo.value = correo;
      inputLoginPassword.value = '';
      inputResToken.value = '';
      inputResPassword.value = '';
      cambiarModoVista('login');
      mostrarFeedback(data.mensaje, 'success');
    } catch (_err) {
      mostrarFeedback('Error de red al restablecer la contraseña.', 'danger');
    }
  });
})();
