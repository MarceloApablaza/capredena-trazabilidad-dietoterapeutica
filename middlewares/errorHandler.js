/**
 * @file middlewares/errorHandler.js
 * @description Manejador global centralizado de errores para Express.js.
 * Previene la fuga de trazas internas del motor SQL, rutas del sistema de archivos
 * o detalles de implementacion (OWASP Security Misconfiguration), devolviendo un
 * mensaje generico 500 Internal Server Error ante excepciones no controladas.
 */

/**
 * Clase auxiliar para errores de negocio controlados con codigo HTTP explicito
 * (por ejemplo 400 Bad Request, 404 Not Found o 409 Conflict).
 */
class AppError extends Error {
  /**
   * @param {string} message Mensaje seguro apto para mostrar al usuario final.
   * @param {number} [statusCode=400] Codigo de estado HTTP estandar.
   */
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

/**
 * Middleware final de captura de errores en la tuberia Express.
 * @param {Error} err Excepcion capturada.
 * @param {import('express').Request} req Solicitud HTTP.
 * @param {import('express').Response} res Respuesta HTTP.
 * @param {import('express').NextFunction} _next Siguiente middleware (requerido por firma Express).
 */
function errorHandler(err, req, res, _next) {
  // Si es un error operativo controlado (validacion o conflicto de negocio), expone mensaje limpio
  if (err && err.isOperational && err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({
      ok: false,
      error: err.message
    });
  }

  // Manejo de JSON malformado en el cuerpo de la peticion
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      ok: false,
      error: 'El cuerpo JSON enviado tiene un formato sintáctico inválido.'
    });
  }

  // Registro interno seguro en consola del servidor sin filtrar detalles SQL al cliente HTTP
  console.error(
    `[ERROR INTERNO ${new Date().toISOString()}] ${req.method} ${req.originalUrl}:`,
    err && err.message ? err.message : 'Excepción desconocida'
  );

  return res.status(500).json({
    ok: false,
    error: '500 Internal Server Error: Ha ocurrido un error interno inesperado. Contacte al administrador.'
  });
}

module.exports = {
  AppError,
  errorHandler
};
