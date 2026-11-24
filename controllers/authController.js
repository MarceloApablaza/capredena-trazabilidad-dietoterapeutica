/**
 * @file controllers/authController.js
 * @description Controlador MVC para autenticacion institucional sin estado (JWT),
 * generacion criptografica de tokens temporales de recuperacion (15 minutos) y
 * restablecimiento seguro de credenciales con cifrado irreversible Bcrypt (10 rondas).
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const UsuarioModel = require('../models/UsuarioModel');
const { sanitizeText } = require('../middlewares/securityMiddleware');
const { AppError } = require('../middlewares/errorHandler');

// Expresion regular estandar para correo institucional y fortaleza de clave (>= 8 alfanumericos)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_POLICY_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;

/**
 * Formatea una instancia Date a cadena UTC compatible con SQLite ('YYYY-MM-DD HH:MM:SS').
 * @param {Date} date Fecha a convertir.
 * @returns {string} Timestamp UTC estandarizado.
 */
function toUtcSqlString(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

const authController = {
  /**
   * POST /api/auth/login
   * Autentica al profesional verificando Bcrypt y emite un JWT firmado con rol RBAC.
   */
  login(req, res, next) {
    try {
      const correo = sanitizeText(req.body.correo_institucional, 120).toLowerCase();
      const password = typeof req.body.password === 'string' ? req.body.password : '';

      if (!correo || !EMAIL_REGEX.test(correo) || !password) {
        throw new AppError('Debe ingresar un correo institucional válido y su contraseña.', 400);
      }

      const usuario = UsuarioModel.findByEmail(correo);
      if (!usuario || !usuario.estado_activo) {
        throw new AppError('Credenciales institucionales inválidas o cuenta inactiva.', 401);
      }

      const passwordValida = bcrypt.compareSync(password, usuario.password_hash);
      if (!passwordValida) {
        throw new AppError('Credenciales institucionales inválidas o cuenta inactiva.', 401);
      }

      const payload = {
        id_usuario: usuario.id_usuario,
        nombre_completo: usuario.nombre_completo,
        correo_institucional: usuario.correo_institucional,
        rol: usuario.rol
      };

      const token = jwt.sign(payload, env.JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: env.JWT_EXPIRES_IN
      });

      return res.status(200).json({
        ok: true,
        mensaje: 'Autenticación institucional exitosa.',
        token,
        usuario: payload,
        redirect_to: usuario.rol === 'CLINICO' ? '/clinico.html' : '/cocina.html'
      });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * POST /api/auth/recuperar
   * Genera un token unico temporal (TKN-XXXX-CAPR) con vigencia estricta de 15 minutos.
   * Si no existe servidor SMTP configurado en .env, registra el token en consola del
   * servidor y expone dev_token_preview en entorno de pruebas para validacion inmediata.
   */
  recuperar(req, res, next) {
    try {
      const correo = sanitizeText(req.body.correo_institucional, 120).toLowerCase();
      if (!correo || !EMAIL_REGEX.test(correo)) {
        throw new AppError('Ingrese un correo electrónico institucional con formato válido.', 400);
      }

      const usuario = UsuarioModel.findByEmail(correo);
      if (!usuario || !usuario.estado_activo) {
        throw new AppError('No se encontró una cuenta institucional activa asociada a ese correo.', 404);
      }

      // Generacion criptografica CSPRNG del token temporal formato TKN-XXXX-CAPR
      const hexBlock = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
      const tokenTemporal = `TKN-${hexBlock}-CAPR`;
      const fechaExpiracion = new Date(Date.now() + 15 * 60 * 1000);
      const expiracionUtc = toUtcSqlString(fechaExpiracion);

      UsuarioModel.saveRecoveryToken(usuario.id_usuario, tokenTemporal, expiracionUtc);

      const respuesta = {
        ok: true,
        mensaje:
          'Se ha generado un token temporal de recuperación con vigencia de 15 minutos.',
        vigencia_minutos: 15,
        expira_en_utc: expiracionUtc
      };

      if (!env.SMTP_CONFIGURADO) {
        // Sin servidor SMTP institucional configurado (entorno local o Railway demo):
        // registra auditoria en consola y entrega vista controlada para completar CP02 en vivo.
        console.log(
          `[SEGURIDAD CAPREDENA - RECUPERACION] Correo: ${correo} | Token Temporal (15 min): ${tokenTemporal}`
        );
        respuesta.dev_token_preview = tokenTemporal;
      }

      return res.status(200).json(respuesta);
    } catch (err) {
      return next(err);
    }
  },

  /**
   * POST /api/auth/restablecer
   * Verifica correo + token vigente (< 15 min) y cifra la nueva contrasena con Bcrypt
   * (10 rondas con salt dinamico), invalidando inmediatamente el token consumido.
   */
  restablecer(req, res, next) {
    try {
      const correo = sanitizeText(req.body.correo_institucional, 120).toLowerCase();
      const token = sanitizeText(req.body.token_recuperacion, 40).toUpperCase();
      const nuevaPassword =
        typeof req.body.nueva_password === 'string' ? req.body.nueva_password : '';

      if (!correo || !EMAIL_REGEX.test(correo) || !token) {
        throw new AppError('Debe indicar el correo institucional y el token temporal recibido.', 400);
      }

      if (!PASSWORD_POLICY_REGEX.test(nuevaPassword)) {
        throw new AppError(
          'Política de seguridad: La nueva contraseña debe tener mínimo 8 caracteres e incluir letras y números.',
          400
        );
      }

      const salt = bcrypt.genSaltSync(10);
      const nuevoHash = bcrypt.hashSync(nuevaPassword, salt);
      const ahoraUtc = toUtcSqlString(new Date());

      const resultado = UsuarioModel.resetPasswordWithToken(
        correo,
        token,
        nuevoHash,
        ahoraUtc
      );

      if (!resultado.ok) {
        throw new AppError(resultado.motivo, 400);
      }

      return res.status(200).json({
        ok: true,
        mensaje: 'Contraseña restablecida exitosamente con cifrado Bcrypt. Ya puede iniciar sesión.'
      });
    } catch (err) {
      return next(err);
    }
  }
};

module.exports = authController;
