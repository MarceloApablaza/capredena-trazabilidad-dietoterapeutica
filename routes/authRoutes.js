/**
 * @file routes/authRoutes.js
 * @description Definicion de rutas RESTful para autenticacion institucional JWT y
 * flujo completo de recuperacion/restablecimiento de credenciales por token temporal.
 */

const express = require('express');
const authController = require('../controllers/authController');
const { loginRateLimiter } = require('../middlewares/securityMiddleware');

const router = express.Router();

// Inicio de sesion protegido con Rate Limit estricto (max. 5 peticiones/minuto por IP)
router.post('/login', loginRateLimiter, authController.login);

// Generacion de token temporal (vigencia 15 min) enviado o previsualizado en desarrollo
router.post('/recuperar', authController.recuperar);

// Validacion de token temporal y actualizacion de clave con Bcrypt (10 rondas)
router.post('/restablecer', authController.restablecer);

module.exports = router;
