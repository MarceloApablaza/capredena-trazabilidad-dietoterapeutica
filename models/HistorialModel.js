/**
 * @file models/HistorialModel.js
 * @description Capa Modelo (MVC) para la explotacion analitica y auditoria medico-legal
 * de la Tabla de Hechos Inmutable Historial_Minutas (Repositorio Big Data Clinico).
 * Permite paginacion y filtrado seguro parametrizado por tipo de movimiento, paciente
 * y rango de fechas, entregando metricas acumuladas del periodo.
 */

const { db } = require('../config/database');

// Resumen global inmutable del repositorio Big Data
const stmtResumenGlobal = db.prepare(`
  SELECT
    COUNT(*) AS total_transacciones_historicas,
    SUM(CASE WHEN tipo_movimiento = 'INGRESO' THEN 1 ELSE 0 END) AS total_ingresos,
    SUM(CASE WHEN tipo_movimiento = 'MODIFICACION' THEN 1 ELSE 0 END) AS total_modificaciones,
    SUM(CASE WHEN tipo_movimiento = 'ALTA' THEN 1 ELSE 0 END) AS total_altas
  FROM Historial_Minutas
`);

const stmtTopRegimenHistorico = db.prepare(`
  SELECT r.nombre_regimen, COUNT(*) AS asignaciones
  FROM Historial_Minutas h
  INNER JOIN Regimenes r ON r.id_regimen = h.id_regimen_asignado
  GROUP BY h.id_regimen_asignado, r.nombre_regimen
  ORDER BY asignaciones DESC
  LIMIT 1
`);

const HistorialModel = {
  /**
   * Consulta paginada y filtrable de Historial_Minutas usando marcadores posicionales
   * seguros (?) contra inyeccion SQL.
   * @param {Object} filtros Parametros validados de consulta.
   * @param {string} [filtros.tipo_movimiento] 'INGRESO' | 'MODIFICACION' | 'ALTA'
   * @param {string} [filtros.paciente] Codigo de ficha parcial o exacto (ej. '008').
   * @param {string} [filtros.fecha_desde] Fecha inicial YYYY-MM-DD.
   * @param {string} [filtros.fecha_hasta] Fecha final YYYY-MM-DD.
   * @param {number} [filtros.pagina=1] Pagina solicitada (>= 1).
   * @param {number} [filtros.limite=25] Tamano de pagina (1 a 100).
   * @returns {Object} Registros paginados y estadisticas acumuladas Big Data.
   */
  consultarHistorial({
    tipo_movimiento = '',
    paciente = '',
    fecha_desde = '',
    fecha_hasta = '',
    pagina = 1,
    limite = 25
  }) {
    const clauses = [];
    const params = [];

    if (
      tipo_movimiento &&
      ['INGRESO', 'MODIFICACION', 'ALTA'].includes(tipo_movimiento)
    ) {
      clauses.push('h.tipo_movimiento = ?');
      params.push(tipo_movimiento);
    }

    if (paciente) {
      clauses.push('LOWER(p.codigo_ficha) LIKE LOWER(?)');
      params.push(`%${paciente}%`);
    }

    if (fecha_desde) {
      clauses.push('h.fecha_hora_registro >= ?');
      params.push(`${fecha_desde} 00:00:00`);
    }

    if (fecha_hasta) {
      clauses.push('h.fecha_hora_registro <= ?');
      params.push(`${fecha_hasta} 23:59:59`);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const countQuery = db.prepare(`
      SELECT COUNT(*) AS total
      FROM Historial_Minutas h
      INNER JOIN Pacientes p ON p.id_paciente = h.id_paciente
      ${whereSql}
    `);

    const totalFiltrado = countQuery.get(...params).total || 0;
    const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / limite));
    const paginaSegura = Math.min(Math.max(1, pagina), totalPaginas);
    const offset = (paginaSegura - 1) * limite;

    const dataQuery = db.prepare(`
      SELECT
        h.id_historial,
        h.tipo_movimiento,
        h.detalle_clinico,
        h.fecha_hora_registro,
        p.id_paciente,
        p.codigo_ficha,
        p.numero_sala,
        p.numero_cama,
        p.estado_hospitalizado,
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
      ${whereSql}
      ORDER BY h.fecha_hora_registro DESC, h.id_historial DESC
      LIMIT ? OFFSET ?
    `);

    const registros = dataQuery.all(...params, limite, offset);
    const globalStats = stmtResumenGlobal.get();
    const topRegimen = stmtTopRegimenHistorico.get();

    return {
      estadisticas_acumuladas: {
        total_transacciones_historicas: globalStats.total_transacciones_historicas || 0,
        total_ingresos: globalStats.total_ingresos || 0,
        total_modificaciones: globalStats.total_modificaciones || 0,
        total_altas: globalStats.total_altas || 0,
        regimen_mas_prescrito: topRegimen ? topRegimen.nombre_regimen : 'N/A',
        asignaciones_regimen_lider: topRegimen ? topRegimen.asignaciones : 0
      },
      paginacion: {
        pagina_actual: paginaSegura,
        limite,
        total_registros_filtrados: totalFiltrado,
        total_paginas: totalPaginas
      },
      registros
    };
  }
};

module.exports = HistorialModel;
