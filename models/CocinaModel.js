/**
 * @file models/CocinaModel.js
 * @description Capa Modelo (MVC) especializada en consultas SQL agregadas de alto
 * rendimiento para el Monitor Mural de la Central de Alimentacion (Cocina).
 * Consolida KPIs en tiempo real, proyeccion automatica de gramos de espesante diario,
 * series analiticas Big Data por Regimen/IDDSI, alertas de las ultimas 24 horas y
 * matriz fisica de despacho por Sala y Cama.
 */

const { db } = require('../config/database');
const env = require('../config/env');

// =============================================================================
// CONSULTAS AGREGADAS SQL DE ALTO RENDIMIENTO PARA MONITOR MURAL DE COCINA
// =============================================================================
// 1. Consulta SQL agregada para obtener KPIs clinicos y nutricionales en una sola pasada:
//    - Total de bandejas activas en las 4 salas hospitalarias
//    - Total de residentes con disfagia (IDDSI Solido < 7 o Liquido > 0)
//    - Total de raciones diarias con Liquidos Nivel 2 (Poco Espeso) para calculo de insumo
const stmtKpisActivos = db.prepare(`
  SELECT
    COUNT(*) AS total_bandejas_activas,
    SUM(CASE WHEN sol.nivel_iddsi < 7 OR liq.nivel_iddsi > 0 THEN 1 ELSE 0 END) AS pacientes_disfagia,
    SUM(CASE WHEN liq.aplica_a_tipo = 'LIQUIDO' AND liq.nivel_iddsi = 2 THEN 1 ELSE 0 END) AS raciones_poco_espeso
  FROM Pacientes p
  INNER JOIN Consistencias_IDDSI sol ON sol.id_iddsi = p.id_iddsi_solido
  INNER JOIN Consistencias_IDDSI liq ON liq.id_iddsi = p.id_iddsi_liquido
  WHERE p.estado_hospitalizado = 1
`);

// Conteo indexado de eventos ocurridos dentro de la ventana movil de las ultimas 24 horas
const stmtConteoNovedades24h = db.prepare(`
  SELECT COUNT(*) AS total
  FROM Historial_Minutas
  WHERE fecha_hora_registro >= datetime('now', '-24 hours')
`);

// 2. Consultas agregadas con LEFT JOIN sobre catalogos maestros para renderizar
//    las barras horizontales dinamicas en CSS3 puro incluyendo niveles con 0 pacientes.
const stmtSerieRegimenes = db.prepare(`
  SELECT
    r.id_regimen,
    r.nombre_regimen,
    COUNT(p.id_paciente) AS cantidad
  FROM Regimenes r
  LEFT JOIN Pacientes p
    ON p.id_regimen_actual = r.id_regimen
   AND p.estado_hospitalizado = 1
  GROUP BY r.id_regimen, r.nombre_regimen
  ORDER BY cantidad DESC, r.nombre_regimen ASC
`);

// Agrupacion parametrizada por tipo de consistencia normativa ('SOLIDO' o 'LIQUIDO')
const stmtSerieIddsiPorTipo = db.prepare(`
  SELECT
    c.id_iddsi,
    c.nivel_iddsi,
    c.nombre_oficial,
    c.aplica_a_tipo,
    COUNT(p.id_paciente) AS cantidad
  FROM Consistencias_IDDSI c
  LEFT JOIN Pacientes p
    ON (
      (c.aplica_a_tipo = 'SOLIDO' AND p.id_iddsi_solido = c.id_iddsi) OR
      (c.aplica_a_tipo = 'LIQUIDO' AND p.id_iddsi_liquido = c.id_iddsi)
    )
   AND p.estado_hospitalizado = 1
  WHERE c.aplica_a_tipo = ?
  GROUP BY c.id_iddsi, c.nivel_iddsi, c.nombre_oficial, c.aplica_a_tipo
  ORDER BY c.nivel_iddsi ASC
`);

// 3. Listado cronologico de alertas clinicas tempranas ocurridas en las ultimas 24 horas
const stmtAlertas24h = db.prepare(`
  SELECT
    h.id_historial,
    h.tipo_movimiento,
    h.detalle_clinico,
    h.fecha_hora_registro,
    p.id_paciente,
    p.codigo_ficha,
    p.numero_sala,
    p.numero_cama,
    r.nombre_regimen,
    sol.nivel_iddsi AS nivel_iddsi_solido,
    sol.nombre_oficial AS nombre_iddsi_solido,
    liq.nivel_iddsi AS nivel_iddsi_liquido,
    liq.nombre_oficial AS nombre_iddsi_liquido,
    u.nombre_completo AS profesional_autor
  FROM Historial_Minutas h
  INNER JOIN Pacientes p ON p.id_paciente = h.id_paciente
  INNER JOIN Regimenes r ON r.id_regimen = h.id_regimen_asignado
  INNER JOIN Consistencias_IDDSI sol ON sol.id_iddsi = h.id_iddsi_solido_asignado
  INNER JOIN Consistencias_IDDSI liq ON liq.id_iddsi = h.id_iddsi_liquido_asignado
  INNER JOIN Usuarios u ON u.id_usuario = h.id_usuario_autor
  WHERE h.fecha_hora_registro >= datetime('now', '-24 hours')
  ORDER BY h.fecha_hora_registro DESC, h.id_historial DESC
`);

// 4. Consulta para construir la matriz completa de despacho de bandejas por Sala y Cama
const stmtPacientesMapa = db.prepare(`
  SELECT
    p.id_paciente,
    p.codigo_ficha,
    p.numero_sala,
    p.numero_cama,
    p.observacion_alergias,
    r.nombre_regimen,
    sol.nivel_iddsi AS nivel_iddsi_solido,
    sol.nombre_oficial AS nombre_iddsi_solido,
    liq.nivel_iddsi AS nivel_iddsi_liquido,
    liq.nombre_oficial AS nombre_iddsi_liquido
  FROM Pacientes p
  INNER JOIN Regimenes r ON r.id_regimen = p.id_regimen_actual
  INNER JOIN Consistencias_IDDSI sol ON sol.id_iddsi = p.id_iddsi_solido
  INNER JOIN Consistencias_IDDSI liq ON liq.id_iddsi = p.id_iddsi_liquido
  WHERE p.estado_hospitalizado = 1
  ORDER BY p.numero_sala ASC, p.numero_cama ASC
`);

const CocinaModel = {
  /**
   * Construye la fotografia operativa completa para el Monitor Mural de Cocina.
   * @returns {Object} KPIs, series porcentuales, alertas 24h y matriz Sala/Cama.
   */
  getDashboardData() {
    const rawKpis = stmtKpisActivos.get();
    const totalActivos = rawKpis.total_bandejas_activas || 0;
    const pacientesDisfagia = rawKpis.pacientes_disfagia || 0;
    const racionesPocoEspeso = rawKpis.raciones_poco_espeso || 0;
    const novedades24h = stmtConteoNovedades24h.get().total || 0;

    const porcentajeDisfagia =
      totalActivos > 0
        ? Number(((pacientesDisfagia / totalActivos) * 100).toFixed(1))
        : 0;

    // Proyeccion automatica diaria de espesante (ej. 15 pac * 2.4g * 4 servicios = 144.0 g/dia)
    const gramosEspesanteDiario = Number(
      (
        racionesPocoEspeso *
        env.GRAMOS_ESPESANTE_POR_RACION *
        env.SERVICIOS_HIDRATACION_DIARIOS
      ).toFixed(1)
    );

    // Calculo porcentual seguro redondeado a 1 decimal evitando division por cero
    const calcPct = (cant) =>
      totalActivos > 0 ? Number(((cant / totalActivos) * 100).toFixed(1)) : 0;

    // Serie porcentual de produccion agrupada por Regimen Dietoterapeutico
    const porRegimen = stmtSerieRegimenes.all().map((row) => ({
      ...row,
      porcentaje: calcPct(row.cantidad)
    }));

    // Serie porcentual de produccion agrupada por Consistencias IDDSI Solidos (3 a 7)
    const porIddsiSolido = stmtSerieIddsiPorTipo.all('SOLIDO').map((row) => ({
      ...row,
      porcentaje: calcPct(row.cantidad)
    }));

    // Serie porcentual de produccion agrupada por Consistencias IDDSI Liquidos (0 a 4)
    const porIddsiLiquido = stmtSerieIddsiPorTipo.all('LIQUIDO').map((row) => ({
      ...row,
      porcentaje: calcPct(row.cantidad)
    }));

    // Recupera todas las alertas tempranas emitidas en las ultimas 24 horas
    const alertas24h = stmtAlertas24h.all();

    // Construccion de matriz estructurada por Sala (1..4) y Cama (1..20)
    // Permite al personal de cocina verificar exactamente que bandeja despachar a cada cama
    const activosLista = stmtPacientesMapa.all();
    const mapaOcupacion = new Map(
      activosLista.map((p) => [`${p.numero_sala}-${p.numero_cama}`, p])
    );

    const mapaSalas = env.SALAS_TOTALES.map((sala) => {
      const camas = [];
      let ocupadasSala = 0;

      for (let cama = 1; cama <= env.CAMAS_POR_SALA; cama++) {
        const ocupante = mapaOcupacion.get(`${sala}-${cama}`);
        if (ocupante) {
          ocupadasSala++;
          camas.push({
            numero_sala: sala,
            numero_cama: cama,
            ocupada: true,
            codigo_ficha: ocupante.codigo_ficha,
            nombre_regimen: ocupante.nombre_regimen,
            nivel_iddsi_solido: ocupante.nivel_iddsi_solido,
            nombre_iddsi_solido: ocupante.nombre_iddsi_solido,
            nivel_iddsi_liquido: ocupante.nivel_iddsi_liquido,
            nombre_iddsi_liquido: ocupante.nombre_iddsi_liquido,
            observacion_alergias: ocupante.observacion_alergias,
            requiere_alerta_disfagia:
              ocupante.nivel_iddsi_solido < 7 || ocupante.nivel_iddsi_liquido > 0
          });
        } else {
          camas.push({
            numero_sala: sala,
            numero_cama: cama,
            ocupada: false
          });
        }
      }

      return {
        numero_sala: sala,
        camas_ocupadas: ocupadasSala,
        camas_libres: env.CAMAS_POR_SALA - ocupadasSala,
        camas
      };
    });

    return {
      generado_en: new Date().toISOString(),
      kpis: {
        total_bandejas_activas: totalActivos,
        pacientes_disfagia: pacientesDisfagia,
        porcentaje_disfagia: porcentajeDisfagia,
        raciones_liquido_poco_espeso: racionesPocoEspeso,
        gramos_espesante_por_racion: env.GRAMOS_ESPESANTE_POR_RACION,
        servicios_diarios: env.SERVICIOS_HIDRATACION_DIARIOS,
        gramos_espesante_diario: gramosEspesanteDiario,
        novedades_24h: novedades24h
      },
      series: {
        por_regimen: porRegimen,
        por_iddsi_solido: porIddsiSolido,
        por_iddsi_liquido: porIddsiLiquido
      },
      alertas_24h: alertas24h,
      mapa_salas: mapaSalas
    };
  }
};

module.exports = CocinaModel;
