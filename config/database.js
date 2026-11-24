/**
 * @file config/database.js
 * @description Gestiona la conexion relacional activa mediante better-sqlite3,
 * imponiendo integridad referencial al 100% (PRAGMA foreign_keys = ON), modo
 * concurrente WAL y creacion determinista de las 6 entidades en Tercera Forma
 * Normal (3FN) con soporte de transacciones atomicas ACID.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const env = require('./env');

// Asegura la existencia fisica del directorio /database antes de instanciar el motor
const dbDir = path.dirname(env.SQLITE_DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Instancia unica (Singleton) del motor relacional SQLite
const db = new Database(env.SQLITE_DB_PATH);

// Activacion innegociable de claves foraneas y optimizacion de concurrencia lectora/escritora
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

/**
 * Inicializa la estructura relacional exacta de 6 tablas en 3FN y sus indices
 * analiticos y de unicidad condicional de camas hospitalarias activas.
 * @returns {void}
 */
function initializeSchema() {
  db.exec(`
    -- 1. Tabla Roles: Control de Acceso Basado en Roles (RBAC)
    CREATE TABLE IF NOT EXISTS Roles (
      id_rol INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre_rol VARCHAR(50) NOT NULL UNIQUE CHECK (nombre_rol IN ('CLINICO', 'PRODUCCION')),
      descripcion_permisos VARCHAR(255) NOT NULL
    );

    -- 2. Tabla Usuarios: Credenciales institucionales con hash Bcrypt y token temporal
    CREATE TABLE IF NOT EXISTS Usuarios (
      id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
      id_rol INTEGER NOT NULL,
      nombre_completo VARCHAR(120) NOT NULL,
      correo_institucional VARCHAR(120) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      token_recuperacion VARCHAR(255) NULL,
      token_expiracion DATETIME NULL,
      fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      estado_activo INTEGER NOT NULL DEFAULT 1 CHECK (estado_activo IN (0, 1)),
      FOREIGN KEY (id_rol) REFERENCES Roles(id_rol) ON UPDATE CASCADE ON DELETE RESTRICT
    );

    -- 3. Tabla Regimenes: Catalogo maestro dietoterapeutico (3FN)
    CREATE TABLE IF NOT EXISTS Regimenes (
      id_regimen INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre_regimen VARCHAR(100) NOT NULL UNIQUE,
      restriccion_nutricional VARCHAR(255) NOT NULL
    );

    -- 4. Tabla Consistencias_IDDSI: Catalogo normativo internacional (Niveles 0 al 7)
    CREATE TABLE IF NOT EXISTS Consistencias_IDDSI (
      id_iddsi INTEGER PRIMARY KEY AUTOINCREMENT,
      nivel_iddsi INTEGER NOT NULL CHECK (nivel_iddsi BETWEEN 0 AND 7),
      nombre_oficial VARCHAR(100) NOT NULL,
      aplica_a_tipo VARCHAR(20) NOT NULL CHECK (aplica_a_tipo IN ('LIQUIDO', 'SOLIDO')),
      descripcion_clinica VARCHAR(255) NOT NULL,
      UNIQUE (nivel_iddsi, aplica_a_tipo)
    );

    -- 5. Tabla Pacientes: Censo hospitalario seudonimizado (Ley 19.628 / 20.584 / HIPAA)
    CREATE TABLE IF NOT EXISTS Pacientes (
      id_paciente INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo_ficha VARCHAR(30) NOT NULL UNIQUE,
      numero_sala INTEGER NOT NULL CHECK (numero_sala >= 1),
      numero_cama INTEGER NOT NULL CHECK (numero_cama >= 1),
      id_regimen_actual INTEGER NOT NULL,
      id_iddsi_solido INTEGER NOT NULL,
      id_iddsi_liquido INTEGER NOT NULL,
      observacion_alergias VARCHAR(255) NOT NULL DEFAULT '',
      estado_hospitalizado INTEGER NOT NULL DEFAULT 1 CHECK (estado_hospitalizado IN (0, 1)),
      ultima_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (id_regimen_actual) REFERENCES Regimenes(id_regimen) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (id_iddsi_solido) REFERENCES Consistencias_IDDSI(id_iddsi) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (id_iddsi_liquido) REFERENCES Consistencias_IDDSI(id_iddsi) ON UPDATE CASCADE ON DELETE RESTRICT
    );

    -- Regla de negocio fisica: Dos pacientes activos (estado_hospitalizado = 1) NO pueden compartir Sala + Cama
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pacientes_cama_unica_activa
      ON Pacientes (numero_sala, numero_cama)
      WHERE estado_hospitalizado = 1;

    -- Indice optimizado por estado_hospitalizado y ubicacion (numero_sala, numero_cama)
    CREATE INDEX IF NOT EXISTS idx_pacientes_estado_ubicacion
      ON Pacientes (estado_hospitalizado, numero_sala, numero_cama);

    -- 6. Tabla Historial_Minutas: Tabla de Hechos Transaccional e Inmutable para Big Data
    CREATE TABLE IF NOT EXISTS Historial_Minutas (
      id_historial INTEGER PRIMARY KEY AUTOINCREMENT,
      id_paciente INTEGER NOT NULL,
      id_usuario_autor INTEGER NOT NULL,
      id_regimen_asignado INTEGER NOT NULL,
      id_iddsi_solido_asignado INTEGER NOT NULL,
      id_iddsi_liquido_asignado INTEGER NOT NULL,
      tipo_movimiento VARCHAR(50) NOT NULL CHECK (tipo_movimiento IN ('INGRESO', 'MODIFICACION', 'ALTA')),
      detalle_clinico VARCHAR(255) NULL,
      fecha_hora_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (id_paciente) REFERENCES Pacientes(id_paciente) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (id_usuario_autor) REFERENCES Usuarios(id_usuario) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (id_regimen_asignado) REFERENCES Regimenes(id_regimen) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (id_iddsi_solido_asignado) REFERENCES Consistencias_IDDSI(id_iddsi) ON UPDATE CASCADE ON DELETE RESTRICT,
      FOREIGN KEY (id_iddsi_liquido_asignado) REFERENCES Consistencias_IDDSI(id_iddsi) ON UPDATE CASCADE ON DELETE RESTRICT
    );

    -- Indices compuestos no agrupados para consultas analiticas Big Data y alertas tempranas 24h
    CREATE INDEX IF NOT EXISTS idx_historial_fecha
      ON Historial_Minutas (fecha_hora_registro);

    CREATE INDEX IF NOT EXISTS idx_historial_analitica_dietas
      ON Historial_Minutas (id_regimen_asignado, id_iddsi_solido_asignado, id_iddsi_liquido_asignado);
  `);
}

/**
 * Ejecuta una operacion clinica compuesta dentro de una transaccion ACID explicita
 * (BEGIN IMMEDIATE TRANSACTION -> COMMIT, o ROLLBACK automatico ante cualquier fallo).
 * @param {Function} workFn Funcion sincrona que agrupa las sentencias parametrizadas.
 * @returns {*} Resultado retornado por workFn tras confirmar el COMMIT.
 */
function runInTransaction(workFn) {
  const transactionalExecution = db.transaction(workFn);
  return transactionalExecution.immediate();
}

// Garantiza que el esquema 3FN exista desde el momento en que se importa el modulo
initializeSchema();

module.exports = {
  db,
  initializeSchema,
  runInTransaction
};
