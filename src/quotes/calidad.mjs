// Problemas de calidad de una cotización. Algunos la invalidan (no se usa para calcular);
// otros sólo generan un aviso (se usa, pero se muestra la advertencia).
export const PROBLEMAS = {
  compra_invalida: { invalida: true, texto: 'el precio de compra de la fuente no es un número válido' },
  venta_invalida: { invalida: true, texto: 'el precio de venta de la fuente no es un número válido' },
  venta_ausente: { invalida: true, texto: 'la fuente no informó precio de venta' },
  puntas_invertidas: { invalida: true, texto: 'la venta es menor que la compra' },
  moneda_inesperada: { invalida: true, texto: 'la fuente informó otra moneda' },
  incompleto: { invalida: true, texto: 'falta compra o venta' },
  precio_fuera_de_rango: { invalida: true, texto: 'la fuente informó un precio imposible (menos de $ 0,01 o más de $ 1.000 millones)' },
  compra_ausente: { invalida: false, texto: 'la fuente no informó precio de compra (no se puede vender acá)' },
  fecha_invalida: { invalida: false, texto: 'la fuente no informó de cuándo es el dato' },
  fecha_futura: { invalida: false, texto: 'la fuente informa una fecha del futuro: no se sabe de cuándo es el dato' },
  spread_inusual: { invalida: false, texto: 'la diferencia entre compra y venta es inusualmente grande' },
  salto_brusco: { invalida: false, texto: 'cambió bruscamente respecto del dato anterior: revisalo' },
  sin_dato_en_ultima_consulta: { invalida: false, texto: 'no vino en la última consulta' },
};

/** Umbrales de los avisos (en %). */
export const UMBRAL_SPREAD_PCT = 20;
export const UMBRAL_SALTO_PCT = 10;

/** Rango posible de un precio en ARS por dólar. Fuera de esto es un dato roto, no una cotización. */
export const PRECIO_MINIMO = 0.01;
export const PRECIO_MAXIMO = 1e9;
/** Diferencia de reloj tolerada: una fecha más adelante que esto se considera "del futuro". */
export const TOLERANCIA_FUTURO_MS = 5 * 60e3;

export const esValido = (problemas = []) => !problemas.some((p) => PROBLEMAS[p]?.invalida ?? true);
export const textoProblema = (p) => PROBLEMAS[p]?.texto ?? p;
