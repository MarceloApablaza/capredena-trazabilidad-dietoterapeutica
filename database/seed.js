/**
 * @file database/seed.js
 * @description Poblado automatico e idempotente de datos clinicos realistas para el
 * Centro de Rehabilitacion y Cuidados Institucionalizados CAPREDENA Limache.
 * Genera exactamente:
 *  - 2 Roles RBAC ('CLINICO', 'PRODUCCION')
 *  - 2 Usuarios institucionales con hash Bcrypt (factor de costo = 10 rondas)
 *  - 7 Regimenes dietoterapeuticos maestros
 *  - 10 Consistencias normativas internacionales IDDSI (5 Liquidos + 5 Solidos)
 *  - 70 Pacientes activos hospitalizados (Salas 1 a 4, ~34.3% prevalencia disfagia,
 *    15 con Liquido Nivel 2 Poco Espeso, 16 con Solido Nivel 4 Pure/Papilla)
 *    + 3 Pacientes dados de alta previamente (persistencia historica)
 *  - 285+ Registros inmutables en Historial_Minutas en los ultimos 30 dias,
 *    incluyendo 6 eventos criticos ocurridos en las ultimas 24 horas.
 */

const bcrypt = require('bcryptjs');
const { db, initializeSchema, runInTransaction } = require('../config/database');

/**
 * Formatea un objeto Date en formato UTC SQLite ('YYYY-MM-DD HH:MM:SS')
 * compatible con funciones nativas datetime('now', '-24 hours').
 * @param {Date} date Instancia de fecha a formatear.
 * @returns {string} Cadena de fecha y hora estandarizada en UTC.
 */
function toSqliteUtc(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Calcula una marca temporal desplazada hacia atras respecto del instante actual.
 * @param {number} hoursAgo Cantidad de horas hacia el pasado.
 * @returns {string} Timestamp UTC listo para almacenar en SQLite.
 */
function hoursBeforeNow(hoursAgo) {
  const target = new Date(Date.now() - Math.round(hoursAgo * 3600 * 1000));
  return toSqliteUtc(target);
}

/**
 * Verifica si la base de datos esta vacia y ejecuta el poblado inicial completo
 * dentro de una unica transaccion atomica ACID.
 * @param {boolean} [forceLog=true] Indica si debe imprimir resumen en consola.
 * @returns {{ seeded: boolean, resumen: Object }} Resultado de la operacion.
 */
function ensureSeedData(forceLog = true) {
  initializeSchema();

  const existingRoles = db.prepare('SELECT COUNT(*) AS total FROM Roles').get();
  const existingPatients = db.prepare('SELECT COUNT(*) AS total FROM Pacientes').get();

  if (existingRoles.total > 0 && existingPatients.total > 0) {
    const activos = db
      .prepare('SELECT COUNT(*) AS total FROM Pacientes WHERE estado_hospitalizado = 1')
      .get().total;
    const historial = db
      .prepare('SELECT COUNT(*) AS total FROM Historial_Minutas')
      .get().total;
    return {
      seeded: false,
      resumen: { pacientesActivos: activos, registrosHistorial: historial }
    };
  }

  const resumen = runInTransaction(() => {
    // -------------------------------------------------------------------------
    // 1. ROLES RBAC
    // -------------------------------------------------------------------------
    const insertRol = db.prepare(`
      INSERT INTO Roles (nombre_rol, descripcion_permisos)
      VALUES (?, ?)
    `);

    const rolClinicoId = Number(
      insertRol.run(
        'CLINICO',
        'Nutricionista Clinico: Lectura y escritura integral de censo, prescripcion IDDSI, altas y repositorio Big Data.'
      ).lastInsertRowid
    );

    const rolProduccionId = Number(
      insertRol.run(
        'PRODUCCION',
        'Produccion Cocina: Acceso estricto de solo lectura al monitor mural en tiempo real, KPIs, salas y alertas 24h.'
      ).lastInsertRowid
    );

    // -------------------------------------------------------------------------
    // 2. USUARIOS INSTITUCIONALES (Bcrypt 10 rondas con salt dinamico)
    // -------------------------------------------------------------------------
    const insertUsuario = db.prepare(`
      INSERT INTO Usuarios (
        id_rol, nombre_completo, correo_institucional, password_hash, fecha_creacion, estado_activo
      ) VALUES (?, ?, ?, ?, ?, 1)
    `);

    const saltClinico = bcrypt.genSaltSync(10);
    const hashClinico = bcrypt.hashSync('Clinica2026!', saltClinico);

    const saltCocina = bcrypt.genSaltSync(10);
    const hashCocina = bcrypt.hashSync('Cocina2026!', saltCocina);

    const idUsuarioClinico = Number(
      insertUsuario.run(
        rolClinicoId,
        'Nut. Camila Valdés Morales',
        'nutricion.clinica@capredena.gob.cl',
        hashClinico,
        hoursBeforeNow(24 * 60)
      ).lastInsertRowid
    );

    insertUsuario.run(
      rolProduccionId,
      'Central de Producción Cocina Limache',
      'produccion.cocina@capredena.gob.cl',
      hashCocina,
      hoursBeforeNow(24 * 60)
    );

    // -------------------------------------------------------------------------
    // 3. CATALOGO DE REGIMENES DIETOTERAPEUTICOS (3FN)
    // -------------------------------------------------------------------------
    const regimenesSeed = [
      [
        'Liviano Hiposódico',
        'Bajo aporte lipidico saturado, sin irritantes mucosos y restriccion de sodio (< 2000 mg/dia).'
      ],
      [
        'Diabético Liviano',
        'Control estricto de hidratos de carbono simples, horario fraccionado y preparacion hipograsa.'
      ],
      [
        'Diabético Liviano Hiperproteico',
        'Control glucemico metabolico con suplementacion proteica de alto valor biologico (prevencion sarcopenia).'
      ],
      [
        'Común',
        'Regimen institucional equilibrado completo sin restricciones metabolicas especificas.'
      ],
      [
        'Común Hiperproteico',
        'Alimentacion completa reforzada en proteinas (1.2 a 1.5 g/kg/dia) para rehabilitacion motora y tisular.'
      ],
      [
        'Renal Hiposódico',
        'Restriccion controlada de sodio, potasio, fosforo y ajuste proteico segun etapa nefropatica.'
      ],
      [
        'Blando Gástrico',
        'Proteccion gastrica quimica y mecanica sin frituras, condimentos irritantes ni fibra cruda.'
      ]
    ];

    const insertRegimen = db.prepare(`
      INSERT INTO Regimenes (nombre_regimen, restriccion_nutricional)
      VALUES (?, ?)
    `);

    const regimenesMap = {};
    for (const [nombre, restriccion] of regimenesSeed) {
      const id = Number(insertRegimen.run(nombre, restriccion).lastInsertRowid);
      regimenesMap[nombre] = id;
    }

    // -------------------------------------------------------------------------
    // 4. CATALOGO NORMATIVO INTERNACIONAL IDDSI (5 LIQUIDOS + 5 SOLIDOS)
    // -------------------------------------------------------------------------
    const iddsiSeed = [
      // LIQUIDOS (Niveles 0 al 4)
      [
        0,
        'Fino (Líquido Normal)',
        'LIQUIDO',
        'Fluye rapidamente como el agua sin requerir espesante (< 1 ml residual en jeringa IDDSI a los 10 s).'
      ],
      [
        1,
        'Ligeramente Espeso',
        'LIQUIDO',
        'Viscosidad superior al agua; deja entre 1 y 4 ml en prueba estandarizada de jeringa IDDSI.'
      ],
      [
        2,
        'Poco Espeso',
        'LIQUIDO',
        'Fluye de la cuchara lentamente pero es bebible en vaso; residuo de 4 a 8 ml en jeringa IDDSI (2.4g espesante/racion).'
      ],
      [
        3,
        'Moderadamente Espeso',
        'LIQUIDO',
        'Goteo lento en dientes de tenedor; residuo >= 8 ml en jeringa IDDSI, sin requerir masticacion.'
      ],
      [
        4,
        'Extremadamente Espeso',
        'LIQUIDO',
        'Se administra exclusivamente con cuchara, mantiene forma en el plato y no fluye por bombilla.'
      ],
      // SOLIDOS (Niveles 3 al 7)
      [
        3,
        'Licuado',
        'SOLIDO',
        'Alimento procesado suave y uniforme de goteo lento, libre de grumos, fibras duras o semillas.'
      ],
      [
        4,
        'Puré / Papilla Homogénea',
        'SOLIDO',
        'Textura cohesiva, humeda y sin grumos que mantiene forma en cuchara y no separa liquido.'
      ],
      [
        5,
        'Picado y Húmedo',
        'SOLIDO',
        'Particulas blandas y humedas de tamano maximo 4 mm x 4 mm para adultos con masticacion reducida.'
      ],
      [
        6,
        'Blando y Tamaño Bocado',
        'SOLIDO',
        'Trozos tiernos de maximo 15 mm x 15 mm facilmente compresibles con el dorso del tenedor.'
      ],
      [
        7,
        'Normal / Fácil de Masticar',
        'SOLIDO',
        'Textura solida institucional estandar para residentes con deglucion segura.'
      ]
    ];

    const insertIddsi = db.prepare(`
      INSERT INTO Consistencias_IDDSI (nivel_iddsi, nombre_oficial, aplica_a_tipo, descripcion_clinica)
      VALUES (?, ?, ?, ?)
    `);

    const iddsiLiquido = {};
    const iddsiSolido = {};
    for (const [nivel, nombre, tipo, desc] of iddsiSeed) {
      const id = Number(insertIddsi.run(nivel, nombre, tipo, desc).lastInsertRowid);
      if (tipo === 'LIQUIDO') {
        iddsiLiquido[nivel] = id;
      } else {
        iddsiSolido[nivel] = id;
      }
    }

    // -------------------------------------------------------------------------
    // 5. DISTRIBUCION REALISTA DE 70 PACIENTES ACTIVOS + 3 DADOS DE ALTA
    //    Alineacion quirurgica con Plan de Pruebas QA (CP04, CP05, CP06, CP08):
    //    - Sala 1, Cama 08 LIBRE para CP04 (Nuevo Ingreso Pac. #071)
    //    - Pac. #042 (id=42) activo en Sala 2, Cama 14 (CP04 colision y CP05 edicion)
    //    - Pac. #033 (id=33) activo en Sala 3, Cama 19 con historial previo (CP06 alta)
    // -------------------------------------------------------------------------
    // Distribucion de 70 camas ocupadas en las 4 salas (20 camas c/u -> 10 camas libres):
    // Sala 1: 18 camas (1..7, 9..19 -> Cama 8 y Cama 20 libres)
    // Sala 2: 18 camas (1..18 -> incluye Cama 14; Camas 19 y 20 libres)
    // Sala 3: 17 camas (1..16, 19 -> incluye Cama 19; Camas 17, 18 y 20 libres)
    // Sala 4: 17 camas (1..17 -> Camas 18, 19 y 20 libres)
    const ubicacionesActivas = [];
    for (let cama = 1; cama <= 19; cama++) {
      if (cama !== 8) ubicacionesActivas.push({ sala: 1, cama });
    }
    for (let cama = 1; cama <= 18; cama++) ubicacionesActivas.push({ sala: 2, cama });
    for (let cama = 1; cama <= 16; cama++) ubicacionesActivas.push({ sala: 3, cama });
    ubicacionesActivas.push({ sala: 3, cama: 19 });
    for (let cama = 1; cama <= 17; cama++) ubicacionesActivas.push({ sala: 4, cama });

    // Intercambio biyectivo exacto de 2 pares de posiciones para fijar CP05 y CP06:
    // - Indice 32 (id=33, Pac. #033) <-> Indice 52 (Sala 3, Cama 19)
    // - Indice 41 (id=42, Pac. #042) <-> Indice 31 (Sala 2, Cama 14)
    [ubicacionesActivas[32], ubicacionesActivas[52]] = [
      ubicacionesActivas[52],
      ubicacionesActivas[32]
    ];
    [ubicacionesActivas[41], ubicacionesActivas[31]] = [
      ubicacionesActivas[31],
      ubicacionesActivas[41]
    ];

    // 24 indices especificos (34.3% de 70) distribuidos en las 4 salas con disfagia:
    // - 12 pacientes con Liquido 2 (Poco Espeso) + Solido 4 (Pure / Papilla Homogenea)
    // - 3 pacientes con Liquido 2 (Poco Espeso) + Solido 5 (Picado y Humedo) -> Total Liq 2 = 15
    // - 4 pacientes con Liquido 1 (Ligeramente Espeso) + Solido 4 (Pure / Papilla Homogenea) -> Total Sol 4 = 16
    // - 2 pacientes con Liquido 3 (Moderadamente Espeso) + Solido 3 (Licuado)
    // - 1 paciente con Liquido 4 (Extremadamente Espeso) + Solido 3 (Licuado)
    // - 2 pacientes con Liquido 0 (Fino) + Solido 6 (Blando y Tamano Bocado)
    // Nota QA: idx 41 (Pac. #042) permanece basal (Solido 7 / Liquido 0) para evidenciar
    // el recalculo en vivo de disfagia y espesante al editarlo en CP05.
    const perfilesDisfagia = [
      // 12 perfiles Liquido 2 + Solido 4 (incluye indices 7 [Pac #008] y 24 [Pac #025] para eventos 24h)
      { idx: 1, liq: 2, sol: 4, obs: 'Disfagia orofaríngea post-ACV; hidratación asistida supervisada.' },
      { idx: 4, liq: 2, sol: 4, obs: 'Secuela neurológica; alergia alimentaria a mariscos.' },
      { idx: 7, liq: 2, sol: 4, obs: 'Riesgo aspirativo moderado; espesante 2.4g por servicio.' },
      { idx: 11, liq: 2, sol: 4, obs: 'Enfermedad de Parkinson avanzada; vigilar postura 90°.' },
      { idx: 15, liq: 2, sol: 4, obs: 'Intolerancia a lactosa; usar espesante libre de trazas lácteas.' },
      { idx: 20, liq: 2, sol: 4, obs: 'Disfagia mixta; fraccionar colaciones templadas.' },
      { idx: 24, liq: 2, sol: 4, obs: 'Evaluación fonoaudiológica reciente: exige IDDSI 2 Poco Espeso.' },
      { idx: 30, liq: 2, sol: 4, obs: 'Deterioro cognitivo mayor; asistencia total en alimentación.' },
      { idx: 38, liq: 2, sol: 4, obs: 'Alergia a frutos secos; consistencia papilla homogénea estricta.' },
      { idx: 46, liq: 2, sol: 4, obs: 'Disfagia neurogénica crónica; control diario de ingesta hídrica.' },
      { idx: 55, liq: 2, sol: 4, obs: 'Presbifagia severa; evitar alimentos de doble textura.' },
      { idx: 62, liq: 2, sol: 4, obs: 'Rehabilitación deglutoria; sin irritantes ácidos.' },
      // 3 perfiles Liquido 2 + Solido 5 (completa exactamente 15 con Liquido Nivel 2 Poco Espeso)
      { idx: 9, liq: 2, sol: 5, obs: 'Fatiga masticatoria vespertina; líquidos IDDSI 2 Poco Espeso.' },
      { idx: 28, liq: 2, sol: 5, obs: 'Prótesis dental en ajuste; trozos húmedos máx. 4 mm.' },
      { idx: 50, liq: 2, sol: 5, obs: 'Presbifagia a líquidos finos; tolera picado húmedo.' },
      // 4 perfiles Liquido 1 + Solido 4 (completa exactamente 16 con Solido Nivel 4 Pure/Papilla; incluye idx 44 [Pac #045])
      { idx: 13, liq: 1, sol: 4, obs: 'Edentulismo total; requiere papilla homogénea sin hebras.' },
      { idx: 33, liq: 1, sol: 4, obs: 'Alergia al huevo; textura puré cohesivo.' },
      { idx: 44, liq: 1, sol: 4, obs: 'Ajuste reciente a puré homogéneo por odinofagia.' },
      { idx: 65, liq: 1, sol: 4, obs: 'Sarcopenia deglutoria; enriquecer papilla con módulo proteico.' },
      // 2 perfiles Liquido 3 + Solido 3
      { idx: 19, liq: 3, sol: 3, obs: 'Disfagia severa en seguimiento fonoaudiológico diario.' },
      { idx: 58, liq: 3, sol: 3, obs: 'Administrar en cuchara pequeña; intolerancia al gluten.' },
      // 1 perfil Liquido 4 + Solido 3 (idx 42 = Pac #043; deja libre idx 41 = Pac #042 para CP05)
      { idx: 42, liq: 4, sol: 3, obs: 'Alto riesgo aspirativo; líquidos exclusivamente en cuchara (IDDSI 4).' },
      // 2 perfiles Liquido 0 + Solido 6
      { idx: 26, liq: 0, sol: 6, obs: 'Blando tamaño bocado (15 mm); sin restricción a líquidos finos.' },
      { idx: 67, liq: 0, sol: 6, obs: 'Rehabilitación maxilofacial; alimentos blandos tiernos.' }
    ];

    const mapaDisfagia = new Map(perfilesDisfagia.map((p) => [p.idx, p]));

    // Lista ponderada realista de regimenes hospitalarios geriatricos/rehabilitacion
    const secuenciaRegimenes = [
      'Liviano Hiposódico',
      'Diabético Liviano',
      'Liviano Hiposódico',
      'Diabético Liviano Hiperproteico',
      'Común Hiperproteico',
      'Común',
      'Blando Gástrico',
      'Renal Hiposódico',
      'Liviano Hiposódico',
      'Diabético Liviano'
    ];

    const observacionesEstandar = [
      'Sin alergias alimentarias conocidas.',
      'Intolerancia leve a lactosa; preferir lácteos deslactosados.',
      'Sin alergias conocidas; supervisar hidratación en almuerzo y cena.',
      'Alergia documentada a penicilina (sin alergias alimentarias).',
      'Preferir temperatura templada; buena tolerancia oral.',
      'Control de presión arterial e ingesta de sodio estricta.'
    ];

    const insertPaciente = db.prepare(`
      INSERT INTO Pacientes (
        codigo_ficha, numero_sala, numero_cama, id_regimen_actual,
        id_iddsi_solido, id_iddsi_liquido, observacion_alergias,
        estado_hospitalizado, ultima_actualizacion
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertHistorial = db.prepare(`
      INSERT INTO Historial_Minutas (
        id_paciente, id_usuario_autor, id_regimen_asignado,
        id_iddsi_solido_asignado, id_iddsi_liquido_asignado,
        tipo_movimiento, detalle_clinico, fecha_hora_registro
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const idsRegimenesLista = Object.values(regimenesMap);
    const pacientesInsertados = [];

    // Insercion de los 70 pacientes activos hospitalizados (Pac. #001 a Pac. #070)
    for (let i = 0; i < 70; i++) {
      const numeroFicha = String(i + 1).padStart(3, '0');
      const codigoFicha = `Pac. #${numeroFicha}`;
      const { sala, cama } = ubicacionesActivas[i];

      // Pac. #042 (i=41) inicia con regimen basal Liviano Hiposodico para evidenciar
      // cambio hacia Diabetico Liviano + IDDSI 4 / IDDSI 2 en CP05
      const nombreRegimen =
        i === 41 ? 'Liviano Hiposódico' : secuenciaRegimenes[i % secuenciaRegimenes.length];
      const idRegimen = regimenesMap[nombreRegimen];

      const perfilDisfagia = mapaDisfagia.get(i);
      const nivelLiq = perfilDisfagia ? perfilDisfagia.liq : 0;
      const nivelSol = perfilDisfagia ? perfilDisfagia.sol : 7;
      const idLiq = iddsiLiquido[nivelLiq];
      const idSol = iddsiSolido[nivelSol];
      const observacion = perfilDisfagia
        ? perfilDisfagia.obs
        : observacionesEstandar[i % observacionesEstandar.length];

      // Pac. #069 (i=68) ingreso hace 14h y Pac. #070 (i=69) ingreso hace 2h (ultimas 24h)
      let horasIngreso;
      if (i === 68) {
        horasIngreso = 14;
      } else if (i === 69) {
        horasIngreso = 2;
      } else {
        horasIngreso = 24 * (29 - (i % 26)) + (i % 7);
      }

      // Ultima actualizacion ajustada para quienes tuvieron cambios recientes en las ultimas 24h
      let horasUltimaAct = horasIngreso;
      if (i === 44) horasUltimaAct = 9; // Pac. #045 modificado hace 9h
      if (i === 24) horasUltimaAct = 5; // Pac. #025 modificado hace 5h
      if (i === 7) horasUltimaAct = 3;  // Pac. #008 modificado hace 3h

      const idPaciente = Number(
        insertPaciente.run(
          codigoFicha,
          sala,
          cama,
          idRegimen,
          idSol,
          idLiq,
          observacion,
          1,
          hoursBeforeNow(horasUltimaAct)
        ).lastInsertRowid
      );

      pacientesInsertados.push({
        index: i,
        idPaciente,
        codigoFicha,
        sala,
        cama,
        idRegimen,
        idSol,
        idLiq,
        horasIngreso
      });

      // Registro atomico inicial de INGRESO en Historial_Minutas
      const detalleIngreso =
        i === 69
          ? 'Ingreso hospitalario reciente Sala 4 Cama 17; evaluación nutricional basal completada.'
          : i === 68
          ? 'Ingreso institucional unidad geriátrica Sala 4 Cama 16; pauta dietoterapéutica inicial.'
          : `Ingreso clínico institucional en Sala ${sala}, Cama ${cama} con asignación dietoterapéutica basal.`;

      insertHistorial.run(
        idPaciente,
        idUsuarioClinico,
        idRegimen,
        idSol,
        idLiq,
        'INGRESO',
        detalleIngreso,
        hoursBeforeNow(horasIngreso)
      );
    }

    // Insercion de 3 pacientes historicos dados de alta (estado_hospitalizado = 0)
    // Se usan codigos #081-#083 para dejar 100% libre Pac. #071 para el caso CP04.
    const pacientesEgresadosSeed = [
      {
        codigo: 'Pac. #081',
        sala: 1,
        cama: 20,
        regimen: 'Liviano Hiposódico',
        liq: 0,
        sol: 7,
        horasIngreso: 24 * 25,
        horasAlta: 24 * 12,
        motivoAlta: 'Alta médica por cumplimiento de objetivos de rehabilitación motora.'
      },
      {
        codigo: 'Pac. #082',
        sala: 3,
        cama: 18,
        regimen: 'Diabético Liviano',
        liq: 2,
        sol: 4,
        horasIngreso: 24 * 20,
        horasAlta: 24 * 5,
        motivoAlta: 'Traslado programado a hospital de mayor complejidad con epicrisis nutricional.'
      },
      {
        codigo: 'Pac. #083',
        sala: 4,
        cama: 18,
        regimen: 'Común Hiperproteico',
        liq: 1,
        sol: 6,
        horasIngreso: 24 * 16,
        horasAlta: 1.2, // Evento de ALTA dentro de las ultimas 24 horas!
        motivoAlta: 'Alta clínica confirmada a domicilio; suspender preparación de bandeja Sala 4 Cama 18.'
      }
    ];

    for (const egreso of pacientesEgresadosSeed) {
      const idReg = regimenesMap[egreso.regimen];
      const idLiq = iddsiLiquido[egreso.liq];
      const idSol = iddsiSolido[egreso.sol];

      const idPacEgresado = Number(
        insertPaciente.run(
          egreso.codigo,
          egreso.sala,
          egreso.cama,
          idReg,
          idSol,
          idLiq,
          'Registro histórico preservado (paciente egresado).',
          0,
          hoursBeforeNow(egreso.horasAlta)
        ).lastInsertRowid
      );

      insertHistorial.run(
        idPacEgresado,
        idUsuarioClinico,
        idReg,
        idSol,
        idLiq,
        'INGRESO',
        `Ingreso clínico previo en Sala ${egreso.sala}, Cama ${egreso.cama}.`,
        hoursBeforeNow(egreso.horasIngreso)
      );

      insertHistorial.run(
        idPacEgresado,
        idUsuarioClinico,
        idReg,
        idSol,
        idLiq,
        'ALTA',
        egreso.motivoAlta,
        hoursBeforeNow(egreso.horasAlta)
      );
    }

    // -------------------------------------------------------------------------
    // 6. GENERACION DE > 250 EVENTOS HISTORICOS BIG DATA EN LOS ULTIMOS 30 DIAS
    // -------------------------------------------------------------------------
    // Generamos 210 evoluciones historicas entre el dia -28 y hace 28 horas
    const motivosEvolucion = [
      'Ajuste de densidad calórica-proteica tras control antropométrico semanal.',
      'Adecuación de sodio y aporte hídrico según balance electrolítico.',
      'Reevaluación fonoaudiológica de seguridad deglutoria en horario de almuerzo.',
      'Modificación terapéutica por glicemia capilar postprandial.',
      'Transición progresiva de textura según tolerancia oral observada en sala.',
      'Optimización de consistencia por fatiga masticatoria documentada por enfermería.'
    ];

    for (let k = 0; k < 210; k++) {
      // Seleccionamos pacientes del #001 al #068 (que ingresaron hace varios dias)
      const pac = pacientesInsertados[k % 68];
      // Distribuimos uniformemente entre hace 28 horas y hace 660 horas (~27.5 dias)
      const horasEvento = 28 + Math.floor((k * 620) / 210);
      const horasSeguras = Math.min(horasEvento, Math.max(26, pac.horasIngreso - 2));

      const idRegHist = idsRegimenesLista[(k + pac.index) % idsRegimenesLista.length];
      insertHistorial.run(
        pac.idPaciente,
        idUsuarioClinico,
        idRegHist,
        pac.idSol,
        pac.idLiq,
        'MODIFICACION',
        motivosEvolucion[k % motivosEvolucion.length],
        hoursBeforeNow(horasSeguras)
      );
    }

    // Eventos criticos recientes adicionales en las ultimas 24 horas (total = 6 eventos < 24h)
    const pac045 = pacientesInsertados[44]; // Sala 3, Cama 9
    insertHistorial.run(
      pac045.idPaciente,
      idUsuarioClinico,
      pac045.idRegimen,
      iddsiSolido[4],
      iddsiLiquido[1],
      'MODIFICACION',
      'Cambio crítico a Sólido IDDSI 4 (Puré / Papilla Homogénea) y Líquido IDDSI 1 por odinofagia.',
      hoursBeforeNow(9)
    );

    const pac025 = pacientesInsertados[24]; // Sala 2, Cama 7
    insertHistorial.run(
      pac025.idPaciente,
      idUsuarioClinico,
      pac025.idRegimen,
      iddsiSolido[4],
      iddsiLiquido[2],
      'MODIFICACION',
      'Alerta fonoaudiológica: Transición urgente a Líquido IDDSI 2 (Poco Espeso) y Sólido IDDSI 4 (Papilla).',
      hoursBeforeNow(5)
    );

    const pac008 = pacientesInsertados[7]; // Sala 1, Cama 9 (Cama 8 libre para CP04)
    insertHistorial.run(
      pac008.idPaciente,
      idUsuarioClinico,
      pac008.idRegimen,
      iddsiSolido[4],
      iddsiLiquido[2],
      'MODIFICACION',
      'Indicación crítica de Líquido IDDSI 2 (Poco Espeso - 2.4g espesante) por riesgo aspirativo.',
      hoursBeforeNow(3)
    );

    const totalActivos = db
      .prepare('SELECT COUNT(*) AS total FROM Pacientes WHERE estado_hospitalizado = 1')
      .get().total;
    const totalEgresados = db
      .prepare('SELECT COUNT(*) AS total FROM Pacientes WHERE estado_hospitalizado = 0')
      .get().total;
    const totalHistorial = db
      .prepare('SELECT COUNT(*) AS total FROM Historial_Minutas')
      .get().total;

    return {
      pacientesActivos: totalActivos,
      pacientesEgresados: totalEgresados,
      registrosHistorial: totalHistorial
    };
  });

  if (forceLog) {
    console.log(
      `[SEED CAPREDENA] Base de datos inicializada exitosamente: ` +
        `${resumen.pacientesActivos} pacientes activos, ` +
        `${resumen.pacientesEgresados} egresados historicos y ` +
        `${resumen.registrosHistorial} transacciones Big Data en Historial_Minutas.`
    );
  }

  return { seeded: true, resumen };
}

/**
 * Restaura limpiamente la base de datos al escenario base demo de 70 pacientes activos
 * y 286 registros inmutables en Historial_Minutas dentro de una transaccion ACID,
 * reiniciando secuencias AUTOINCREMENT para mantener reproducibles CP04, CP05 y CP06.
 * @param {boolean} [forceLog=false] Indica si imprime resumen en consola.
 * @returns {{ seeded: boolean, resumen: Object }} Resumen del censo restaurado.
 */
function resetSeedData(forceLog = false) {
  runInTransaction(() => {
    // Eliminacion ordenada respetando integridad referencial (FOREIGN KEYS = ON)
    db.exec(`
      DELETE FROM Historial_Minutas;
      DELETE FROM Pacientes;
      DELETE FROM Usuarios;
      DELETE FROM Roles;
      DELETE FROM Regimenes;
      DELETE FROM Consistencias_IDDSI;
      DELETE FROM sqlite_sequence;
    `);
  });

  return ensureSeedData(forceLog);
}

// Permite ejecucion directa por CLI mediante "npm run seed" (o "--reset")
if (require.main === module) {
  if (process.argv.includes('--reset')) {
    resetSeedData(true);
  } else {
    ensureSeedData(true);
  }
}

module.exports = {
  ensureSeedData,
  resetSeedData
};
