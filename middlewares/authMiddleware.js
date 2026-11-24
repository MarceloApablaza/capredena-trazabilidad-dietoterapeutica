/**
 * @file middlewares/authMiddleware.js
 * @description Middlewares de autenticacion sin estado (Stateless JWT) y Control de
 * Acceso Basado en Roles (RBAC) para proteger los endpoints clinicos y de cocina.
 * Impone separacion estricta entre 'CLINICO' (lectura/escritura) y 'PRODUCCION' (solo lectura).
 */

const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Extrae y verifica criptograficamente el JSON Web Token (Bearer) enviado en la
 * cabecera Authorization. Adjunta la identidad verificada en req.user.
 * @param {import('express').Request} req Solicitud HTTP entrante.
 * @param {import('express').Response} res Respuesta HTTP saliente.
 * @param {import('express').NextFunction} next Siguiente funcion en la cadena Express.
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      ok: false,
      error: 'No autenticado: Se requiere un token Bearer JWT válido.'
    });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({
      ok: false,
      error: 'No autenticado: El token proporcionado se encuentra vacío.'
    });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256']
    });

    req.user = {
      id_usuario: decoded.id_usuario,
      nombre_completo: decoded.nombre_completo,
      correo_institucional: decoded.correo_institucional,
      rol: decoded.rol
    };
    return next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      error: 'Sesión inválida o expirada. Por favor inicie sesión nuevamente.'
    });
  }
}

/**
 * Fabrica un middleware RBAC que autoriza unicamente a los roles explicitamente
 * listados. Si un token con rol 'PRODUCCION' invoca rutas clinicas de escritura
 * o auditoria Big Data, responde de inmediato con HTTP 403 Forbidden.
 * @param {...string} allowedRoles Lista de nombres de rol autorizados ('CLINICO', 'PRODUCCION').
 * @returns {import('express').RequestHandler} Middleware de autorizacion RBAC.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.rol) {
      return res.status(401).json({
        ok: false,
        error: 'Identidad de sesión no verificada.'
      });
    }

    if (!allowedRoles.includes(req.user.rol)) {
      return res.status(403).json({
        ok: false,
        error: `Acceso denegado (403 Forbidden): El perfil '${req.user.rol}' no posee privilegios para ejecutar esta operación clínica.`
      });
    }

    return next();
  };
}

module.exports = {
  verifyToken,
  requireRole
};
