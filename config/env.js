/**
 * @file config/env.js
 * @description Centraliza la carga y validacion de las variables de entorno del
 * Sistema Web de Trazabilidad Dietoterapeutica CAPREDENA Limache.
 * Garantiza valores seguros por defecto para ejecucion inmediata en desarrollo
 * y parametros clinicos estandarizados para proyeccion de insumos nutricionales.
 */

const path = require('path');
const dotenv = require('dotenv');

// Carga las variables definidas en el archivo .env ubicado en la raiz del proyecto
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * Objeto inmutable de configuracion global de la aplicacion.
 * Incluye parametros de red, criptografia JWT, persistencia SQL y dosificacion IDDSI.
 */
const env = Object.freeze({
  // Puerto HTTP de escucha del servidor Express + Socket.IO
  PORT: parseInt(process.env.PORT || '3000', 10),

  // Entorno de ejecucion ('development', 'test' o 'production')
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Secreto simetrico de alta entropia para firmar tokens JWT (HS256)
  JWT_SECRET:
    process.env.JWT_SECRET ||
    'CAPREDENA_LIMACHE_2026_ULTRA_SECURE_CLINICAL_KEY_9f8a7b6c5d4e3f2a1b',

  // Tiempo de vigencia del token JWT emitido tras autenticacion exitosa
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',

  // Dosificacion clinica estandar de espesante comercial para IDDSI Nivel 2 (Poco Espeso)
  GRAMOS_ESPESANTE_POR_RACION: parseFloat(
    process.env.GRAMOS_ESPESANTE_POR_RACION || '2.4'
  ),

  // Numero de servicios diarios de hidratacion asistida por paciente con disfagia a liquidos
  SERVICIOS_HIDRATACION_DIARIOS: parseInt(
    process.env.SERVICIOS_HIDRATACION_DIARIOS || '4',
    10
  ),

  // Ruta absoluta hacia el archivo relacional SQLite en Tercera Forma Normal (3FN)
  SQLITE_DB_PATH: path.resolve(
    __dirname,
    '..',
    process.env.SQLITE_DB_PATH || './database/capredena_trazabilidad.sqlite'
  ),

  // Origenes autorizados por la politica restrictiva de Cross-Origin Resource Sharing (CORS)
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3000',
  CORS_ORIGINS: [
    ...(process.env.CORS_ORIGIN || 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    ...(process.env.RAILWAY_PUBLIC_DOMAIN
      ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`]
      : []),
    ...(process.env.RENDER_EXTERNAL_URL ? [process.env.RENDER_EXTERNAL_URL] : [])
  ],

  // Capacidad fisica institucional: 4 salas de hospitalizacion con 20 camas cada una (80 camas)
  SALAS_TOTALES: [1, 2, 3, 4],
  CAMAS_POR_SALA: 20,

  // Configuracion opcional de servidor de correo institucional SMTP
  SMTP_CONFIGURADO: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER)
});

module.exports = env;
