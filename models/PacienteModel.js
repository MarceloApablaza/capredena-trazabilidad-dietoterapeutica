/**
 * @file models/PacienteModel.js
 * @description Capa Modelo (MVC) que gobierna el ciclo de vida clinico de la entidad
 * Pacientes y su trazabilidad atomica inmutable en Historial_Minutas.
 * Implementa las 3 operaciones CRUD transaccionales con integridad ACID:
 *  1. Ingreso hospitalario (validando disponibilidad fisica de Sala + Cama)
 *  2. Modificacion dietoterapeutica e IDDSI (validando coherencia Solido vs Liquido)
 *  3. Alta clinica (liberacion inmediata de cama preservando Big Data historico)
 */

const { db, runInTransaction } = require('../config/database');
const env = require('../config/env');
const CatalogoModel = require('./CatalogoModel');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Genera el timestamp actual en formato UTC compatible con funciones nativas SQLite.
 * @returns {string} Fecha y hora UTC ('YYYY-MM-DD HH:MM:SS').
 */
function nowUtcSqlite() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// =============================================================================
// SENTENCIAS SQL PARAMETRIZADAS PRECOMPILADAS (PROTECCION 100% ANTI-SQLi)
// =============================================================================
// 1. Consulta 3FN del censo activo cruzando Regimenes y doble JOIN a Consistencias_IDDSI
//    para resolver en una sola lectura el nivel solido (3-7) y el nivel liquido (0-4).
const stmtCensoActivo = db.prepare(`
  SELECT
    p.id_paciente,
    p.codigo_ficha,
    p.numero_sala,
    p.numero_cama,
    p.id_regimen_actual,
    r.nombre_regimen,
    r.restriccion_nutricional,
    p.id_iddsi_solido,
    sol.nivel_iddsi AS nivel_iddsi_solido,
    sol.nombre_oficial AS nombre_iddsi_solido,
    p.id_iddsi_liquido,
    liq.nivel_iddsi AS nivel_iddsi_liquido,
    liq.nombre_oficial AS nombre_iddsi_liquido,
    p.observacion_alergias,
    p.estado_hospitalizado,
    p.ultima_actualizacion,
    CASE
      WHEN sol.nivel_iddsi < 7 OR liq.nivel_iddsi > 0 THEN 1
      ELSE 0
    END AS tiene_disfagia
  FROM Pacientes p
  INNER JOIN Regimenes r ON r.id_regimen = p.id_regimen_actual
  INNER JOIN Consistencias_IDDSI sol ON sol.id_iddsi = p.id_iddsi_solido
  INNER JOIN Consistencias_IDDSI liq ON liq.id_iddsi = p.id_iddsi_liquido
  WHERE p.estado_hospitalizado = 1
  ORDER BY p.numero_sala ASC, p.numero_cama ASC
`);

// 2. Consulta puntual de un paciente por su clave primaria (id_paciente) incluyendo
//    tanto pacientes vigentes como egresados para auditoria post-transaccional.
const stmtPacienteDetallePorId = db.prepare(`
  SELECT
    p.id_paciente,
    p.codigo_ficha,
    p.numero_sala,
    p.numero_cama,
    p.id_regimen_actual,
    r.nombre_regimen,
    p.id_iddsi_solido,
    sol.nivel_iddsi AS nivel_iddsi_solido,
    sol.nombre_oficial AS nombre_iddsi_solido,
    p.id_iddsi_liquido,
    liq.nivel_iddsi AS nivel_iddsi_liquido,
    liq.nombre_oficial AS nombre_iddsi_liquido,
    p.observacion_alergias,
    p.estado_hospitalizado,
    p.ultima_actualizacion
  FROM Pacientes p
  INNER JOIN Regimenes r ON r.id_regimen = p.id_regimen_actual
  INNER JOIN Consistencias_IDDSI sol ON sol.id_iddsi = p.id_iddsi_solido
  INNER JOIN Consistencias_IDDSI liq ON liq.id_iddsi = p.id_iddsi_liquido
  WHERE p.id_paciente = ?
`);

// 3. Verificacion transaccional de regla de negocio hospitalaria:
//    Ningun par (numero_sala, numero_cama) puede ser ocupado por dos pacientes activos.
const stmtCamaOcupada = db.prepare(`
  SELECT id_paciente, codigo_ficha
  FROM Pacientes
  WHERE numero_sala = ? AND numero_cama = ? AND estado_hospitalizado = 1
  LIMIT 1
`);

// 4. Verificacion insensible a mayusculas/minusculas de unicidad de codigo_ficha
//    seudonimizado (cumplimiento normativo Ley 19.628, Ley 20.584 e HIPAA).
const stmtFichaExistente = db.prepare(`
  SELECT id_paciente, estado_hospitalizado
  FROM Pacientes
  WHERE LOWER(codigo_ficha) = LOWER(?)
  LIMIT 1
`);

// 5. Conteo global de identidades registradas para sugerir el siguiente correlativo libre.
const stmtTotalPacientesHistoricos = db.prepare(`
  SELECT COUNT(*) AS total FROM Pacientes
`);

// 6. Insercion parametrizada de nuevo ingreso con estado_hospitalizado = 1 por defecto.
const stmtInsertPaciente = db.prepare(`
  INSERT INTO Pacientes (
    codigo_ficha, numero_sala, numero_cama,
    id_regimen_actual, id_iddsi_solido, id_iddsi_liquido,
    observacion_alergias, estado_hospitalizado, ultima_actualizacion
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
`);

// 7. Actualizacion parametrizada de prescripcion dietoterapeutica y texturas IDDSI.
const stmtUpdateMinutaPaciente = db.prepare(`
  UPDATE Pacientes
  SET id_regimen_actual = ?,
      id_iddsi_solido = ?,
      id_iddsi_liquido = ?,
      observacion_alergias = ?,
      ultima_actualizacion = ?
  WHERE id_paciente = ? AND estado_hospitalizado = 1
`);

// 8. Baja logica clinica (estado_hospitalizado = 0): libera la cama fisica de inmediato
//    preservando intacto el registro maestro para integridad referencial en Big Data.
const stmtAltaPaciente = db.prepare(`
  UPDATE Pacientes
  SET estado_hospitalizado = 0,
      ultima_actualizacion = ?
  WHERE id_paciente = ? AND estado_hospitalizado = 1
`);

// 9. Escritura inmutable en la Tabla de Hechos Historial_Minutas (INGRESO, MODIFICACION, ALTA).
const stmtInsertHistorial = db.prepare(`
  INSERT INTO Historial_Minutas (
    id_paciente, id_usuario_autor, id_regimen_asignado,
    id_iddsi_solido_asignado, id_iddsi_liquido_asignado,
    tipo_movimiento, detalle_clinico, fecha_hora_registro
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Valida la existencia y coherencia clinica del regimen y de los niveles IDDSI
 * seleccionados (impidiendo asignar un nivel LIQUIDO en el campo SOLIDO o viceversa).
 * @param {number} idRegimen Clave foranea de Regimenes.
 * @param {number} idSolido Clave foranea de Consistencias_IDDSI (SOLIDO).
 * @param {number} idLiquido Clave foranea de Consistencias_IDDSI (LIQUIDO).
 * @returns {{ regimen: Object, solido: Object, liquido: Object }} Entidades validadas.
 */
function validarPrescripcionDietoterapeutica(idRegimen, idSolido, idLiquido) {
  const regimen = CatalogoModel.getRegimenById(idRegimen);
  if (!regimen) {
    throw new AppError('El régimen dietoterapéutico seleccionado no existe en el catálogo.', 400);
  }

  const solido = CatalogoModel.getConsistenciaById(idSolido);
  if (!solido || solido.aplica_a_tipo !== 'SOLIDO') {
    throw new AppError(
      'Incoherencia normativa IDDSI: La consistencia sólida debe corresponder al catálogo SOLIDO (Niveles 3 al 7).',
      400
    );
  }

  const liquido = CatalogoModel.getConsistenciaById(idLiquido);
  if (!liquido || liquido.aplica_a_tipo !== 'LIQUIDO') {
    throw new AppError(
      'Incoherencia normativa IDDSI: La consistencia líquida debe corresponder al catálogo LIQUIDO (Niveles 0 al 4).',
      400
    );
  }

  return { regimen, solido, liquido };
}

const PacienteModel = {
  /**
   * Retorna el censo activo completo en 3FN junto con la matriz de camas libres
   * por sala, catalogos maestros y sugerencia del siguiente codigo_ficha seudonimizado.
   * @returns {Object} Objeto integral para el modulo clinico y consulta de camas.
   */
  getCensoCompletoConDisponibilidad() {
    const pacientes = stmtCensoActivo.all();
    const ocupacionSet = new Set(
      pacientes.map((p) => `${p.numero_sala}-${p.numero_cama}`)
    );

    const camasLibresPorSala = {};
    let totalCamasLibres = 0;

    for (const sala of env.SALAS_TOTALES) {
      camasLibresPorSala[sala] = [];
      for (let cama = 1; cama <= env.CAMAS_POR_SALA; cama++) {
        if (!ocupacionSet.has(`${sala}-${cama}`)) {
          camasLibresPorSala[sala].push(cama);
          totalCamasLibres++;
        }
      }
    }

    // Genera sugerencia secuencial del siguiente codigo libre a partir del censo activo
    // (en el escenario base de 70 pacientes sugiere exactamente 'Pac. #071' para CP04).
    let correlativo = pacientes.length + 1;
    let codigoSugerido = `Pac. #${String(correlativo).padStart(3, '0')}`;
    while (stmtFichaExistente.get(codigoSugerido)) {
      correlativo++;
      codigoSugerido = `Pac. #${String(correlativo).padStart(3, '0')}`;
    }

    return {
      total_activos: pacientes.length,
      total_camas_institucionales: env.SALAS_TOTALES.length * env.CAMAS_POR_SALA,
      total_camas_libres: totalCamasLibres,
      codigo_ficha_sugerido: codigoSugerido,
      camas_libres_por_sala: camasLibresPorSala,
      catalogos: {
        regimenes: CatalogoModel.getRegimenes(),
        consistencias_iddsi: CatalogoModel.getConsistenciasIddsi()
      },
      pacientes
    };
  },

  /**
   * CRUD #1: Registra un nuevo ingreso hospitalario verificando disponibilidad de cama
   * y escribiendo atomicamente el hecho 'INGRESO' en Historial_Minutas.
   * @param {Object} datos Campos validados del ingreso.
   * @param {number} idUsuarioAutor Identificador del Nutricionista Clinico autenticado.
   * @returns {Object} Paciente recien ingresado y metadatos del evento emitido.
   */
  crearIngreso(datos, idUsuarioAutor) {
    return runInTransaction(() => {
      const {
        codigo_ficha,
        numero_sala,
        numero_cama,
        id_regimen_actual,
        id_iddsi_solido,
        id_iddsi_liquido,
        observacion_alergias
      } = datos;

      if (
        !env.SALAS_TOTALES.includes(numero_sala) ||
        numero_cama < 1 ||
        numero_cama > env.CAMAS_POR_SALA
      ) {
        throw new AppError(
          `Ubicación inválida: CAPREDENA Limache dispone de Salas 1 a 4 y Camas 1 a ${env.CAMAS_POR_SALA}.`,
          400
        );
      }

      const ocupante = stmtCamaOcupada.get(numero_sala, numero_cama);
      if (ocupante) {
        throw new AppError(
          `Conflicto de ubicación: La Sala ${numero_sala}, Cama ${numero_cama} ya se encuentra ocupada por ${ocupante.codigo_ficha}.`,
          409
        );
      }

      const fichaPrevia = stmtFichaExistente.get(codigo_ficha);
      if (fichaPrevia) {
        throw new AppError(
          `El código de ficha '${codigo_ficha}' ya se encuentra registrado en el sistema.`,
          409
        );
      }

      const { regimen, solido, liquido } = validarPrescripcionDietoterapeutica(
        id_regimen_actual,
        id_iddsi_solido,
        id_iddsi_liquido
      );

      const timestamp = nowUtcSqlite();
      const resultadoInsert = stmtInsertPaciente.run(
        codigo_ficha,
        numero_sala,
        numero_cama,
        id_regimen_actual,
        id_iddsi_solido,
        id_iddsi_liquido,
        observacion_alergias,
        timestamp
      );

      const idPaciente = Number(resultadoInsert.lastInsertRowid);
      const detalleClinico =
        `Ingreso hospitalario Sala ${numero_sala} Cama ${numero_cama}: ` +
        `${regimen.nombre_regimen} | Sólido IDDSI ${solido.nivel_iddsi} (${solido.nombre_oficial}) | ` +
        `Líquido IDDSI ${liquido.nivel_iddsi} (${liquido.nombre_oficial}).`;

      const histInfo = stmtInsertHistorial.run(
        idPaciente,
        idUsuarioAutor,
        id_regimen_actual,
        id_iddsi_solido,
        id_iddsi_liquido,
        'INGRESO',
        detalleClinico.slice(0, 255),
        timestamp
      );

      const pacienteCreado = stmtPacienteDetallePorId.get(idPaciente);
      return {
        paciente: pacienteCreado,
        evento: {
          id_historial: Number(histInfo.lastInsertRowid),
          tipo_movimiento: 'INGRESO',
          codigo_ficha: pacienteCreado.codigo_ficha,
          numero_sala: pacienteCreado.numero_sala,
          numero_cama: pacienteCreado.numero_cama,
          nombre_regimen: pacienteCreado.nombre_regimen,
          nivel_iddsi_solido: pacienteCreado.nivel_iddsi_solido,
          nombre_iddsi_solido: pacienteCreado.nombre_iddsi_solido,
          nivel_iddsi_liquido: pacienteCreado.nivel_iddsi_liquido,
          nombre_iddsi_liquido: pacienteCreado.nombre_iddsi_liquido,
          detalle_clinico: detalleClinico.slice(0, 255),
          fecha_hora_registro: timestamp
        }
      };
    });
  },

  /**
   * CRUD #2: Actualiza la prescripcion dietoterapeutica e IDDSI de un paciente activo
   * e inserta atomicamente un hecho 'MODIFICACION' en Historial_Minutas.
   * @param {number} idPaciente Identificador primario del paciente.
   * @param {Object} datos Nuevos parametros nutricionales e IDDSI.
   * @param {number} idUsuarioAutor Identificador del Nutricionista Clinico.
   * @returns {Object} Paciente actualizado y metadatos del evento para WebSockets.
   */
  actualizarMinuta(idPaciente, datos, idUsuarioAutor) {
    return runInTransaction(() => {
      const actual = stmtPacienteDetallePorId.get(idPaciente);
      if (!actual) {
        throw new AppError('El paciente indicado no existe en el registro clínico.', 404);
      }
      if (!actual.estado_hospitalizado) {
        throw new AppError(
          `No es posible modificar la minuta de ${actual.codigo_ficha} porque ya cuenta con alta clínica.`,
          409
        );
      }

      const {
        id_regimen_actual,
        id_iddsi_solido,
        id_iddsi_liquido,
        observacion_alergias,
        motivo_cambio
      } = datos;

      const { regimen, solido, liquido } = validarPrescripcionDietoterapeutica(
        id_regimen_actual,
        id_iddsi_solido,
        id_iddsi_liquido
      );

      const timestamp = nowUtcSqlite();
      stmtUpdateMinutaPaciente.run(
        id_regimen_actual,
        id_iddsi_solido,
        id_iddsi_liquido,
        observacion_alergias,
        timestamp,
        idPaciente
      );

      const resumenAutomatico =
        `Prescripción actualizada (Sala ${actual.numero_sala} Cama ${actual.numero_cama}): ` +
        `${regimen.nombre_regimen}, Sólido IDDSI ${solido.nivel_iddsi} (${solido.nombre_oficial}), ` +
        `Líquido IDDSI ${liquido.nivel_iddsi} (${liquido.nombre_oficial}).`;

      const detalleFinal = motivo_cambio
        ? `${motivo_cambio} — ${resumenAutomatico}`
        : resumenAutomatico;

      const histInfo = stmtInsertHistorial.run(
        idPaciente,
        idUsuarioAutor,
        id_regimen_actual,
        id_iddsi_solido,
        id_iddsi_liquido,
        'MODIFICACION',
        detalleFinal.slice(0, 255),
        timestamp
      );

      const pacienteActualizado = stmtPacienteDetallePorId.get(idPaciente);
      return {
        paciente: pacienteActualizado,
        evento: {
          id_historial: Number(histInfo.lastInsertRowid),
          tipo_movimiento: 'MODIFICACION',
          codigo_ficha: pacienteActualizado.codigo_ficha,
          numero_sala: pacienteActualizado.numero_sala,
          numero_cama: pacienteActualizado.numero_cama,
          nombre_regimen: pacienteActualizado.nombre_regimen,
          nivel_iddsi_solido: pacienteActualizado.nivel_iddsi_solido,
          nombre_iddsi_solido: pacienteActualizado.nombre_iddsi_solido,
          nivel_iddsi_liquido: pacienteActualizado.nivel_iddsi_liquido,
          nombre_iddsi_liquido: pacienteActualizado.nombre_iddsi_liquido,
          detalle_clinico: detalleFinal.slice(0, 255),
          fecha_hora_registro: timestamp
        }
      };
    });
  },

  /**
   * CRUD #3: Ejecuta el alta clinica cambiando estado_hospitalizado = 0 para liberar
   * la cama fisicamente sin eliminar la identidad historica, registrando 'ALTA' en Big Data.
   * @param {number} idPaciente Identificador primario del paciente.
   * @param {string} motivoAlta Causa clinica o administrativa del egreso.
   * @param {number} idUsuarioAutor Identificador del Nutricionista Clinico.
   * @returns {Object} Resumen del egreso y payload de alerta roja para Cocina.
   */
  darAltaClinica(idPaciente, motivoAlta, idUsuarioAutor) {
    return runInTransaction(() => {
      const actual = stmtPacienteDetallePorId.get(idPaciente);
      if (!actual) {
        throw new AppError('El paciente indicado no existe en el registro clínico.', 404);
      }
      if (!actual.estado_hospitalizado) {
        throw new AppError(
          `El paciente ${actual.codigo_ficha} ya registra alta clínica previa.`,
          409
        );
      }

      const timestamp = nowUtcSqlite();
      stmtAltaPaciente.run(timestamp, idPaciente);

      const detalleAlta =
        `${motivoAlta} — Liberada Sala ${actual.numero_sala}, Cama ${actual.numero_cama}. Suspender preparación de bandeja.`;

      const histInfo = stmtInsertHistorial.run(
        idPaciente,
        idUsuarioAutor,
        actual.id_regimen_actual,
        actual.id_iddsi_solido,
        actual.id_iddsi_liquido,
        'ALTA',
        detalleAlta.slice(0, 255),
        timestamp
      );

      const pacienteEgresado = stmtPacienteDetallePorId.get(idPaciente);
      return {
        paciente: pacienteEgresado,
        evento: {
          id_historial: Number(histInfo.lastInsertRowid),
          tipo_movimiento: 'ALTA',
          codigo_ficha: actual.codigo_ficha,
          numero_sala: actual.numero_sala,
          numero_cama: actual.numero_cama,
          nombre_regimen: actual.nombre_regimen,
          nivel_iddsi_solido: actual.nivel_iddsi_solido,
          nombre_iddsi_solido: actual.nombre_iddsi_solido,
          nivel_iddsi_liquido: actual.nivel_iddsi_liquido,
          nombre_iddsi_liquido: actual.nombre_iddsi_liquido,
          detalle_clinico: detalleAlta.slice(0, 255),
          fecha_hora_registro: timestamp
        }
      };
    });
  }
};

module.exports = PacienteModel;
