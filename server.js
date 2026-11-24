/**
 * @file server.js
 * @description Punto de entrada principal del Servidor de Aplicaciones (3 Capas MVC):
 * "Sistema Web de Trazabilidad Dietoterapeutica y Alertas Clinicas Tempranas para
 * Pacientes Institucionalizados (CAPREDENA Limache)".
 * Integra Express.js, Socket.IO (< 2.0s latencia), ciberseguridad Helmet/CORS/RateLimit,
 * compresion Gzip, documentacion OpenAPI 3.0 (/api/docs) y poblado automatico SQL 3FN.
 */

const http = require('http');
const path = require('path');
const express = require('express');
const compression = require('compression');
const { Server: SocketIOServer } = require('socket.io');
const swaggerUi = require('swagger-ui-express');
const jwt = require('jsonwebtoken');

const env = require('./config/env');
const swaggerSpec = require('./config/swagger');
const { ensureSeedData } = require('./database/seed');
const {
  helmetMiddleware,
  corsMiddleware,
  socketCorsOptionsDelegate,
  apiRateLimiter
} = require('./middlewares/securityMiddleware');
const { errorHandler } = require('./middlewares/errorHandler');

const authRoutes = require('./routes/authRoutes');
const pacienteRoutes = require('./routes/pacienteRoutes');
const cocinaRoutes = require('./routes/cocinaRoutes');
const historialRoutes = require('./routes/historialRoutes');

// 1. Inicializacion de base de datos relacional en 3FN y poblado automatico si esta vacia
ensureSeedData(true);

// 2. Creacion de aplicacion Express y servidor HTTP compartido con WebSockets
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// 3. Configuracion de Socket.IO con autenticacion ligera de handshake JWT
const io = new SocketIOServer(server, {
  cors: socketCorsOptionsDelegate,
  pingInterval: 10000,
  pingTimeout: 5000
});

// Middleware de verificacion JWT para clientes WebSocket conectados en tiempo real
io.use((socket, next) => {
  const token =
    socket.handshake.auth && socket.handshake.auth.token
      ? socket.handshake.auth.token
      : null;

  if (!token) {
    return next(new Error('Token JWT requerido para conexión en tiempo real.'));
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    socket.user = decoded;
    return next();
  } catch (_err) {
    return next(new Error('Token JWT inválido o expirado en canal WebSocket.'));
  }
});

io.on('connection', (socket) => {
  const salaRol = socket.user && socket.user.rol ? `rol:${socket.user.rol}` : 'general';
  socket.join(salaRol);
});

// Expone instancia Socket.IO a los controladores MVC mediante app.get('io')
app.set('io', io);

// 4. Middlewares globales de seguridad, rendimiento Gzip y parseo acotado anti-DoS
app.disable('x-powered-by');
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(compression());
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// 5. Documentacion interactiva OpenAPI 3.0 (Swagger)
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'API Docs - CAPREDENA Limache'
  })
);
app.get('/api/docs.json', (_req, res) => res.status(200).json(swaggerSpec));

// 6. Montaje de endpoints RESTful bajo prefijo /api con proteccion anti-abuso
app.get('/api/health', (_req, res) => {
  return res.status(200).json({ ok: true, status: 'UP', env: env.NODE_ENV });
});
app.use('/api', apiRateLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/pacientes', pacienteRoutes);
app.use('/api/cocina', cocinaRoutes);
app.use('/api/historial', historialRoutes);

// Endpoint no encontrado dentro del espacio /api
app.use('/api/*', (_req, res) => {
  return res.status(404).json({
    ok: false,
    error: '404 Not Found: El endpoint clínico solicitado no existe.'
  });
});

// 7. Servicio de Vistas Frontend (HTML5 Semantico + CSS3 Puro + JS ES6+)
const publicDir = path.join(__dirname, 'public');
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});
app.use(express.static(publicDir));

// 8. Manejador global centralizado de errores (oculta trazas SQL y retorna 500 generico)
app.use(errorHandler);

// Inicio de escucha del servidor cuando se ejecuta directamente
if (require.main === module) {
  server.listen(env.PORT, '0.0.0.0', () => {
    console.log('====================================================================');
    console.log(' SISTEMA TRAZABILIDAD DIETOTERAPEUTICA - CAPREDENA LIMACHE');
    console.log(` Portal Web Activo : http://localhost:${env.PORT}`);
    console.log(` Swagger API Docs  : http://localhost:${env.PORT}/api/docs`);
    console.log(' Estado WebSockets : EN VIVO (Socket.IO baja latencia < 2.0s)');
    console.log('====================================================================');
  });
}

module.exports = { app, server, io };
