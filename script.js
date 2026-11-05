const API = "https://pokeapi.co/api/v2";
const VIDAS_MAX = 3;
const TIEMPO_RONDA = 15; // segundos

const $ = (id) => document.getElementById(id);
const sprite = $("sprite");
const cargando = $("cargando");
const mensaje = $("mensaje");
const zonaOpciones = $("zona-opciones");
const zonaEscribir = $("zona-escribir");
const inputRespuesta = $("respuesta");
const btnSiguiente = $("siguiente");
const btnRendirse = $("rendirse");
const btnPista = $("pista");
const selModo = $("modo");
const barraTiempo = $("barra-tiempo");
const textoTiempo = $("tiempo");
const pantallaFin = $("fin-juego");

const selJugadores = $("num-jugadores");
const selRondas = $("rondas");
const COLORES = ["#e53935", "#1e88e5", "#43a047", "#fdd835", "#8e24aa", "#fb8c00", "#00acc1", "#d81b60"];

let actual = null;     // { id, nombre, nombreEn, imagen }
let terminado = false;
let pistasUsadas = 0;
let jugadores = [];    // [{ nombre, puntos, racha }]
let turno = 0;         // índice del jugador al que le toca
let turnosJugados = 0; // solo en multijugador
let vidas = VIDAS_MAX;
let intervalo = null;
let finRonda = 0;      // momento (ms) en que se acaba el tiempo
let ronda = 0;         // evita que una carga vieja pise a una nueva
let mejor = Number(leerLocal("mejorRacha")) || 0;
$("mejor").textContent = mejor;

const cacheNombres = new Map();

// Sonidos generados con Web Audio, sin archivos
let audio = null;
let silenciado = leerLocal("silenciado") === "1";
const btnSonido = $("sonido");

function pintarSonido() {
  btnSonido.textContent = silenciado ? "🔇" : "🔊";
  btnSonido.setAttribute("aria-label", silenciado ? "Activar sonido" : "Silenciar");
}

function nota(frecuencia, inicio, duracion, tipo = "square", volumen = 0.15) {
  const osc = audio.createOscillator();
  const gan = audio.createGain();
  const t = audio.currentTime + inicio;
  osc.type = tipo;
  osc.frequency.setValueAtTime(frecuencia, t);
  gan.gain.setValueAtTime(volumen, t);
  gan.gain.exponentialRampToValueAtTime(0.001, t + duracion);
  osc.connect(gan).connect(audio.destination);
  osc.start(t);
  osc.stop(t + duracion);
  return osc;
}

function sonar(tipo) {
  if (silenciado) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch {
    return;
  }
  if (tipo === "acierto") {
    // Arpegio ascendente
    [523, 659, 784, 1047].forEach((f, i) => nota(f, i * 0.09, 0.18));
  } else {
    // Dos notas graves que bajan
    const osc = nota(220, 0, 0.25, "sawtooth", 0.12);
    osc.frequency.exponentialRampToValueAtTime(150, audio.currentTime + 0.25);
    nota(130, 0.25, 0.4, "sawtooth", 0.12);
  }
}

function leerLocal(clave) {
  try { return localStorage.getItem(clave); } catch { return null; }
}

function guardarLocal(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

// --- Generaciones ---
// La selección se guarda como texto con rangos separados por comas: "1-151,252-386"

const GENERACIONES = [
  { num: 1, region: "Kanto", min: 1, max: 151 },
  { num: 2, region: "Johto", min: 152, max: 251 },
  { num: 3, region: "Hoenn", min: 252, max: 386 },
  { num: 4, region: "Sinnoh", min: 387, max: 493 },
  { num: 5, region: "Teselia", min: 494, max: 649 },
  { num: 6, region: "Kalos", min: 650, max: 721 },
  { num: 7, region: "Alola", min: 722, max: 809 },
  { num: 8, region: "Galar", min: 810, max: 905 },
  { num: 9, region: "Paldea", min: 906, max: 1025 },
];

function rangos(valor) {
  const lista = String(valor || "")
    .split(",")
    .map((r) => r.split("-").map(Number))
    .filter(([min, max]) => min > 0 && max >= min)
    .map(([min, max]) => ({ min, max }));
  return lista.length ? lista : [{ min: 1, max: 151 }];
}

// Generaciones incluidas en un valor (sirve también para valores antiguos como "1-1025")
function generacionesDe(valor) {
  const rs = rangos(valor);
  return GENERACIONES.filter((g) => rs.some((r) => r.min <= g.min && g.max <= r.max));
}

function textoGeneraciones(valor) {
  const gens = generacionesDe(valor);
  if (gens.length === GENERACIONES.length) return "Todas";
  return gens.map((g) => `${g.num} (${g.region})`).join(", ");
}

// Pinta casillas de generación dentro de un contenedor y devuelve un control
function crearSelectorGen(contenedor, alCambiar) {
  contenedor.innerHTML = "";
  const checks = GENERACIONES.map((g) => {
    const label = document.createElement("label");
    label.className = "gen";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = `${g.min}-${g.max}`;
    input.checked = g.num === 1;
    const num = document.createElement("strong");
    num.textContent = g.num;
    const region = document.createElement("span");
    region.textContent = g.region;
    label.append(input, num, region);
    contenedor.appendChild(label);
    input.addEventListener("change", () => {
      // Siempre tiene que quedar al menos una marcada
      if (!checks.some((c) => c.checked)) input.checked = true;
      alCambiar?.();
    });
    return input;
  });

  const todas = document.createElement("button");
  todas.type = "button";
  todas.className = "gen-todas";
  contenedor.appendChild(todas);
  const pintarTodas = () => {
    todas.textContent = checks.every((c) => c.checked) ? "Solo la 1" : "Todas";
  };
  todas.addEventListener("click", () => {
    const marcar = !checks.every((c) => c.checked);
    checks.forEach((c, i) => { c.checked = marcar || i === 0; });
    pintarTodas();
    alCambiar?.();
  });
  checks.forEach((c) => c.addEventListener("change", pintarTodas));
  pintarTodas();

  return {
    get valor() {
      return checks.filter((c) => c.checked).map((c) => c.value).join(",");
    },
    set valor(v) {
      const marcadas = new Set(generacionesDe(v).map((g) => `${g.min}-${g.max}`));
      if (!marcadas.size) return;
      checks.forEach((c) => { c.checked = marcadas.has(c.value); });
      pintarTodas();
    },
  };
}

const selGeneracion = crearSelectorGen($("generacion"), () => {
  guardarLocal("ajuste-generacion", selGeneracion.valor);
});

function idAleatorio(excluir = [], lista = rangos(selGeneracion.valor)) {
  const total = lista.reduce((n, r) => n + r.max - r.min + 1, 0);
  let id;
  do {
    let k = Math.floor(Math.random() * total);
    for (const r of lista) {
      const tam = r.max - r.min + 1;
      if (k < tam) { id = r.min + k; break; }
      k -= tam;
    }
  } while (excluir.includes(id));
  return id;
}

// Quita tildes, espacios y signos para comparar respuestas
function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/♀/g, "f")
    .replace(/♂/g, "m")
    .replace(/[^a-z0-9]/g, "");
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

async function obtenerNombre(id) {
  if (cacheNombres.has(id)) return cacheNombres.get(id);
  const res = await fetch(`${API}/pokemon-species/${id}`);
  if (!res.ok) throw new Error("No se pudo cargar la especie " + id);
  const datos = await res.json();
  const es = datos.names.find((n) => n.language.name === "es");
  const en = datos.names.find((n) => n.language.name === "en");
  const info = {
    nombre: es ? es.name : capitalizar(datos.name),
    nombreEn: en ? en.name : capitalizar(datos.name),
  };
  cacheNombres.set(id, info);
  return info;
}

async function obtenerPokemon(id) {
  const [res, nombres] = await Promise.all([
    fetch(`${API}/pokemon/${id}`),
    obtenerNombre(id),
  ]);
  if (!res.ok) throw new Error("No se pudo cargar el Pokémon " + id);
  const datos = await res.json();
  const imagen =
    datos.sprites.other?.["official-artwork"]?.front_default ||
    datos.sprites.other?.home?.front_default ||
    datos.sprites.front_default;
  return {
    id,
    ...nombres,
    imagen,
    tipos: datos.types.map((t) => t.type.name),
  };
}

function precargarImagen(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
}

// --- Multijugador ---

const esMulti = () => jugadores.length > 1;
const turnosTotales = () => Number(selRondas.value) * jugadores.length;

function nombresGuardados() {
  try { return JSON.parse(leerLocal("nombresJugadores")) || []; } catch { return []; }
}

function crearCamposNombres() {
  const contenedor = $("nombres");
  const previos = [...contenedor.querySelectorAll("input")].map((i) => i.value);
  const guardados = nombresGuardados();
  const n = Number(selJugadores.value);
  contenedor.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 12;
    input.placeholder = `Jugador ${i + 1}`;
    input.value = previos[i] ?? guardados[i] ?? "";
    input.style.borderColor = COLORES[i];
    input.setAttribute("aria-label", `Nombre del jugador ${i + 1}`);
    input.addEventListener("input", () => {
      if (jugadores[i]) jugadores[i].nombre = nombreDe(input, i);
      guardarLocal("nombresJugadores", JSON.stringify(
        [...contenedor.querySelectorAll("input")].map((x) => x.value)
      ));
      pintarMarcador();
    });
    contenedor.appendChild(input);
  }
}

function nombreDe(input, i) {
  return input.value.trim() || `Jugador ${i + 1}`;
}

function pintarMarcador() {
  const j = jugadores[turno];
  if (!j) return;
  if (!esMulti()) {
    $("puntos").textContent = j.puntos;
    $("racha").textContent = j.racha;
    $("mejor").textContent = mejor;
    return;
  }
  const tabla = $("tabla-jugadores");
  tabla.innerHTML = "";
  jugadores.forEach((jug, i) => {
    const chip = document.createElement("span");
    chip.className = "jugador" + (i === turno ? " activo" : "");
    const color = document.createElement("span");
    color.className = "color";
    color.style.background = COLORES[i];
    const nombre = document.createElement("span");
    nombre.textContent = jug.nombre;
    const pts = document.createElement("strong");
    pts.textContent = jug.puntos;
    chip.append(color, nombre, pts);
    tabla.appendChild(chip);
  });
  const total = Number(selRondas.value);
  $("ronda-actual").textContent = Math.min(total, Math.floor(turnosJugados / jugadores.length) + 1);
  $("ronda-total").textContent = total;
  $("turno").textContent = `Turno de ${j.nombre}`;
}

function pintarVidas() {
  $("vidas").innerHTML = Array.from({ length: VIDAS_MAX }, (_, i) =>
    `<span class="${i < vidas ? "" : "perdida"}">❤️</span>`
  ).join("");
}

function segundosRestantes() {
  return Math.max(0, (finRonda - Date.now()) / 1000);
}

function pintarTiempo(restante) {
  const porcentaje = (restante / TIEMPO_RONDA) * 100;
  barraTiempo.style.width = porcentaje + "%";
  barraTiempo.classList.toggle("medio", porcentaje <= 50 && porcentaje > 25);
  barraTiempo.classList.toggle("poco", porcentaje <= 25);
  textoTiempo.textContent = Math.ceil(restante);
}

function iniciarTemporizador() {
  detenerTemporizador();
  finRonda = Date.now() + TIEMPO_RONDA * 1000;
  pintarTiempo(TIEMPO_RONDA);
  intervalo = setInterval(() => {
    const restante = segundosRestantes();
    pintarTiempo(restante);
    if (restante <= 0) {
      marcarCorrecta();
      terminarRonda(false, "¡Se acabó el tiempo!");
    }
  }, 250);
}

function detenerTemporizador() {
  clearInterval(intervalo);
  intervalo = null;
}

function marcarCorrecta() {
  for (const b of zonaOpciones.children) {
    b.disabled = true;
    if (Number(b.dataset.id) === actual.id) b.classList.add("correcta");
  }
}

async function nuevaRonda() {
  const estaRonda = ++ronda;
  detenerTemporizador();
  pintarTiempo(TIEMPO_RONDA);
  terminado = true; // no se puede responder hasta que cargue
  inputRespuesta.disabled = true;
  pistasUsadas = 0;
  mensaje.textContent = "";
  mensaje.className = "mensaje";
  btnSiguiente.classList.add("oculto");
  btnRendirse.classList.remove("oculto");
  sprite.classList.remove("revelado");
  sprite.style.visibility = "hidden";
  cargando.textContent = "Cargando...";
  cargando.classList.remove("oculto");
  zonaOpciones.innerHTML = "";
  inputRespuesta.value = "";
  inputRespuesta.placeholder = "Escribe el nombre...";

  try {
    const pokemon = await obtenerPokemon(idAleatorio());
    await precargarImagen(pokemon.imagen);
    if (estaRonda !== ronda) return;
    actual = pokemon;

    if (selModo.value === "opciones") {
      await crearOpciones(estaRonda);
      if (estaRonda !== ronda) return;
    }

    sprite.src = actual.imagen;
    sprite.style.visibility = "visible";
    cargando.classList.add("oculto");
    terminado = false;
    inputRespuesta.disabled = false;
    if (selModo.value === "escribir") inputRespuesta.focus();
    iniciarTemporizador();
  } catch (err) {
    console.error(err);
    if (estaRonda !== ronda) return;
    cargando.textContent = "Error al cargar. Reintentando...";
    setTimeout(() => {
      if (estaRonda === ronda) nuevaRonda();
    }, 1500);
  }
}

async function crearOpciones(estaRonda) {
  const ids = [actual.id];
  while (ids.length < 4) ids.push(idAleatorio(ids));

  const nombres = await Promise.all(ids.map(obtenerNombre));
  if (estaRonda !== ronda) return;
  const opciones = nombres
    .map((n, i) => ({ id: ids[i], nombre: n.nombre }))
    .sort(() => Math.random() - 0.5);
  pintarOpciones(opciones);
}

function pintarOpciones(opciones) {
  zonaOpciones.innerHTML = "";
  for (const op of opciones) {
    const boton = document.createElement("button");
    boton.textContent = op.nombre;
    boton.dataset.id = op.id;
    boton.addEventListener("click", () => elegirOpcion(boton, op.id));
    zonaOpciones.appendChild(boton);
  }
}

function elegirOpcion(boton, id) {
  if (terminado) return;
  const acierto = id === actual.id;
  marcarCorrecta();
  if (!acierto) boton.classList.add("incorrecta");
  if (enLinea.activo) enLinea.responder(acierto);
  else terminarRonda(acierto);
}

function comprobarEscrito(e) {
  e.preventDefault();
  if (terminado) return;
  const intento = normalizar(inputRespuesta.value);
  if (!intento) return;

  const validos = [normalizar(actual.nombre), normalizar(actual.nombreEn)];
  if (validos.includes(intento)) {
    if (enLinea.activo) enLinea.responder(true);
    else terminarRonda(true);
  } else {
    mensaje.textContent = "¡No! Inténtalo otra vez";
    mensaje.className = "mensaje mal";
    inputRespuesta.select();
  }
}

function darPista() {
  if (terminado) return;
  pistasUsadas++;
  const nombre = actual.nombre;
  if (pistasUsadas === 1) {
    mensaje.textContent = `Tipo: ${actual.tipos.join(" / ")}`;
  } else if (pistasUsadas === 2) {
    mensaje.textContent = `Empieza por "${nombre[0]}" y tiene ${nombre.length} letras`;
  } else {
    const visibles = Math.min(pistasUsadas - 1, nombre.length - 1);
    mensaje.textContent = nombre.slice(0, visibles) + "_".repeat(nombre.length - visibles);
  }
  mensaje.className = "mensaje";
  inputRespuesta.focus();
}

function terminarRonda(acierto, motivo) {
  const restante = segundosRestantes();
  detenerTemporizador();
  terminado = true;
  sprite.classList.add("revelado");
  btnRendirse.classList.add("oculto");

  const j = jugadores[turno];
  if (acierto) {
    // Menos puntos cuantas más pistas se usen, y bonus por rapidez
    const ganados = Math.max(1, 3 - pistasUsadas) + Math.floor(restante / 5);
    j.puntos += ganados;
    j.racha++;
    if (!esMulti() && j.racha > mejor) {
      mejor = j.racha;
      guardarLocal("mejorRacha", mejor);
    }
    mensaje.textContent = esMulti()
      ? `¡Es ${actual.nombre}! +${ganados} para ${j.nombre}`
      : `¡Es ${actual.nombre}!`;
    mensaje.className = "mensaje bien";
    sonar("acierto");
  } else {
    j.racha = 0;
    if (!esMulti()) {
      vidas--;
      pintarVidas();
    }
    mensaje.textContent = `${motivo ? motivo + " " : ""}Era ${actual.nombre}...`;
    mensaje.className = "mensaje mal";
    sonar("fallo");
  }

  let fin;
  if (esMulti()) {
    turnosJugados++;
    fin = turnosJugados >= turnosTotales();
    if (!fin) turno = (turno + 1) % jugadores.length;
  } else {
    fin = vidas <= 0;
  }
  pintarMarcador();

  if (fin) {
    // Se deja ver el Pokémon revelado un momento antes del fin
    setTimeout(mostrarFin, 1500);
  } else {
    btnSiguiente.textContent = esMulti()
      ? `Turno de ${jugadores[turno].nombre} ▶`
      : "Siguiente ▶";
    btnSiguiente.classList.remove("oculto");
    btnSiguiente.focus();
  }
}

function mostrarFin() {
  if (esMulti()) {
    pintarRanking(jugadores);
  } else {
    $("titulo-fin").textContent = "¡Fin del juego!";
    $("puntos-final").textContent = jugadores[0].puntos;
    $("mejor-final").textContent = mejor;
  }
  pantallaFin.classList.remove("oculto");
  $("reiniciar").focus();
}

// Rellena el título y la clasificación del panel final: [{ nombre, puntos }]
function pintarRanking(lista) {
  const orden = [...lista].sort((a, b) => b.puntos - a.puntos);
  const max = orden[0].puntos;
  const ganadores = orden.filter((j) => j.puntos === max);
  $("titulo-fin").textContent = ganadores.length > 1
    ? `¡Empate entre ${ganadores.map((j) => j.nombre).join(" y ")}!`
    : `¡Gana ${ganadores[0].nombre}!`;
  const medallas = ["🥇", "🥈", "🥉"];
  const ranking = $("ranking");
  ranking.innerHTML = "";
  let puesto = 0;
  orden.forEach((jug, i) => {
    // Los empatados comparten puesto
    if (i === 0 || jug.puntos !== orden[i - 1].puntos) puesto = i;
    const li = document.createElement("li");
    const nombre = document.createElement("span");
    nombre.textContent = `${medallas[puesto] ?? `${puesto + 1}.`} ${jug.nombre}`;
    const pts = document.createElement("span");
    pts.textContent = `${jug.puntos} pts`;
    li.append(nombre, pts);
    ranking.appendChild(li);
  });
}

function reiniciarJuego() {
  const n = Number(selJugadores.value);
  document.body.classList.toggle("multi", n > 1);
  const campos = $("nombres").querySelectorAll("input");
  jugadores = Array.from({ length: n }, (_, i) => ({
    nombre: n > 1 ? nombreDe(campos[i], i) : "",
    puntos: 0,
    racha: 0,
  }));
  turno = 0;
  turnosJugados = 0;
  vidas = VIDAS_MAX;
  pintarVidas();
  pintarMarcador();
  pantallaFin.classList.add("oculto");
  nuevaRonda();
}

function aplicarModo() {
  const escribir = selModo.value === "escribir";
  zonaEscribir.classList.toggle("oculto", !escribir);
  zonaOpciones.classList.toggle("oculto", escribir);
}

// Pantalla previa: se eligen generación, modo, jugadores y rondas antes de jugar
function mostrarSala() {
  detenerTemporizador();
  ronda++; // descarta cualquier carga en curso
  terminado = true;
  document.body.classList.toggle("multi", Number(selJugadores.value) > 1);
  document.body.classList.add("en-sala");
  pantallaFin.classList.add("oculto");
  $("empezar-local").focus();
}

function empezarPartida() {
  document.body.classList.remove("en-sala");
  aplicarModo();
  reiniciarJuego();
}

zonaEscribir.addEventListener("submit", comprobarEscrito);
btnPista.addEventListener("click", darPista);
btnSiguiente.addEventListener("click", nuevaRonda);
btnRendirse.addEventListener("click", () => {
  if (terminado) return;
  marcarCorrecta();
  if (enLinea.activo) enLinea.responder(false);
  else terminarRonda(false);
});
$("reiniciar").addEventListener("click", () => {
  if (enLinea.activo) enLinea.alReiniciar();
  else reiniciarJuego();
});
btnSonido.addEventListener("click", () => {
  silenciado = !silenciado;
  guardarLocal("silenciado", silenciado ? "1" : "0");
  pintarSonido();
});
pintarSonido();
selJugadores.addEventListener("change", () => {
  crearCamposNombres();
  document.body.classList.toggle("multi", Number(selJugadores.value) > 1);
});
$("empezar-local").addEventListener("click", empezarPartida);
$("volver-sala").addEventListener("click", mostrarSala);
$("cambiar-ajustes").addEventListener("click", mostrarSala);

// Recordar la configuración de la sala entre visitas
const genGuardada = leerLocal("ajuste-generacion");
if (genGuardada) selGeneracion.valor = genGuardada;
for (const [sel, clave] of [[selModo, "modo"], [selJugadores, "jugadores"], [selRondas, "rondas"]]) {
  const guardado = leerLocal("ajuste-" + clave);
  if (guardado && [...sel.options].some((o) => o.value === guardado)) sel.value = guardado;
  sel.addEventListener("change", () => guardarLocal("ajuste-" + clave, sel.value));
}

crearCamposNombres();
mostrarSala();
