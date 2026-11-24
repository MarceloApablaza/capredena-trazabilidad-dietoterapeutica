/**
 * @file routes/cocinaRoutes.js
 * @description Ruta RESTful de alto rendimiento para el Monitor Mural de Cocina.
 * Permite acceso de solo lectura tanto a PRODUCCION como a CLINICO.
 */

const express = require('express');
const cocinaController = require('../controllers/cocinaController');
const { verifyToken, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// Consolidado KPIs, gramos de espesante, barras Big Data, alertas 24h y mapa de salas
router.get(
  '/dashboard',
  verifyToken,
  requireRole('PRODUCCION', 'CLINICO'),
  cocinaController.obtenerDashboard
);

module.exports = router;
