// Chat con Claude (pedido del propietario 11/11/2026: "el chat es malísimo, ¿cómo le integramos Claude?").
// Acordado: la clave de la API de Anthropic la pega él en la app y queda SÓLO en su navegador (localStorage); la app
// es pública (GitHub Pages) y nunca lleva una clave en el código. Sin clave, el chat sigue con el reconocedor de antes.
// Se llama a la API por HTTP directo (fetch): la app no tiene compilación ni servidor, así que no puede usar el SDK.
// Claude no inventa números: tiene herramientas que leen las cotizaciones de la app y calculan con el motor exacto.
// Bucle manual de herramientas: mientras stop_reason sea "tool_use", se ejecutan y se devuelven todos los resultados
// en un solo mensaje. El contenido de cada respuesta (con sus bloques de pensamiento) se guarda tal cual.

export const URL_CLAUDE = 'https://api.anthropic.com/v1/messages';
export const MODELO = 'claude-opus-5-5';
export const KEY_CLAVE = 'brecha.claude.clave.v1';
const VERSION_API = '2023-06-01';
const BETA_FALLBACK = 'server-side-fallback-2026-07-01';
const MAX_VUELTAS = 8;
const MAX_MENSAJES = 60;

export const SISTEMA = `Sos el asistente de Brecha, el simulador cambiario personal de Markz (Argentina). Hablás en español rioplatense, informal y directo, con respuestas cortas: primero el número o la respuesta, después una o dos líneas de explicación.

Su operativa habitual (en este orden): con pesos compra dólares billete en la calle (blue; si cargó su "blue de la calle", ese es su precio real, si no usá el blue de DolarAPI y aclaralo), con esos billetes consigue USDT pagando un porcentaje más por cada USDT (él dice "al 2 %": cada USDT le sale 1,02 dólares) y los recibe directo en la wallet donde después los vende por pesos: NO pasa los USDT por otra wallet, así que no hay costo de transferencia ni retiro. Aparte del % de los USDT no le cobran nada más (ni comisiones ni impuestos): no le adviertas por costos que no tiene, salvo que él mencione uno nuevo. Si te dice a cuánto consigue el blue en la calle, guardalo con la herramienta del blue de la calle.

Reglas:
- Nunca inventes una cotización ni un resultado. Para cualquier precio de hoy usá la herramienta de cotizaciones; para cualquier cuenta de la operativa usá la herramienta de cálculo (es exacta); para preguntas del pasado usá el histórico. Si un dato no está, decilo y preguntá.
- Si le falta un dato para la cuenta (por ejemplo el % de los USDT), preguntáselo; no lo supongas gratis.
- Cuando uses un precio, decí de dónde sale y de cuándo es si es viejo.
- Montos en formato argentino: $ 1.234.567,89 y porcentajes con coma.
- Brecha es sólo simulación: no opera ni ejecuta nada. No des consejos de inversión; mostrá las cuentas y los riesgos concretos (precio que cambia, comisiones que no cargó).
- Texto simple, sin tablas ni títulos; como mucho una lista corta.`;

/** Mensaje de error entendible según lo que devolvió la API. */
function errorDe(status, cuerpo) {
  const detalle = cuerpo?.error?.message ? ` (${String(cuerpo.error.message).slice(0, 200)})` : '';
  if (status === 401) return 'La clave de Claude no es válida o fue borrada: revisala en «Conectar Claude».';
  if (status === 403) return `Esa clave no tiene permiso para usar este modelo${detalle}.`;
  if (status === 429) return 'Claude pidió esperar (límite de uso): probá en un minuto.';
  if (status === 529 || status >= 500) return 'Claude está saturado en este momento: probá de nuevo en un rato.';
  if (status === 400 && /credit|billing|balance/i.test(detalle)) return 'La cuenta de Anthropic no tiene saldo: cargá crédito en console.anthropic.com.';
  return `Claude respondió un error ${status}${detalle}.`;
}

/**
 * @param {{fetch?: typeof fetch, getClave: () => string|null, herramientas: Array<{name: string, description: string, input_schema: object, run: (input: object) => Promise<object>|object}>, sistema?: string, modelo?: string}} deps
 */
export function crearClaude({ fetch: f = globalThis.fetch?.bind(globalThis), getClave, herramientas, sistema = SISTEMA, modelo = MODELO }) {
  let mensajes = [];
  let conFallback = true; // si la API no acepta el parámetro, se reintenta sin él y no se vuelve a mandar
  const tools = herramientas.map((h) => ({ name: h.name, description: h.description, input_schema: h.input_schema }));

  async function pedir() {
    const cuerpo = { model: modelo, max_tokens: 16000, system: sistema, tools, messages: mensajes, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } };
    const cabeceras = { 'content-type': 'application/json', 'x-api-key': getClave(), 'anthropic-version': VERSION_API, 'anthropic-dangerous-direct-browser-access': 'true' };
    if (conFallback) { cuerpo.fallbacks = 'default'; cabeceras['anthropic-beta'] = BETA_FALLBACK; }
    let r;
    try {
      r = await f(URL_CLAUDE, { method: 'POST', headers: cabeceras, body: JSON.stringify(cuerpo) });
    } catch {
      return { ok: false, error: 'No pude conectarme con Claude: revisá tu conexión.' };
    }
    let json = null;
    try { json = await r.json(); } catch { /* sin cuerpo */ }
    if (r.status === 400 && conFallback && /fallback|beta/i.test(json?.error?.message ?? '')) { conFallback = false; return pedir(); }
    if (!r.ok) return { ok: false, error: errorDe(r.status, json) };
    if (!json || !Array.isArray(json.content)) return { ok: false, error: 'Claude devolvió una respuesta que no entiendo.' };
    return { ok: true, json };
  }

  /**
   * Una pregunta del usuario → texto final de Claude (después de usar las herramientas que haga falta).
   * @returns {Promise<{ok: true, texto: string, usadas: string[]} | {ok: false, error: string}>}
   */
  async function preguntar(texto) {
    if (!getClave()) return { ok: false, error: 'Falta la clave de Claude.' };
    if (mensajes.length > MAX_MENSAJES) mensajes = []; // conversación muy larga: arranca de nuevo
    const antes = mensajes.length;
    mensajes.push({ role: 'user', content: String(texto).slice(0, 2000) });
    const usadas = [];
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const r = await pedir();
      if (!r.ok) { mensajes.length = antes; return r; }
      const { content, stop_reason: motivo } = r.json;
      const textoDe = () => content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (motivo === 'refusal') { mensajes.length = antes; return { ok: false, error: 'Claude no puede responder eso. Probá preguntarlo de otra forma.' }; }
      mensajes.push({ role: 'assistant', content });
      if (motivo !== 'tool_use') {
        const t = textoDe();
        return { ok: true, texto: t ? `${t}${motivo === 'max_tokens' ? '\n(La respuesta se cortó por larga.)' : ''}` : 'No tengo una respuesta para eso.', usadas };
      }
      // Se ejecutan todas las herramientas pedidas y se devuelven juntas, en un solo mensaje
      const resultados = [];
      for (const b of content.filter((x) => x.type === 'tool_use')) {
        const h = herramientas.find((x) => x.name === b.name);
        let salida;
        let fallo = false;
        try {
          if (!h) throw new Error(`No existe la herramienta ${b.name}.`);
          salida = await h.run(b.input && typeof b.input === 'object' ? b.input : {});
        } catch (e) { fallo = true; salida = { error: String(e?.message ?? e).slice(0, 300) }; }
        usadas.push(b.name);
        resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(salida).slice(0, 20000), ...(fallo ? { is_error: true } : {}) });
      }
      mensajes.push({ role: 'user', content: resultados });
    }
    mensajes.length = antes;
    return { ok: false, error: 'Claude dio demasiadas vueltas con esta pregunta: probá de nuevo o hacela más corta.' };
  }

  return { preguntar, reiniciar: () => { mensajes = []; }, mensajes: () => mensajes };
}

/** La clave tiene forma de clave de Anthropic (no se manda a ningún lado para comprobarla). */
export const pareceClave = (s) => typeof s === 'string' && /^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(s.trim());
