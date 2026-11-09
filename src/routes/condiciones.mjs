// Condiciones SUGERIDAS para verificar en cada paso.
// Son preguntas para que confirmes vos con la fuente (banco, broker, exchange, BCRA, CNV, ARCA),
// no reglas: la app no afirma qué está permitido ni qué impuestos aplican. Se pueden editar o borrar.
import { activoPorId, corto } from './activos.mjs';

export const TIPOS_CONDICION = {
  plataforma: 'Plataforma',
  cuenta: 'Cuenta',
  normativa: 'Normativa',
  costos: 'Costos',
  liquidez: 'Liquidez',
  riesgo: 'Riesgo',
  otro: 'Otro',
};

const familia = (id) => activoPorId(id)?.familia;

/** @returns {Array<{tipo: string, texto: string}>} */
export function condicionesSugeridas(desde, hacia) {
  const out = [];
  const add = (tipo, texto) => out.push({ tipo, texto });
  const a = corto(desde);
  const b = corto(hacia);
  const fa = familia(desde);
  const fb = familia(hacia);

  add('plataforma', `Confirmar que la plataforma opera ${a} → ${b}, en qué horario y con qué mínimos y máximos.`);

  if (hacia !== 'ARS' && hacia !== 'USD_BILLETE') {
    add('cuenta', `Tener una cuenta a tu nombre habilitada para recibir ${activoPorId(hacia)?.nombre ?? b}.`);
  }
  if (desde === 'ARS' && hacia === 'USD_BANCO') {
    add('normativa', 'Verificar la normativa cambiaria vigente para comprar USD oficial (BCRA / ARCA), a la fecha de la operación.');
    add('costos', 'Confirmar qué impuestos o percepciones aplican hoy a esta compra y cargarlos en "Impuestos %".');
  }
  if (fa === 'usd' && fb === 'usd') {
    add('normativa', 'Verificar si hay restricciones cruzadas o plazos mínimos de tenencia (BCRA / CNV) que apliquen a tu caso, a la fecha de la operación.');
  }
  const conBroker = ['USD_MEP', 'USD_CABLE'].includes(desde) || ['USD_MEP', 'USD_CABLE'].includes(hacia);
  if (conBroker && fa !== 'cripto' && fb !== 'cripto') {
    add('costos', 'Confirmar con el broker el instrumento, el plazo de liquidación y el costo total (comisión y derechos de mercado).');
    if (fa !== 'usd' || fb !== 'usd') {
      add('normativa', 'Verificar si hay restricciones cruzadas o plazos mínimos de tenencia (BCRA / CNV) que apliquen a tu caso, a la fecha de la operación.');
    }
  }
  if (fa === 'cripto' || fb === 'cripto') {
    add('costos', 'Confirmar comisiones de la plataforma, de red y de retiro, y el tiempo de acreditación.');
    add('normativa', 'Verificar el tratamiento impositivo y los límites para operar cripto, a la fecha de la operación.');
  }
  if (fa === 'cripto' && fb === 'usd') {
    add('plataforma', `Confirmar que podés retirar a una cuenta de ${b} a tu nombre y con qué costo.`);
  }
  if (desde === 'USD_BILLETE' || hacia === 'USD_BILLETE') {
    add('riesgo', 'El USD billete del mercado informal no tiene respaldo legal ni garantía de contraparte: evaluar si corresponde considerarlo.');
  }
  return out;
}
