/**
 * @file routes/historialRoutes.js
 * @description Ruta RESTful exclusiva para el perfil CLINICO orientada a la auditoria
 * medico-legal e investigacion analitica sobre el repositorio Big Data Historial_Minutas.
 */

const express = require('express');
const historialController = require('../controllers/historialController');
const { verifyToken, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// Consulta paginada y filtrable de Historial_Minutas (Exclusivo CLINICO -> 403 si PRODUCCION)
router.get(
  '/',
  verifyToken,
  requireRole('CLINICO'),
  historialController.obtenerHistorial
);

// Garantia fisica y de API de inmutabilidad (CP07): rechaza cualquier escritura/borrado con 405
const rechazarMutacionHistorial = (_req, res) =>
  res.status(405).json({
    ok: false,
    error:
      '405 Method Not Allowed: Historial_Minutas es un repositorio Big Data inmutable; no se permite modificar ni eliminar hechos clínicos.'
  });

router.all('/', rechazarMutacionHistorial);
router.all('/:id', rechazarMutacionHistorial);

module.exports = router;
