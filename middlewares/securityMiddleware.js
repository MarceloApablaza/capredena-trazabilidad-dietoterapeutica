/**
 * @file middlewares/securityMiddleware.js
 * @description Implementa controles defensivos de ciberseguridad web bajo estandares
 * OWASP Top 10: cabeceras HTTP seguras (Helmet con CSP adaptado a Socket.IO local),
 * limitacion estricta de tasa contra fuerza bruta (Rate Limiting), politica CORS
 * restrictiva y funciones puras de sanitizacion contra Cross-Site Scripting (XSS).
 */

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');

/**
 * Configuracion de Helmet con Content-Security-Policy (CSP) ajustada para permitir
 * exclusivamente recursos propios ('self') y transporte bidireccional Socket.IO,
 * bloqueando inyecciones externas, iframes no autorizados y MIME sniffing.
 */
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Permite swagger-ui-express en /api/docs y scripts locales
      styleSrc: ["'self'", "'unsafe-inline'"],  // Permite swagger-ui-express en /api/docs y CSS local
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],    // Habilita canal WebSocket de baja latencia
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

/**
 * Politica CORS restrictiva: unicamente autoriza solicitudes same-origin
 * (mismo host), origenes institucionales locales o definidos en variables de entorno.
 */
const allowedOrigins = new Set([
  ...(env.CORS_ORIGINS || [env.CORS_ORIGIN]),
  `http://localhost:${env.PORT}`,
  `http://127.0.0.1:${env.PORT}`
]);

function createCorsOptionsDelegate(methods) {
  return (req, callback) => {
    const origin = req.headers.origin;
    const rawHost = req.headers['x-forwarded-host'] || req.headers.host || '';
    const host = String(rawHost).split(',')[0].trim();
    const isSameOrigin =
      Boolean(origin && host) &&
      (origin === `https://${host}` || origin === `http://${host}`);

    if (!origin || isSameOrigin || allowedOrigins.has(origin)) {
      return callback(null, {
        origin: true,
        methods,
        allowedHeaders: ['Content-Type', 'Authorization'],
        maxAge: 600
      });
    }

    const corsError = new Error('Origen no autorizado por la política de seguridad CORS.');
    corsError.statusCode = 403;
    return callback(corsError, { origin: false });
  };
}

const corsMiddleware = cors(createCorsOptionsDelegate(['GET', 'POST', 'PUT', 'PATCH']));
const socketCorsOptionsDelegate = createCorsOptionsDelegate(['GET', 'POST']);

/**
 * Limitador estricto de velocidad para POST /api/auth/login:
 * Maximo 5 peticiones por minuto por direccion IP contra ataques de fuerza bruta.
 */
const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Demasiados intentos de inicio de sesión. Por seguridad, espere 60 segundos antes de reintentar.'
  }
});

/**
 * Limitador general para rutas de la API RESTful (proteccion anti-DoS de capa 7).
 */
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Límite de solicitudes excedido temporalmente. Intente nuevamente en unos segundos.'
  }
});

/**
 * Escapa caracteres especiales HTML en cadenas de entrada para neutralizar vectores
 * de Cross-Site Scripting (XSS) almacenado o reflejado antes de persistir en SQL.
 * @param {*} rawValue Valor de entrada sin confiar proveniente del cliente.
 * @param {number} [maxLength=255] Longitud maxima permitida.
 * @returns {string} Cadena limpia, recortada y codificada de forma segura.
 */
function sanitizeText(rawValue, maxLength = 255) {
  if (rawValue === null || rawValue === undefined) {
    return '';
  }
  const clean = String(rawValue)
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '') // Remueve caracteres de control invisibles
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return clean.slice(0, maxLength);
}

/**
 * Valida y convierte un identificador numerico entero positivo de forma estricta.
 * @param {*} value Valor a validar.
 * @returns {number|null} Numero entero positivo valido o null si es invalido.
 */
function parsePositiveInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

module.exports = {
  helmetMiddleware,
  corsMiddleware,
  socketCorsOptionsDelegate,
  loginRateLimiter,
  apiRateLimiter,
  sanitizeText,
  parsePositiveInt
};
