-- =============================================================================
-- PROYECTO DE TITULO: SISTEMA WEB DE TRAZABILIDAD DIETOTERAPEUTICA Y ALERTAS
-- CLINICAS TEMPRANAS PARA PACIENTES INSTITUCIONALIZADOS (CAPREDENA LIMACHE)
-- =============================================================================
-- Archivo: database/schema_produccion_sql.sql
-- Normalizacion: Tercera Forma Normal Estricta (3FN) - 6 Entidades Relacionales
-- Compatibilidad: MySQL 8.0+ / MariaDB 10.6+ (con notas equivalentes T-SQL)
-- Normativa: Ley 19.628, Ley 20.584 (Chile), HIPAA (Seudonimizacion Clinica)
--            y Marco Internacional IDDSI (Niveles 0 al 7)
-- =============================================================================

-- Configuracion inicial de codificacion UTF-8 y motor transaccional InnoDB
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Eliminacion ordenada de tablas previas para despliegues limpios en PaaS/VPS
DROP TABLE IF EXISTS Historial_Minutas;
DROP TABLE IF EXISTS Pacientes;
DROP TABLE IF EXISTS Consistencias_IDDSI;
DROP TABLE IF EXISTS Regimenes;
DROP TABLE IF EXISTS Usuarios;
DROP TABLE IF EXISTS Roles;

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- 1. ENTIDAD: Roles
-- Define el control de acceso basado en roles (RBAC) separando estrictamente
-- la prescripcion clinica (lectura/escritura) de la cocina (solo lectura).
-- =============================================================================
CREATE TABLE Roles (
    id_rol INT AUTO_INCREMENT PRIMARY KEY,
    nombre_rol VARCHAR(50) NOT NULL UNIQUE,
    descripcion_permisos VARCHAR(255) NOT NULL,
    CONSTRAINT chk_roles_validos CHECK (nombre_rol IN ('CLINICO', 'PRODUCCION'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 2. ENTIDAD: Usuarios
-- Almacena las credenciales institucionales protegidas con hash Bcrypt (>=10
-- rondas con salt dinamico) y soporte temporal para recuperacion por token.
-- =============================================================================
CREATE TABLE Usuarios (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    id_rol INT NOT NULL,
    nombre_completo VARCHAR(120) NOT NULL,
    correo_institucional VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    token_recuperacion VARCHAR(255) NULL,
    token_expiracion DATETIME NULL,
    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado_activo BOOLEAN NOT NULL DEFAULT 1,
    CONSTRAINT fk_usuarios_rol FOREIGN KEY (id_rol)
        REFERENCES Roles(id_rol)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 3. ENTIDAD: Regimenes
-- Catalogo maestro dietoterapeutico libre de redundancias (3FN), desacoplando
-- la denominacion clinica y sus restricciones metabolicas del censo activo.
-- =============================================================================
CREATE TABLE Regimenes (
    id_regimen INT AUTO_INCREMENT PRIMARY KEY,
    nombre_regimen VARCHAR(100) NOT NULL UNIQUE,
    restriccion_nutricional VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 4. ENTIDAD: Consistencias_IDDSI
-- Catalogo normativo internacional IDDSI (International Dysphagia Diet
-- Standardisation Initiative) para liquidos (0-4) y solidos (3-7).
-- =============================================================================
CREATE TABLE Consistencias_IDDSI (
    id_iddsi INT AUTO_INCREMENT PRIMARY KEY,
    nivel_iddsi INT NOT NULL,
    nombre_oficial VARCHAR(100) NOT NULL,
    aplica_a_tipo VARCHAR(20) NOT NULL,
    descripcion_clinica VARCHAR(255) NOT NULL,
    CONSTRAINT chk_nivel_iddsi CHECK (nivel_iddsi BETWEEN 0 AND 7),
    CONSTRAINT chk_tipo_iddsi CHECK (aplica_a_tipo IN ('LIQUIDO', 'SOLIDO')),
    CONSTRAINT uq_nivel_tipo_iddsi UNIQUE (nivel_iddsi, aplica_a_tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- 5. ENTIDAD: Pacientes
-- Censo hospitalario activo seudonimizado mediante codigo_ficha (sin RUT ni
-- nombre civil sensible). Mantiene el estado vigente y ubicacion fisica.
-- Regla de negocio: En capa transaccional (y trigger/indice filtrado en SQL
-- Server: WHERE estado_hospitalizado = 1) se impide duplicar sala + cama activa.
-- =============================================================================
CREATE TABLE Pacientes (
    id_paciente INT AUTO_INCREMENT PRIMARY KEY,
    codigo_ficha VARCHAR(30) NOT NULL UNIQUE,
    numero_sala INT NOT NULL,
    numero_cama INT NOT NULL,
    id_regimen_actual INT NOT NULL,
    id_iddsi_solido INT NOT NULL,
    id_iddsi_liquido INT NOT NULL,
    observacion_alergias VARCHAR(255) NOT NULL DEFAULT '',
    estado_hospitalizado BOOLEAN NOT NULL DEFAULT 1,
    ultima_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_paciente_regimen FOREIGN KEY (id_regimen_actual)
        REFERENCES Regimenes(id_regimen)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_paciente_iddsi_solido FOREIGN KEY (id_iddsi_solido)
        REFERENCES Consistencias_IDDSI(id_iddsi)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_paciente_iddsi_liquido FOREIGN KEY (id_iddsi_liquido)
        REFERENCES Consistencias_IDDSI(id_iddsi)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indice compuesto optimizado para consultas de censo activo y mapa de camas
CREATE INDEX idx_pacientes_censo_ubicacion
    ON Pacientes (estado_hospitalizado, numero_sala, numero_cama);

-- =============================================================================
-- 6. ENTIDAD: Historial_Minutas
-- Tabla de Hechos Transaccional e Inmutable orientada a Big Data Clinico y
-- trazabilidad medico-legal. Nunca elimina ni sobrescribe eventos previos.
-- =============================================================================
CREATE TABLE Historial_Minutas (
    id_historial BIGINT AUTO_INCREMENT PRIMARY KEY,
    id_paciente INT NOT NULL,
    id_usuario_autor INT NOT NULL,
    id_regimen_asignado INT NOT NULL,
    id_iddsi_solido_asignado INT NOT NULL,
    id_iddsi_liquido_asignado INT NOT NULL,
    tipo_movimiento VARCHAR(50) NOT NULL,
    detalle_clinico VARCHAR(255) NULL,
    fecha_hora_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_tipo_movimiento CHECK (tipo_movimiento IN ('INGRESO', 'MODIFICACION', 'ALTA')),
    CONSTRAINT fk_historial_paciente FOREIGN KEY (id_paciente)
        REFERENCES Pacientes(id_paciente)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_historial_autor FOREIGN KEY (id_usuario_autor)
        REFERENCES Usuarios(id_usuario)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_historial_regimen FOREIGN KEY (id_regimen_asignado)
        REFERENCES Regimenes(id_regimen)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_historial_iddsi_solido FOREIGN KEY (id_iddsi_solido_asignado)
        REFERENCES Consistencias_IDDSI(id_iddsi)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_historial_iddsi_liquido FOREIGN KEY (id_iddsi_liquido_asignado)
        REFERENCES Consistencias_IDDSI(id_iddsi)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indices compuestos no agrupados para analitica Big Data y alertas 24 horas
CREATE INDEX idx_historial_fecha_registro
    ON Historial_Minutas (fecha_hora_registro);

CREATE INDEX idx_historial_analitica_prescripcion
    ON Historial_Minutas (id_regimen_asignado, id_iddsi_solido_asignado, id_iddsi_liquido_asignado);

-- =============================================================================
-- POBLADO BASE NORMATIVO PARA PRODUCCION (ROLES, REGIMENES E IDDSI OFICIAL)
-- =============================================================================
INSERT INTO Roles (nombre_rol, descripcion_permisos) VALUES
('CLINICO', 'Nutricionista Clinico: Lectura y escritura completa de censo, prescripciones IDDSI, altas y auditoria Big Data.'),
('PRODUCCION', 'Central de Alimentacion / Cocina: Acceso exclusivo de solo lectura a dashboard en vivo, mapa de salas y alertas 24h.');

INSERT INTO Regimenes (nombre_regimen, restriccion_nutricional) VALUES
('Liviano Hiposódico', 'Bajo aporte de grasas saturadas, sin irritantes mucosos y restriccion estricta de sodio (< 2000 mg/dia).'),
('Diabético Liviano', 'Control estricto de carbohidratos de absorcion rapida, fraccionamiento horario y seleccion lipidica saludable.'),
('Diabético Liviano Hiperproteico', 'Control glucemico estricto con refuerzo proteico de alto valor biologico para prevencion de sarcopenia.'),
('Común', 'Alimentacion institucional equilibrada sin restricciones metabolicas especificas.'),
('Común Hiperproteico', 'Regimen completo enriquecido en proteinas (1.2 - 1.5 g/kg/dia) para recuperacion tisular y funcional.'),
('Renal Hiposódico', 'Control simultaneo de sodio, potasio, fosforo y carga proteica ajustada a funcion glomerular.'),
('Blando Gástrico', 'Proteccion gastrica mecanica y quimica, libre de condimentos irritantes, fibra insoluble cruda y frituras.');

INSERT INTO Consistencias_IDDSI (nivel_iddsi, nombre_oficial, aplica_a_tipo, descripcion_clinica) VALUES
(0, 'Fino (Líquido Normal)', 'LIQUIDO', 'Fluye como el agua a traves de jeringa IDDSI sin dejar residuo (< 1 ml a los 10 s).'),
(1, 'Ligeramente Espeso', 'LIQUIDO', 'Mas espeso que el agua; deja entre 1 y 4 ml en prueba de flujo con jeringa IDDSI.'),
(2, 'Poco Espeso', 'LIQUIDO', 'Fluye rapidamente de la cuchara pero mas lento que liquido fino; residuo 4 a 8 ml en jeringa IDDSI.'),
(3, 'Moderadamente Espeso', 'LIQUIDO', 'Puede beberse en vaso o tomarse con cuchara; residuo >= 8 ml en prueba de jeringa IDDSI.'),
(4, 'Extremadamente Espeso', 'LIQUIDO', 'Se administra con cuchara, mantiene su forma en el plato y no requiere masticacion ni fluye por pajita.'),
(3, 'Licuado', 'SOLIDO', 'Alimento solido procesado a textura fluida suave uniforme, sin grumos, hebras ni semillas.'),
(4, 'Puré / Papilla Homogénea', 'SOLIDO', 'Suave, cohesivo y humedo, sin grumos ni separacion de liquido; no requiere masticacion.'),
(5, 'Picado y Húmedo', 'SOLIDO', 'Trozos blandos y muy humedos de max. 4 mm en adultos; minima masticacion requerida.'),
(6, 'Blando y Tamaño Bocado', 'SOLIDO', 'Trozos tiernos de max. 15 mm x 15 mm que se aplastan facilmente con presion de tenedor.'),
(7, 'Normal / Fácil de Masticar', 'SOLIDO', 'Textura cotidiana suave o estandar para pacientes sin alteracion de la seguridad deglutoria.');

-- =============================================================================
-- NOTA DE EQUIVALENCIA MICROSOFT SQL SERVER (T-SQL):
-- En MS SQL Server reemplazar AUTO_INCREMENT por IDENTITY(1,1), BOOLEAN por BIT,
-- eliminar ENGINE=InnoDB y agregar indice unico filtrado para camas activas:
-- CREATE UNIQUE NONCLUSTERED INDEX uq_cama_activa_tsql
-- ON Pacientes(numero_sala, numero_cama) WHERE estado_hospitalizado = 1;
-- =============================================================================
