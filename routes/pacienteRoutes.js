/**
 * @file routes/pacienteRoutes.js
 * @description Rutas RESTful para gestion del censo hospitalario activo y ejecucion
 * de las 3 operaciones CRUD transaccionales protegidas por verifyToken y requireRole.
 */

const express = require('express');
const pacienteController = require('../controllers/pacienteController');
const { verifyToken, requireRole } = require('../middlewares/authMiddleware');

const router = express.Router();

// Consulta de censo activo 3FN y camas libres por sala (CLINICO y PRODUCCION)
router.get(
  '/censo',
  verifyToken,
  requireRole('CLINICO', 'PRODUCCION'),
  pacienteController.obtenerCenso
);

// CRUD #1: Nuevo ingreso hospitalario (Exclusivo CLINICO -> 403 si PRODUCCION)
router.post(
  '/ingreso',
  verifyToken,
  requireRole('CLINICO'),
  pacienteController.ingresarPaciente
);

// CRUD #2: Modificacion de prescripcion y consistencias IDDSI (Exclusivo CLINICO)
router.put(
  '/:id/minuta',
  verifyToken,
  requireRole('CLINICO'),
  pacienteController.modificarMinuta
);

// CRUD #3: Alta clinica confirmada con liberacion de cama (Exclusivo CLINICO)
router.patch(
  '/:id/alta',
  verifyToken,
  requireRole('CLINICO'),
  pacienteController.confirmarAlta
);

// Utilidad QA / Demo: Restaura el censo base de 70 pacientes (Exclusivo CLINICO)
router.post(
  '/restaurar-demo',
  verifyToken,
  requireRole('CLINICO'),
  pacienteController.restaurarCensoDemo
);

module.exports = router;
