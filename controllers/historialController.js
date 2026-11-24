/**
 * @file controllers/historialController.js
 * @description Controlador MVC exclusivo para el rol CLINICO que gestiona la consulta
 * auditada, filtrable y paginada del repositorio Big Data Historial_Minutas.
 */

const HistorialModel = require('../models/HistorialModel');
const { sanitizeText, parsePositiveInt } = require('../middlewares/securityMiddleware');
const { AppError } = require('../middlewares/errorHandler');

const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const historialController = {
  /**
   * GET /api/historial
   * Rol exclusivo: CLINICO (PRODUCCION recibe 403 Forbidden en middleware RBAC).
   */
  obtenerHistorial(req, res, next) {
    try {
      const tipoMovimiento = sanitizeText(req.query.tipo_movimiento || '', 20).toUpperCase();
      const paciente = sanitizeText(req.query.paciente || '', 30);
      const fechaDesde = sanitizeText(req.query.fecha_desde || '', 10);
      const fechaHasta = sanitizeText(req.query.fecha_hasta || '', 10);
      const pagina = parsePositiveInt(req.query.pagina) || 1;
      const limiteSolicitado = parsePositiveInt(req.query.limite) || 25;
      const limite = Math.min(limiteSolicitado, 100);

      if (
        tipoMovimiento &&
        !['INGRESO', 'MODIFICACION', 'ALTA'].includes(tipoMovimiento)
      ) {
        throw new AppError(
          'Filtro tipo_movimiento inválido. Valores permitidos: INGRESO, MODIFICACION, ALTA.',
          400
        );
      }

      if (fechaDesde && !DATE_ISO_REGEX.test(fechaDesde)) {
        throw new AppError('Formato fecha_desde inválido. Utilice YYYY-MM-DD.', 400);
      }

      if (fechaHasta && !DATE_ISO_REGEX.test(fechaHasta)) {
        throw new AppError('Formato fecha_hasta inválido. Utilice YYYY-MM-DD.', 400);
      }

      const resultado = HistorialModel.consultarHistorial({
        tipo_movimiento: tipoMovimiento,
        paciente,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
        pagina,
        limite
      });

      return res.status(200).json({
        ok: true,
        ...resultado
      });
    } catch (err) {
      return next(err);
    }
  }
};

module.exports = historialController;
