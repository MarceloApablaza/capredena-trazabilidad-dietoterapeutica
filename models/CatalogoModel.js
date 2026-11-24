/**
 * @file models/CatalogoModel.js
 * @description Capa Modelo (MVC) para la consulta de los catalogos maestros normalizados
 * en Tercera Forma Normal (Regimenes y Consistencias_IDDSI). Permite poblar selectores
 * clinicos estandarizados y validar coherencia de texturas solido vs liquido.
 */

const { db } = require('../config/database');

const stmtAllRegimenes = db.prepare(`
  SELECT id_regimen, nombre_regimen, restriccion_nutricional
  FROM Regimenes
  ORDER BY id_regimen ASC
`);

const stmtRegimenById = db.prepare(`
  SELECT id_regimen, nombre_regimen, restriccion_nutricional
  FROM Regimenes
  WHERE id_regimen = ?
`);

const stmtAllConsistencias = db.prepare(`
  SELECT id_iddsi, nivel_iddsi, nombre_oficial, aplica_a_tipo, descripcion_clinica
  FROM Consistencias_IDDSI
  ORDER BY aplica_a_tipo ASC, nivel_iddsi ASC
`);

const stmtConsistenciaById = db.prepare(`
  SELECT id_iddsi, nivel_iddsi, nombre_oficial, aplica_a_tipo, descripcion_clinica
  FROM Consistencias_IDDSI
  WHERE id_iddsi = ?
`);

const CatalogoModel = {
  /**
   * Obtiene todos los regimenes dietoterapeuticos registrados.
   * @returns {Array<Object>} Lista de regimenes.
   */
  getRegimenes() {
    return stmtAllRegimenes.all();
  },

  /**
   * Obtiene un regimen especifico por su clave primaria.
   * @param {number} idRegimen Identificador del regimen.
   * @returns {Object|undefined} Registro del regimen o undefined.
   */
  getRegimenById(idRegimen) {
    return stmtRegimenById.get(idRegimen);
  },

  /**
   * Obtiene el catalogo completo de consistencias normativas IDDSI (0 al 7)
   * agrupable por aplica_a_tipo ('LIQUIDO' o 'SOLIDO').
   * @returns {Array<Object>} Lista completa de niveles IDDSI.
   */
  getConsistenciasIddsi() {
    return stmtAllConsistencias.all();
  },

  /**
   * Obtiene una consistencia IDDSI por clave primaria para verificar si corresponde
   * estrictamente a LIQUIDO (0-4) o SOLIDO (3-7).
   * @param {number} idIddsi Identificador del registro IDDSI.
   * @returns {Object|undefined} Registro IDDSI o undefined.
   */
  getConsistenciaById(idIddsi) {
    return stmtConsistenciaById.get(idIddsi);
  }
};

module.exports = CatalogoModel;
