/**
 * @file controllers/cocinaController.js
 * @description Controlador MVC para el Monitor Mural de la Central de Alimentacion.
 * Expone en modo de solo lectura las metricas agregadas SQL, calculo de espesante
 * diario, barras por regimen/consistencia IDDSI, alertas tempranas 24h y mapa de salas.
 */

const CocinaModel = require('../models/CocinaModel');

const cocinaController = {
  /**
   * GET /api/cocina/dashboard
   * Roles permitidos: PRODUCCION, CLINICO.
   * Responde en una unica carga optimizada todos los indicadores operativos del turno.
   */
  obtenerDashboard(req, res, next) {
    try {
      const dashboard = CocinaModel.getDashboardData();
      return res.status(200).json({
        ok: true,
        ...dashboard
      });
    } catch (err) {
      return next(err);
    }
  }
};

module.exports = cocinaController;
