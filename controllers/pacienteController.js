/**
 * @file controllers/pacienteController.js
 * @description Controlador MVC para la gestion del censo hospitalario activo y las 3
 * operaciones CRUD exclusivas del perfil CLINICO. Cada mutacion persiste en 3FN + ACID
 * y difunde en tiempo real (< 2.0s) el evento 'actualizacion_minuta' via Socket.IO.
 */

const PacienteModel = require('../models/PacienteModel');
const CocinaModel = require('../models/CocinaModel');
const { resetSeedData } = require('../database/seed');
const { sanitizeText, parsePositiveInt } = require('../middlewares/securityMiddleware');
const { AppError } = require('../middlewares/errorHandler');

/**
 * Emite el evento WebSocket global 'actualizacion_minuta' hacia todas las pantallas
 * conectadas (Monitor Mural Cocina y sesiones clinicas activas).
 * @param {import('express').Request} req Solicitud HTTP con acceso a app.get('io').
 * @param {Object} evento Resumen del hecho clinico recien registrado en Historial_Minutas.
 */
function emitirActualizacionTiempoReal(req, evento) {
  const io = req.app.get('io');
  if (io) {
    const dashboardActualizado = CocinaModel.getDashboardData();
    io.emit('actualizacion_minuta', {
      emitido_en: new Date().toISOString(),
      autor: req.user ? req.user.nombre_completo : 'Nutricionista Clínico',
      evento,
      dashboard: dashboardActualizado
    });
  }
}

const pacienteController = {
  /**
   * GET /api/pacientes/censo
   * Disponible para CLINICO y PRODUCCION. Entrega censo 3FN y camas libres por sala.
   */
  obtenerCenso(req, res, next) {
    try {
      const data = PacienteModel.getCensoCompletoConDisponibilidad();
      return res.status(200).json({
        ok: true,
        ...data
      });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * POST /api/pacientes/ingreso (CRUD #1 - Exclusivo CLINICO)
   * Registra un nuevo paciente hospitalizado y su trazabilidad atomica de ingreso.
   */
  ingresarPaciente(req, res, next) {
    try {
      const codigoFicha = sanitizeText(req.body.codigo_ficha, 30);
      const numeroSala = parsePositiveInt(req.body.numero_sala);
      const numeroCama = parsePositiveInt(req.body.numero_cama);
      const idRegimen = parsePositiveInt(req.body.id_regimen_actual);
      const idSolido = parsePositiveInt(req.body.id_iddsi_solido);
      const idLiquido = parsePositiveInt(req.body.id_iddsi_liquido);
      const observacion = sanitizeText(
        req.body.observacion_alergias || 'Sin alergias alimentarias conocidas.',
        255
      );

      if (!codigoFicha || codigoFicha.length < 3) {
        throw new AppError('Debe indicar un código de ficha seudonimizado válido (ej. Pac. #074).', 400);
      }

      if (!numeroSala || !numeroCama || !idRegimen || !idSolido || !idLiquido) {
        throw new AppError(
          'Todos los campos clínicos obligatorios (Sala, Cama, Régimen e IDDSI Sólido/Líquido) deben ser válidos.',
          400
        );
      }

      const resultado = PacienteModel.crearIngreso(
        {
          codigo_ficha: codigoFicha,
          numero_sala: numeroSala,
          numero_cama: numeroCama,
          id_regimen_actual: idRegimen,
          id_iddsi_solido: idSolido,
          id_iddsi_liquido: idLiquido,
          observacion_alergias: observacion
        },
        req.user.id_usuario
      );

      emitirActualizacionTiempoReal(req, resultado.evento);

      return res.status(201).json({
        ok: true,
        mensaje: `Ingreso hospitalario registrado correctamente (${resultado.paciente.codigo_ficha}).`,
        ...resultado
      });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * PUT /api/pacientes/:id/minuta (CRUD #2 - Exclusivo CLINICO)
   * Modifica prescripcion dietoterapeutica / consistencias IDDSI y notifica a Cocina.
   */
  modificarMinuta(req, res, next) {
    try {
      const idPaciente = parsePositiveInt(req.params.id);
      const idRegimen = parsePositiveInt(req.body.id_regimen_actual);
      const idSolido = parsePositiveInt(req.body.id_iddsi_solido);
      const idLiquido = parsePositiveInt(req.body.id_iddsi_liquido);
      const observacion = sanitizeText(req.body.observacion_alergias || '', 255);
      const motivoCambio = sanitizeText(req.body.motivo_cambio || '', 140);

      if (!idPaciente) {
        throw new AppError('El identificador del paciente es inválido.', 400);
      }

      if (!idRegimen || !idSolido || !idLiquido) {
        throw new AppError(
          'Debe seleccionar un Régimen y niveles IDDSI Sólido y Líquido válidos.',
          400
        );
      }

      const resultado = PacienteModel.actualizarMinuta(
        idPaciente,
        {
          id_regimen_actual: idRegimen,
          id_iddsi_solido: idSolido,
          id_iddsi_liquido: idLiquido,
          observacion_alergias: observacion,
          motivo_cambio: motivoCambio
        },
        req.user.id_usuario
      );

      emitirActualizacionTiempoReal(req, resultado.evento);

      return res.status(200).json({
        ok: true,
        mensaje: `Prescripción dietoterapéutica actualizada para ${resultado.paciente.codigo_ficha}.`,
        ...resultado
      });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * PATCH /api/pacientes/:id/alta (CRUD #3 - Exclusivo CLINICO)
   * Confirma el alta clinica liberando la cama y manteniendo persistencia en Big Data.
   */
  confirmarAlta(req, res, next) {
    try {
      const idPaciente = parsePositiveInt(req.params.id);
      const motivoAlta = sanitizeText(
        req.body.motivo_alta || 'Alta médica confirmada por evolución clínica favorable',
        180
      );

      if (!idPaciente) {
        throw new AppError('El identificador del paciente es inválido.', 400);
      }

      const resultado = PacienteModel.darAltaClinica(
        idPaciente,
        motivoAlta,
        req.user.id_usuario
      );

      emitirActualizacionTiempoReal(req, resultado.evento);

      return res.status(200).json({
        ok: true,
        mensaje: `Alta clínica confirmada para ${resultado.evento.codigo_ficha}. Cama liberada exitosamente.`,
        ...resultado
      });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * POST /api/pacientes/restaurar-demo (Exclusivo CLINICO)
   * Reinicia de forma controlada y atomica el escenario de demostracion institucional
   * (70 pacientes activos, Sala 1 Cama 8 libre, Pac. #042 en S2-C14, Pac. #033 en S3-C19)
   * y sincroniza de inmediato el Monitor Mural de Cocina via Socket.IO.
   */
  restaurarCensoDemo(req, res, next) {
    try {
      const { resumen } = resetSeedData(false);
      emitirActualizacionTiempoReal(req, {
        id_historial: null,
        tipo_movimiento: 'MODIFICACION',
        codigo_ficha: 'Censo Demo (70)',
        numero_sala: 1,
        numero_cama: 8,
        detalle_clinico: 'Escenario institucional restaurado a 70 pacientes activos.'
      });

      return res.status(200).json({
        ok: true,
        mensaje:
          'Censo institucional demo restaurado limpiamente (70 pacientes activos, Sala 1 Cama 8 libre).',
        resumen
      });
    } catch (err) {
      return next(err);
    }
  }
};

module.exports = pacienteController;
