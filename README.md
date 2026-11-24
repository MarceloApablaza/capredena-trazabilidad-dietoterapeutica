# Sistema Web de Trazabilidad Dietoterapéutica y Alertas Clínicas Tempranas — CAPREDENA Limache

Plataforma clínica Full-Stack diseñada para el **Centro de Rehabilitación y Cuidados Institucionalizados CAPREDENA Limache**, orientada a eliminar los errores de comunicación entre la Unidad de Nutrición Clínica y la Central de Alimentación (Cocina). Estandariza las prescripciones de disfagia bajo el **Marco Internacional IDDSI (Niveles 0 al 7)**, protege la identidad de los pacientes hospitalizados mediante **seudonimización estricta conforme a la Ley N° 20.584 y Ley N° 19.628**, y consolida un repositorio histórico inmutable orientado a **Big Data Clínico**.

### Enlaces en Producción (Railway)
- **Aplicación Web en Vivo (HTTPS / WSS):** https://capredena-trazabilidad-production.up.railway.app/
- **Documentación Interactiva OpenAPI 3.0 (Swagger):** https://capredena-trazabilidad-production.up.railway.app/api/docs
- **Estado del Servicio (Healthcheck):** https://capredena-trazabilidad-production.up.railway.app/api/health

---

## 1. Credenciales de Acceso de Prueba (Seed Automático)

Al iniciar el servidor por primera vez (o al pulsar el botón discreto **"Restaurar Censo Demo (70)"** desde el panel clínico), `database/seed.js` inicializa de forma atómica los catálogos normativos, **70 pacientes activos hospitalizados** (`Pac. #001` a `Pac. #070` distribuidos en Salas 1 a 4 con **Sala 1 – Cama 08 libre**), **3 pacientes egresados históricos** (`Pac. #081` a `Pac. #083`) y **286 registros inmutables** en `Historial_Minutas`.

| Perfil Institucional | Correo Electrónico | Contraseña | Rol RBAC | Permisos Efectivos |
| :--- | :--- | :--- | :--- | :--- |
| **Nutricionista Clínico** | `nutricion.clinica@capredena.gob.cl` | `Clinica2026!` | `CLINICO` | Lectura y escritura completa (3 operaciones CRUD en `<= 3 clics`), consulta de repositorio Big Data (`/api/historial`), restauración de escenario demo y supervisión de cocina. |
| **Producción Cocina** | `produccion.cocina@capredena.gob.cl` | `Cocina2026!` | `PRODUCCION` | **Solo Lectura Estricto** en Monitor Mural (`/cocina.html`). Redirección automática si intenta acceder a `/clinico.html` y bloqueo `HTTP 403 Forbidden` ante cualquier escritura o consulta a `/api/historial`. |

---

## 2. Documentación Técnica

### 2.1 Frontend (HTML5 Semántico, Vanilla CSS3 Puro y JS ES6+)
- **HTML5 Semántico sin frameworks externos:** Tres vistas desacopladas servidas desde `/public/` ([login.html](public/login.html), [clinico.html](public/clinico.html) y [cocina.html](public/cocina.html)) con etiquetas semánticas (`header`, `nav`, `main`, `section`, `article`, `aside`), atributos ARIA (`aria-live`, `role="alert"`, `role="log"`) y foco visible por teclado.
- **100% Vanilla CSS3 Puro (< 15 KB):** Hoja única nativa [public/css/styles.css](public/css/styles.css) sin Bootstrap, Tailwind ni preprocesadores externos.
  - **Variables globales en `:root`:** `--bg-main: #0f0f13`, `--bg-card: #1a1a22`, `--violet-primary: #8b5cf6`, `--danger: #ef4444`, `--success: #10b981`, `--text: #f3f4f6`, `--muted: #cbd5e1`.
  - **Accesibilidad Hospitalaria WCAG 2.1 Nivel AAA:** Relación de contraste superior a `10:1`–`17:1` (superando el umbral AAA de `>= 7:1`), optimizada para lectura a 3 metros en monitor mural de cocina.
  - **Maquetación y Responsividad:** **CSS Grid Layout**, **Flexbox**, nomenclatura **BEM** y **Media Queries** (`1024px`, `768px`, `480px`) que eliminan desbordes horizontales desde `360px` hasta `1920px`.
  - **Visualización Analítica sin librerías:** Barras horizontales dinámicas por Régimen e IDDSI renderizadas en CSS3 puro.
- **JavaScript ES6+ y Tiempo Real (`Socket.IO`):**
  - Rutas relativas dinámicas (`fetch('/api/...')` y `window.io({ auth: { token } })`), compatibles automáticamente con `HTTP/WS` en local y `HTTPS/WSS` en Railway.
  - Recepción del evento `actualizacion_minuta` en `< 2.0 segundos` sin recargar la página (`F5`), con código cromático normativo (**Verde:** Ingreso, **Violeta:** Modificación IDDSI/Minuta, **Rojo:** Alta / Suspender bandeja).
  - Renderizado seguro exclusivamente mediante `textContent` (cero `innerHTML` sobre entradas clínicas) para mitigar XSS.
  - Temporizador de cierre automático por inactividad tras 15 minutos (`RF10`) en el panel clínico con aviso previo y botón/atajo de demostración (`Alt+Shift+I`).

### 2.2 Backend y Ciberseguridad (Node.js, Express MVC y OWASP Top 10)
- **Arquitectura MVC en 3 Capas:** Separación estricta entre Rutas (`/routes`), Controladores (`/controllers`), Modelos de acceso a datos (`/models`), Configuración (`/config`) y Middlewares defensivos (`/middlewares`), con `app.set('trust proxy', 1)` habilitado para proxies reversos HTTPS en Railway.
- **Autenticación y Control de Acceso:**
  - **Bcrypt (10 rondas + salt dinámico):** Almacenamiento irreversible de contraseñas (`$2a$10$` / `$2b$10$`).
  - **JWT Stateless (`HS256`):** Emisión y validación en cabecera `Authorization: Bearer <token>` y en el handshake WebSocket de `Socket.IO`.
  - **Recuperación de contraseña de un solo uso:** Token temporal criptográfico (`TKN-XXXX-CAPR`, vigencia de 15 minutos) que se invalida inmediatamente tras consumirse (rechaza reutilización con `HTTP 400`).
  - **RBAC Estricto:** Middlewares `verifyToken` y `requireRole('CLINICO')` garantizan `HTTP 403 Forbidden` ante intentos de escalamiento del perfil `PRODUCCION`.
- **Controles Defensivos OWASP Top 10:**
  - **Anti-SQL Injection (SQLi):** 100% consultas parametrizadas precompiladas (`Prepared Statements` en `better-sqlite3`).
  - **Anti-XSS:** Sanitización y escape estricto de caracteres HTML en backend (`sanitizeText`) + renderizado inerte con `textContent` en frontend.
  - **Anti-Fuerza Bruta y DoS:** `express-rate-limit` sobre `POST /api/auth/login` (**máximo 5 intentos por minuto por IP**, devolviendo `HTTP 429 Too Many Requests` en el 6° intento), límite general `/api` (`180 req/min`), parseo JSON acotado (`64 KB`), compresión Gzip y cabeceras **Helmet (CSP/HSTS)** + política **CORS restrictiva** same-origin.
  - **Manejo centralizado de errores:** `errorHandler.js` impide filtrar trazas SQL internas al cliente HTTP.

#### Endpoints Oficiales de la API RESTful
| Método | Ruta | Perfil Autorizado | Descripción |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Público (5 req/min) | Autentica con Bcrypt y emite JWT `HS256`. |
| `POST` | `/api/auth/recuperar` | Público | Genera token temporal de 15 min (con vista controlada sin SMTP). |
| `POST` | `/api/auth/restablecer` | Público | Valida token vigente, actualiza hash Bcrypt e invalida token. |
| `GET` | `/api/pacientes/censo` | `CLINICO`, `PRODUCCION` | Retorna censo activo en 3FN, catálogos IDDSI y camas libres. |
| `POST` | `/api/pacientes/ingreso` | Solo `CLINICO` | **CRUD #1:** Nuevo ingreso hospitalario + evento `INGRESO` vía Socket.IO. |
| `PUT` | `/api/pacientes/:id/minuta` | Solo `CLINICO` | **CRUD #2:** Actualiza régimen/IDDSI + evento `MODIFICACION` vía Socket.IO. |
| `PATCH` | `/api/pacientes/:id/alta` | Solo `CLINICO` | **CRUD #3:** Alta clínica (`estado_hospitalizado = 0`), libera cama + alerta roja. |
| `POST` | `/api/pacientes/restaurar-demo` | Solo `CLINICO` | Restaura atómicamente el censo demo base de 70 pacientes activos. |
| `GET` | `/api/cocina/dashboard` | `CLINICO`, `PRODUCCION` | Consolidado de KPIs, prevalencia de disfagia, espesante diario, series y mapa de salas. |
| `GET` | `/api/historial` | Solo `CLINICO` | Consulta paginada y filtrable del repositorio Big Data (`PUT`/`DELETE` bloqueados con `405`). |
| `GET` | `/api/docs` | Público | Documentación interactiva OpenAPI 3.0.3 (Swagger UI). |
| `GET` | `/api/health` | Público | Verificación de salud del servidor en producción. |

### 2.3 Base de Datos Relacional (Tercera Forma Normal — 3FN y Big Data)
Persistencia relacional con integridad referencial física (`PRAGMA foreign_keys = ON`), modo concurrente `WAL` y transacciones atómicas **ACID** (`BEGIN IMMEDIATE ... COMMIT / ROLLBACK`), respaldada además por el script DDL oficial de producción para MySQL 8+ / MS SQL Server en [database/schema_produccion_sql.sql](database/schema_produccion_sql.sql).

| # | Tabla (3FN) | Propósito Clínico y Restricciones Clave |
| :--- | :--- | :--- |
| 1 | **`Roles`** | Catálogo RBAC estricto (`CLINICO`, `PRODUCCION`) con `CHECK` de dominio. |
| 2 | **`Usuarios`** | Cuentas institucionales con `password_hash` Bcrypt (10 rondas), `FK` a `Roles` y campos temporales de recuperación (`token_recuperacion`, `token_expiracion`). |
| 3 | **`Regimenes`** | Catálogo maestro dietoterapéutico libre de redundancias (7 regímenes oficiales: `Liviano Hiposódico`, `Diabético Liviano`, `Diabético Liviano Hiperproteico`, `Común`, `Común Hiperproteico`, `Renal Hiposódico`, `Blando Gástrico`). |
| 4 | **`Consistencias_IDDSI`** | Estándar normativo IDDSI con `nivel_iddsi BETWEEN 0 AND 7` y `aplica_a_tipo IN ('LIQUIDO', 'SOLIDO')` (5 niveles líquidos `0–4` + 5 niveles sólidos `3–7`). |
| 5 | **`Pacientes`** | Censo hospitalario seudonimizado (`Pac. #001`–`Pac. #070`, sin nombres civiles ni RUT) con `numero_sala` y `numero_cama` enteros, `estado_hospitalizado` (`1` activo / `0` egresado) e índice único condicional `WHERE estado_hospitalizado = 1` que impide duplicar camas activas. |
| 6 | **`Historial_Minutas`** | Tabla de Hechos **inmutable** para Big Data Clínico y auditoría médico-legal (`id_historial BIGINT`/`INTEGER PRIMARY KEY AUTOINCREMENT`, `tipo_movimiento IN ('INGRESO','MODIFICACION','ALTA')`, llaves foráneas a paciente/autor/régimen/IDDSI e índices compuestos por fecha y prescripción). |

---

## 3. Estructura de Carpetas del Repositorio

```text
PROYECTO TITULO 1/
├── config/
│   ├── env.js                      # Variables de entorno, CORS dinámico y parámetros de espesante
│   ├── database.js                 # Singleton better-sqlite3 (3FN, FOREIGN KEYS = ON, WAL, ACID)
│   └── swagger.js                  # Especificación OpenAPI 3.0.3 (/api/docs)
├── controllers/
│   ├── authController.js           # Login Bcrypt/JWT, recuperación y restablecimiento
│   ├── pacienteController.js       # CRUD clínico (Ingreso, Minuta, Alta, Restaurar Demo) + Socket.IO
│   ├── cocinaController.js         # Consolidado en vivo para Monitor Mural
│   └── historialController.js      # Consulta paginada y filtrable del repositorio Big Data
├── database/
│   ├── schema_produccion_sql.sql   # Script DDL oficial 3FN para MySQL 8+ / MS SQL Server
│   └── seed.js                     # Poblado determinista (70 activos + 3 altas + 286 hechos)
├── middlewares/
│   ├── authMiddleware.js           # verifyToken (JWT HS256) y requireRole (RBAC 403)
│   ├── securityMiddleware.js       # Helmet CSP, CORS restrictivo, Rate Limiting y anti-XSS
│   └── errorHandler.js             # Captura global segura sin filtración de trazas SQL
├── models/
│   ├── UsuarioModel.js             # Prepared Statements de usuarios y tokens temporales
│   ├── CatalogoModel.js            # Catálogos maestros Regimenes y Consistencias_IDDSI
│   ├── PacienteModel.js            # Censo activo y transacciones ACID (Ingreso, Minuta, Alta)
│   ├── CocinaModel.js              # Agregaciones SQL, KPIs, espesante y matriz Salas 1–4
│   └── HistorialModel.js           # Paginación, filtros y métricas Big Data inmutables
├── public/
│   ├── login.html                  # Portal de Autenticación y Recuperación por Token
│   ├── clinico.html                # Módulo Clínico Nutricionista (<= 3 clics + RF10 + Demo Reset)
│   ├── cocina.html                 # Monitor Mural Cocina Solo Lectura en Tiempo Real
│   ├── css/styles.css              # 100% Vanilla CSS3 Puro (< 15 KB), BEM, Grid, Flexbox, AAA
│   └── js/                         # Controladores ES6+ (login.js, clinico.js, cocina.js)
├── routes/
│   ├── authRoutes.js               # /api/auth/*
│   ├── pacienteRoutes.js           # /api/pacientes/*
│   ├── cocinaRoutes.js             # /api/cocina/dashboard
│   └── historialRoutes.js          # /api/historial (GET + bloqueo 405 inmutable)
├── .gitignore                      # Excluye node_modules, .env y artefactos locales SQLite
├── package.json                    # Dependencias y motor Node 22.x
├── README.md                       # Documentación técnica del repositorio público
└── server.js                       # Servidor HTTP + Express (trust proxy) + Socket.IO
```

---

## 4. Ejecución Local y Despliegue en Railway

### 4.1 Ejecución Local Paso a Paso
Requisitos previos: **Node.js 20+ / 22.x** y **npm**.

```bash
# 1. Clonar el repositorio e ingresar al directorio del proyecto
git clone <URL_DEL_REPOSITORIO>
cd "PROYECTO TITULO 1"

# 2. Instalar dependencias de producción
npm install

# 3. (Opcional) Crear archivo .env en la raíz con sus variables locales:
# PORT=3000
# NODE_ENV=development
# JWT_SECRET=clave_institucional_segura
# GRAMOS_ESPESANTE_POR_RACION=2.4
# SERVICIOS_HIDRATACION_DIARIOS=4

# 4. Iniciar el servidor Express + Socket.IO (ejecuta seed automático si la BD está vacía)
npm start
# (En Windows con políticas restrictivas de PowerShell, también puede ejecutar: node server.js)
```

Accesos locales inmediatos:
- Portal de Autenticación: `http://localhost:3000/`
- Módulo Clínico: `http://localhost:3000/clinico.html`
- Monitor Mural Cocina: `http://localhost:3000/cocina.html`
- Swagger UI: `http://localhost:3000/api/docs`

### 4.2 Despliegue en Producción sobre Railway
El proyecto incluye detección automática para **Railpack** (`package.json > engines.node = 22.x`), `app.set('trust proxy', 1)`, escucha en `0.0.0.0:${PORT}`, CORS same-origin para HTTPS/WSS y autoseed inicial.

```bash
# 1. Instalar CLI oficial de Railway
npm install -g @railway/cli

# 2. Iniciar sesión en Railway
railway login

# 3. Desplegar el proyecto desde la raíz
railway up

# 4. Generar dominio público HTTPS (*.up.railway.app)
railway domain
```

Variables de entorno recomendadas en Railway (opcionales; el sistema cuenta con valores seguros por defecto):
- `NODE_ENV=production`
- `JWT_SECRET=<clave_secreta_de_alta_entropia>`
- `GRAMOS_ESPESANTE_POR_RACION=2.4`
- `SERVICIOS_HIDRATACION_DIARIOS=4`
- `SQLITE_DB_PATH=/data/capredena_trazabilidad.sqlite` *(si se adjunta un Volumen persistente montado en `/data`)*

---

## 5. Escenario Base de Validación QA (`CP01`–`CP12`)
- **CP01–CP02:** Login Bcrypt/JWT para `CLINICO` y `PRODUCCION`; recuperación con token único (15 min) invalidado tras su uso (`400` en reintento).
- **CP03:** Bloqueo RBAC (`403 Forbidden`) a `PRODUCCION` en mutaciones clínicas y `/api/historial`, más redirección automática desde `/clinico.html`.
- **CP04:** **Sala 1 – Cama 08** inicia **libre** para ingresar `Pac. #071` (`201 Created`, censo pasa a 71) y bloqueo `409 Conflict` al intentar ocupar **Sala 2 – Cama 14**.
- **CP05:** **Pac. #042** (`id=42`) inicia en **Sala 2 – Cama 14** listo para editar a `Diabético Liviano` + `Sólido IDDSI 4` + `Líquido IDDSI 2`, disparando `actualizacion_minuta` vía Socket.IO (`< 2.0s`).
- **CP06:** **Pac. #033** (`id=33`) inicia en **Sala 3 – Cama 19** con historial previo listo para Alta Clínica (`Alta Médica Domiciliaria`), liberando cama y emitiendo alerta roja.
- **CP07–CP08:** Trazabilidad atómica inmutable en `Historial_Minutas` (`PUT`/`DELETE` bloqueados con `405`) y consolidado matemático exacto en `/api/cocina/dashboard` (70 bandejas, 34.3% disfagia, 15 raciones IDDSI 2 = `144.0 g/día` espesante).
- **CP09–CP12:** Protección anti-SQLi (`Prepared Statements`), anti-XSS (`sanitizeText` + `textContent`), Rate Limiting `5 req/min` (`429`), cierre por inactividad `RF10` (con botón/atajo `Alt+Shift+I`) y CSS3 puro `< 15 KB` AAA responsivo (`360px`–`1920px`).
