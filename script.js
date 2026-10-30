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
const selGeneracion = $("generacion");
const selModo = $("modo");
const barraTiempo = $("barra-tiempo");
const textoTiempo = $("tiempo");
const pantallaFin = $("fin-juego");

let actual = null;     // { id, nombre, nombreEn, imagen }
let terminado = false;
let pistasUsadas = 0;
let puntos = 0;
let racha = 0;
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

function rango() {
  const [min, max] = selGeneracion.value.split("-").map(Number);
  return { min, max };
}

function idAleatorio(excluir = []) {
  const { min, max } = rango();
  let id;
  do {
    id = Math.floor(Math.random() * (max - min + 1)) + min;
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
  terminarRonda(acierto);
}

function comprobarEscrito(e) {
  e.preventDefault();
  if (terminado) return;
  const intento = normalizar(inputRespuesta.value);
  if (!intento) return;

  const validos = [normalizar(actual.nombre), normalizar(actual.nombreEn)];
  if (validos.includes(intento)) {
    terminarRonda(true);
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

  if (acierto) {
    // Menos puntos cuantas más pistas se usen, y bonus por rapidez
    puntos += Math.max(1, 3 - pistasUsadas) + Math.floor(restante / 5);
    racha++;
    if (racha > mejor) {
      mejor = racha;
      guardarLocal("mejorRacha", mejor);
    }
    mensaje.textContent = `¡Es ${actual.nombre}!`;
    mensaje.className = "mensaje bien";
    sonar("acierto");
  } else {
    racha = 0;
    vidas--;
    pintarVidas();
    mensaje.textContent = `${motivo ? motivo + " " : ""}Era ${actual.nombre}...`;
    mensaje.className = "mensaje mal";
    sonar("fallo");
  }

  $("puntos").textContent = puntos;
  $("racha").textContent = racha;
  $("mejor").textContent = mejor;

  if (vidas <= 0) {
    // Se deja ver el Pokémon revelado un momento antes del fin
    setTimeout(mostrarFin, 1500);
  } else {
    btnSiguiente.classList.remove("oculto");
    btnSiguiente.focus();
  }
}

function mostrarFin() {
  $("puntos-final").textContent = puntos;
  $("mejor-final").textContent = mejor;
  pantallaFin.classList.remove("oculto");
  $("reiniciar").focus();
}

function reiniciarJuego() {
  puntos = 0;
  racha = 0;
  vidas = VIDAS_MAX;
  $("puntos").textContent = puntos;
  $("racha").textContent = racha;
  pintarVidas();
  pantallaFin.classList.add("oculto");
  nuevaRonda();
}

function cambiarModo() {
  const escribir = selModo.value === "escribir";
  zonaEscribir.classList.toggle("oculto", !escribir);
  zonaOpciones.classList.toggle("oculto", escribir);
  reiniciarJuego();
}

zonaEscribir.addEventListener("submit", comprobarEscrito);
btnPista.addEventListener("click", darPista);
btnSiguiente.addEventListener("click", nuevaRonda);
btnRendirse.addEventListener("click", () => {
  if (terminado) return;
  marcarCorrecta();
  terminarRonda(false);
});
$("reiniciar").addEventListener("click", reiniciarJuego);
btnSonido.addEventListener("click", () => {
  silenciado = !silenciado;
  guardarLocal("silenciado", silenciado ? "1" : "0");
  pintarSonido();
});
pintarSonido();
selModo.addEventListener("change", cambiarModo);
selGeneracion.addEventListener("change", reiniciarJuego);

reiniciarJuego();
