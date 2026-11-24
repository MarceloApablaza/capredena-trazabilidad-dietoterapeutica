/**
 * @file config/swagger.js
 * @description Especificacion completa OpenAPI 3.0.3 servida dinamicamente en
 * GET /api/docs mediante swagger-ui-express. Documenta esquemas, codigos HTTP,
 * politicas RBAC, limites de velocidad y contratos de datos clinicos en 3FN.
 */

const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title:
      'API Trazabilidad Dietoterapéutica y Alertas Clínicas Tempranas - CAPREDENA Limache',
    version: '1.0.0',
    description:
      'API RESTful sin estado (Stateless JWT) con arquitectura MVC en 3 capas, persistencia relacional en 3FN, cifrado Bcrypt (10 rondas), control RBAC estricto y notificaciones en tiempo real vía Socket.IO (< 2.0s).'
  },
  servers: [
    {
      url: '/',
      description: 'Servidor Institucional Activo (Local o Producción)'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Token JWT obtenido en POST /api/auth/login (Roles: CLINICO o PRODUCCION)'
      }
    },
    schemas: {
      LoginRequest: {
        type: 'object',
        required: ['correo_institucional', 'password'],
        properties: {
          correo_institucional: {
            type: 'string',
            example: 'nutricion.clinica@capredena.gob.cl'
          },
          password: {
            type: 'string',
            example: 'Clinica2026!'
          }
        }
      },
      RecuperarRequest: {
        type: 'object',
        required: ['correo_institucional'],
        properties: {
          correo_institucional: {
            type: 'string',
            example: 'nutricion.clinica@capredena.gob.cl'
          }
        }
      },
      RestablecerRequest: {
        type: 'object',
        required: ['correo_institucional', 'token_recuperacion', 'nueva_password'],
        properties: {
          correo_institucional: {
            type: 'string',
            example: 'nutricion.clinica@capredena.gob.cl'
          },
          token_recuperacion: {
            type: 'string',
            example: 'TKN-8A4F-CAPR'
          },
          nueva_password: {
            type: 'string',
            example: 'Clinica2026!'
          }
        }
      },
      IngresoPacienteRequest: {
        type: 'object',
        required: [
          'codigo_ficha',
          'numero_sala',
          'numero_cama',
          'id_regimen_actual',
          'id_iddsi_solido',
          'id_iddsi_liquido'
        ],
        properties: {
          codigo_ficha: { type: 'string', example: 'Pac. #071' },
          numero_sala: { type: 'integer', example: 1 },
          numero_cama: { type: 'integer', example: 8 },
          id_regimen_actual: { type: 'integer', example: 1 },
          id_iddsi_solido: { type: 'integer', example: 9 },
          id_iddsi_liquido: { type: 'integer', example: 1 },
          observacion_alergias: {
            type: 'string',
            example: 'Ingreso clínico basal; supervisar tolerancia oral.'
          }
        }
      },
      ModificarMinutaRequest: {
        type: 'object',
        required: ['id_regimen_actual', 'id_iddsi_solido', 'id_iddsi_liquido'],
        properties: {
          id_regimen_actual: { type: 'integer', example: 3 },
          id_iddsi_solido: { type: 'integer', example: 7 },
          id_iddsi_liquido: { type: 'integer', example: 3 },
          observacion_alergias: {
            type: 'string',
            example: 'Ajuste fonoaudiológico a Líquido IDDSI 2 Poco Espeso.'
          },
          motivo_cambio: {
            type: 'string',
            example: 'Evaluación deglutoria matinal'
          }
        }
      },
      AltaClinicaRequest: {
        type: 'object',
        required: ['motivo_alta'],
        properties: {
          motivo_alta: {
            type: 'string',
            example: 'Alta médica confirmada por evolución clínica favorable'
          }
        }
      }
    }
  },
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Autenticación y Seguridad'],
        summary: 'Autenticación institucional con Bcrypt y emisión de JWT (Rate Limit: 5 req/min)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } }
          }
        },
        responses: {
          200: { description: 'JWT emitido exitosamente junto al rol RBAC.' },
          401: { description: 'Credenciales inválidas.' },
          429: { description: 'Exceso de intentos (> 5 peticiones/minuto por IP).' }
        }
      }
    },
    '/api/auth/recuperar': {
      post: {
        tags: ['Autenticación y Seguridad'],
        summary: 'Genera token temporal único (15 min) para recuperación de contraseña',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RecuperarRequest' }
            }
          }
        },
        responses: {
          200: { description: 'Token temporal generado (incluye dev_token_preview sin SMTP).' },
          404: { description: 'Correo institucional no encontrado.' }
        }
      }
    },
    '/api/auth/restablecer': {
      post: {
        tags: ['Autenticación y Seguridad'],
        summary: 'Restablece contraseña validando token vigente y cifrando con Bcrypt',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RestablecerRequest' }
            }
          }
        },
        responses: {
          200: { description: 'Contraseña actualizada y token invalidado.' },
          400: { description: 'Token inválido, expirado o contraseña débil.' }
        }
      }
    },
    '/api/pacientes/censo': {
      get: {
        tags: ['Censo y Operaciones Clínicas CRUD'],
        summary: 'Consulta censo activo en 3FN, catálogos IDDSI y camas libres por sala',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Listado completo de pacientes activos y disponibilidad.' },
          401: { description: 'Token ausente o inválido.' }
        }
      }
    },
    '/api/pacientes/ingreso': {
      post: {
        tags: ['Censo y Operaciones Clínicas CRUD'],
        summary: 'CRUD #1 (Solo CLINICO): Registra ingreso hospitalario y emite Socket.IO',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/IngresoPacienteRequest' }
            }
          }
        },
        responses: {
          201: { description: 'Paciente ingresado y registrado en Historial_Minutas.' },
          403: { description: 'Forbidden: Rol PRODUCCION sin permisos de escritura.' },
          409: { description: 'Conflicto: Sala/Cama ocupada o ficha duplicada.' }
        }
      }
    },
    '/api/pacientes/{id}/minuta': {
      put: {
        tags: ['Censo y Operaciones Clínicas CRUD'],
        summary: 'CRUD #2 (Solo CLINICO): Modifica régimen/consistencias IDDSI y emite Socket.IO',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ModificarMinutaRequest' }
            }
          }
        },
        responses: {
          200: { description: 'Prescripción actualizada atómicamente.' },
          400: { description: 'Incoherencia IDDSI líquido vs sólido.' },
          403: { description: 'Forbidden: Rol PRODUCCION bloqueado.' }
        }
      }
    },
    '/api/pacientes/{id}/alta': {
      patch: {
        tags: ['Censo y Operaciones Clínicas CRUD'],
        summary: 'CRUD #3 (Solo CLINICO): Ejecuta alta clínica, libera cama y preserva Big Data',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AltaClinicaRequest' }
            }
          }
        },
        responses: {
          200: { description: 'Alta confirmada y alerta roja despachada a Cocina.' },
          403: { description: 'Forbidden: Rol PRODUCCION bloqueado.' }
        }
      }
    },
    '/api/pacientes/restaurar-demo': {
      post: {
        tags: ['Censo y Operaciones Clínicas CRUD'],
        summary: 'Solo CLINICO: Restaura limpiamente el censo demo institucional (70 pacientes activos)',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Censo restaurado a 70 activos (Sala 1 Cama 8 libre).' },
          403: { description: 'Forbidden: Rol PRODUCCION bloqueado.' }
        }
      }
    },
    '/api/cocina/dashboard': {
      get: {
        tags: ['Monitor Mural Cocina (Producción)'],
        summary: 'Obtiene KPIs en vivo, gramos de espesante, series Big Data, alertas 24h y salas',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'Consolidado analítico completo para Monitor Mural.' }
        }
      }
    },
    '/api/historial': {
      get: {
        tags: ['Repositorio Big Data e Historial Inmutable'],
        summary: 'Solo CLINICO: Consulta paginada y filtrable de Historial_Minutas',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'tipo_movimiento',
            in: 'query',
            schema: { type: 'string', enum: ['INGRESO', 'MODIFICACION', 'ALTA'] }
          },
          { name: 'paciente', in: 'query', schema: { type: 'string' } },
          { name: 'fecha_desde', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'fecha_hasta', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'pagina', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limite', in: 'query', schema: { type: 'integer', default: 25 } }
        ],
        responses: {
          200: { description: 'Registros históricos auditados y estadísticas acumuladas.' },
          403: { description: 'Forbidden: Rol PRODUCCION sin acceso a Big Data clínico.' },
          405: { description: 'Method Not Allowed: Historial_Minutas es inmutable (PUT/DELETE bloqueados).' }
        }
      }
    }
  }
};

module.exports = swaggerSpec;
