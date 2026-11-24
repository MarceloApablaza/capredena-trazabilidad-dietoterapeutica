/**
 * @file models/UsuarioModel.js
 * @description Capa Modelo (MVC) para la entidad Usuarios y su relacion 3FN con Roles.
 * Todas las operaciones emplean exclusivamente sentencias SQL precompiladas
 * parametrizadas (Prepared Statements) para mitigar al 100% la inyeccion SQL.
 */

const { db, runInTransaction } = require('../config/database');

// Sentencias SQL parametrizadas reutilizables de alto rendimiento
const stmtFindByEmail = db.prepare(`
  SELECT
    u.id_usuario,
    u.id_rol,
    r.nombre_rol AS rol,
    r.descripcion_permisos,
    u.nombre_completo,
    u.correo_institucional,
    u.password_hash,
    u.token_recuperacion,
    u.token_expiracion,
    u.estado_activo
  FROM Usuarios u
  INNER JOIN Roles r ON r.id_rol = u.id_rol
  WHERE LOWER(u.correo_institucional) = LOWER(?)
  LIMIT 1
`);

const stmtSaveRecoveryToken = db.prepare(`
  UPDATE Usuarios
  SET token_recuperacion = ?, token_expiracion = ?
  WHERE id_usuario = ? AND estado_activo = 1
`);

const stmtUpdatePasswordAndClearToken = db.prepare(`
  UPDATE Usuarios
  SET password_hash = ?,
      token_recuperacion = NULL,
      token_expiracion = NULL
  WHERE id_usuario = ? AND estado_activo = 1
`);

const UsuarioModel = {
  /**
   * Busca un usuario institucional activo o inactivo por correo electronico.
   * @param {string} correo Correo institucional normalizado.
   * @returns {Object|undefined} Registro del usuario cruzado con su rol RBAC.
   */
  findByEmail(correo) {
    return stmtFindByEmail.get(correo);
  },

  /**
   * Registra un token temporal de recuperacion de contrasena con expiracion de 15 minutos.
   * @param {number} idUsuario Identificador primario del usuario.
   * @param {string} token Codigo unico temporal (ej. TKN-XXXX-CAPR).
   * @param {string} expiracionUtc Marca de tiempo UTC de vencimiento.
   * @returns {boolean} True si se actualizo satisfactoriamente.
   */
  saveRecoveryToken(idUsuario, token, expiracionUtc) {
    const info = stmtSaveRecoveryToken.run(token, expiracionUtc, idUsuario);
    return info.changes > 0;
  },

  /**
   * Valida atomicamente el token temporal vigente y reemplaza el hash Bcrypt,
   * invalidando el token inmediatamente para impedir ataques de repeticion (Replay Attack).
   * @param {string} correo Correo institucional del solicitante.
   * @param {string} token Token temporal recibido por el usuario.
   * @param {string} nuevoPasswordHash Nuevo hash Bcrypt (>= 10 rondas).
   * @param {string} ahoraUtc Timestamp UTC actual para verificar expiracion.
   * @returns {{ ok: boolean, motivo?: string }} Resultado de la transaccion.
   */
  resetPasswordWithToken(correo, token, nuevoPasswordHash, ahoraUtc) {
    return runInTransaction(() => {
      const usuario = stmtFindByEmail.get(correo);
      if (!usuario || !usuario.estado_activo) {
        return { ok: false, motivo: 'Credenciales de recuperación inválidas o cuenta inactiva.' };
      }

      if (
        !usuario.token_recuperacion ||
        !usuario.token_expiracion ||
        usuario.token_recuperacion !== token
      ) {
        return { ok: false, motivo: 'El token de recuperación ingresado no es válido.' };
      }

      if (usuario.token_expiracion < ahoraUtc) {
        return { ok: false, motivo: 'El token de recuperación ha expirado (vigencia máxima: 15 minutos).' };
      }

      stmtUpdatePasswordAndClearToken.run(nuevoPasswordHash, usuario.id_usuario);
      return { ok: true };
    });
  }
};

module.exports = UsuarioModel;
