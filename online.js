// Modo online: varios dispositivos juegan a la vez en una sala de Firebase.
// Todos ven el mismo Pokémon al mismo tiempo; el anfitrión elige los Pokémon
// y controla el ritmo de la partida.

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyALhKXh055OoD5cLMnsUR3P81peuhVeP0Q",
  authDomain: "quien-es-ese-pokemon-add8a.firebaseapp.com",
  databaseURL: "https://quien-es-ese-pokemon-add8a-default-rtdb.firebaseio.com",
  projectId: "quien-es-ese-pokemon-add8a",
  storageBucket: "quien-es-ese-pokemon-add8a.firebasestorage.app",
  messagingSenderId: "693066941367",
  appId: "1:693066941367:web:b623123334343bf5d0de32",
};

const enLinea = {
  activo: false,
  responder: () => {},
  alReiniciar: () => {},
};

(() => {
  const CARACTERES = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const PAUSA_REVELADO = 4000; // ms que se ve la respuesta antes del siguiente
  const panel = $("online");

  let db = null;
  let offset = 0;          // diferencia entre el reloj local y el del servidor
  let salaRef = null;
  let codigo = null;
  let datos = null;        // copia de la sala
  let esHost = false;
  let rondaMostrada = 0;
  let respondido = false;
  let reloj = null;
  let revelandoRonda = 0;
  let programadaRonda = 0;
  let avanzando = false;
  const yo = idJugador();

  function idJugador() {
    let id = null;
    try { id = sessionStorage.getItem("idJugador"); } catch { /* nada */ }
    if (!id) {
      id = "j" + Math.random().toString(36).slice(2, 10);
      try { sessionStorage.setItem("idJugador", id); } catch { /* nada */ }
    }
    return id;
  }

  function iniciar() {
    if (db) return true;
    if (!window.firebase) {
      mostrarError("No se pudo cargar Firebase. Revisa tu conexión.");
      return false;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    db.ref(".info/serverTimeOffset").on("value", (s) => { offset = s.val() || 0; });
    // Al reconectar, volver a marcarse como conectado
    db.ref(".info/connected").on("value", (s) => {
      if (!s.val() || !salaRef) return;
      const conectado = salaRef.child(`jugadores/${yo}/conectado`);
      conectado.onDisconnect().set(false);
      conectado.set(true);
    });
    return true;
  }

  const ahora = () => Date.now() + offset;

  function generarCodigo() {
    let c = "";
    for (let i = 0; i < 4; i++) c += CARACTERES[Math.floor(Math.random() * CARACTERES.length)];
    return c;
  }

  function mostrarError(texto) {
    $("online-error").textContent = texto;
  }

  function bloquear(si) {
    $("crear-sala").disabled = si;
    $("unirse").disabled = si;
  }

  function verPanel(cual) {
    $("online-entrar").classList.toggle("oculto", cual !== "entrar");
    $("online-sala").classList.toggle("oculto", cual !== "sala");
    panel.classList.remove("oculto");
  }

  function abrirPanel(codigoInicial = "") {
    $("online-nombre").value = leerLocal("nombreOnline") || "";
    $("online-codigo").value = codigoInicial;
    mostrarError("");
    verPanel("entrar");
    ($("online-nombre").value ? (codigoInicial ? $("unirse") : $("crear-sala")) : $("online-nombre")).focus();
  }

  function leerNombre() {
    const nombre = $("online-nombre").value.trim();
    if (!nombre) {
      mostrarError("Escribe tu nombre");
      $("online-nombre").focus();
      return null;
    }
    guardarLocal("nombreOnline", nombre);
    return nombre;
  }

  // --- Entrar y salir de una sala ---

  async function crearSala() {
    const nombre = leerNombre();
    if (!nombre || !iniciar()) return;
    bloquear(true);
    mostrarError("");
    try {
      let cod;
      let existe = true;
      for (let i = 0; i < 5 && existe; i++) {
        cod = generarCodigo();
        existe = (await db.ref("salas/" + cod).once("value")).exists();
      }
      await db.ref("salas/" + cod).set({
        host: yo,
        estado: "espera",
        creada: firebase.database.ServerValue.TIMESTAMP,
        config: { generacion: selGeneracion.value, modo: selModo.value, rondas: 10 },
        jugadores: { [yo]: { nombre, puntos: 0, conectado: true } },
      });
      entrar(cod);
    } catch (err) {
      console.error(err);
      mostrarError("No se pudo crear la sala");
    }
    bloquear(false);
  }

  async function unirse() {
    const nombre = leerNombre();
    if (!nombre || !iniciar()) return;
    const cod = $("online-codigo").value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(cod)) {
      mostrarError("Código no válido");
      return;
    }
    bloquear(true);
    mostrarError("");
    try {
      const snap = await db.ref("salas/" + cod).once("value");
      if (!snap.exists()) {
        mostrarError("No existe esa sala");
      } else {
        const puntos = snap.child(`jugadores/${yo}/puntos`).val() || 0;
        await db.ref(`salas/${cod}/jugadores/${yo}`).set({ nombre, puntos, conectado: true });
        entrar(cod);
      }
    } catch (err) {
      console.error(err);
      mostrarError("No se pudo entrar en la sala");
    }
    bloquear(false);
  }

  function entrar(cod) {
    codigo = cod;
    salaRef = db.ref("salas/" + cod);
    salaRef.child(`jugadores/${yo}/conectado`).onDisconnect().set(false);
    enLinea.activo = true;

    // Detiene la partida local que hubiera en marcha
    detenerTemporizador();
    ronda++;
    pintarTiempo(TIEMPO_RONDA);
    sprite.style.visibility = "hidden";
    cargando.textContent = "Esperando...";
    cargando.classList.remove("oculto");
    zonaOpciones.innerHTML = "";
    mensaje.textContent = "";
    btnSiguiente.classList.add("oculto");

    document.body.classList.add("multi", "online");
    try { history.replaceState(null, "", "?sala=" + cod); } catch { /* file:// */ }
    salaRef.on("value", alCambiar);
  }

  async function salir() {
    if (!salaRef) return;
    const ref = salaRef;
    const miRef = ref.child("jugadores/" + yo);
    ref.off("value", alCambiar);
    miRef.child("conectado").onDisconnect().cancel();
    const quedan = activos().map(([id]) => id).filter((id) => id !== yo);
    try {
      if (!quedan.length) {
        await ref.remove();
      } else {
        await miRef.remove();
        if (esHost) await ref.child("host").set(quedan[0]);
      }
    } catch (err) {
      console.error(err);
    }
    limpiar();
  }

  function limpiar() {
    clearInterval(reloj);
    salaRef = null;
    datos = null;
    codigo = null;
    esHost = false;
    rondaMostrada = revelandoRonda = programadaRonda = 0;
    enLinea.activo = false;
    document.body.classList.remove("online");
    try { history.replaceState(null, "", location.pathname); } catch { /* file:// */ }
    panel.classList.add("oculto");
    pantallaFin.classList.add("oculto");
    $("reiniciar").textContent = "Jugar de nuevo";
    $("reiniciar").disabled = false;
    zonaEscribir.classList.toggle("oculto", selModo.value !== "escribir");
    zonaOpciones.classList.toggle("oculto", selModo.value === "escribir");
    reiniciarJuego();
  }

  // --- Sincronización ---

  function activos() {
    return Object.entries(datos?.jugadores || {})
      .filter(([, j]) => j.nombre && j.conectado !== false);
  }

  function haRespondido(id) {
    return datos.ronda > 0 && datos.respuestas?.[id]?.ronda === datos.ronda;
  }

  function alCambiar(snap) {
    datos = snap.val();
    if (!datos || !datos.jugadores?.[yo]?.nombre) {
      // La sala se borró o nos sacaron
      limpiar();
      return;
    }
    esHost = datos.host === yo;
    revisarHost();
    pintarJugadores();

    switch (datos.estado) {
      case "espera":
        rondaMostrada = revelandoRonda = programadaRonda = 0;
        pintarSala();
        break;
      case "jugando":
        panel.classList.add("oculto");
        pantallaFin.classList.add("oculto");
        if (datos.ronda !== rondaMostrada) mostrarPregunta();
        else if (esHost && activos().every(([id]) => haRespondido(id))) revelar();
        break;
      case "revelado":
        panel.classList.add("oculto");
        pantallaFin.classList.add("oculto");
        if (datos.ronda !== rondaMostrada) mostrarPregunta();
        revelarLocal();
        if (esHost) programarSiguiente();
        break;
      case "fin":
        clearInterval(reloj);
        rondaMostrada = revelandoRonda = programadaRonda = 0;
        mostrarFinOnline();
        break;
    }
  }

  // Si el anfitrión se desconecta, el primer jugador conectado toma su lugar
  function revisarHost() {
    const ids = activos().map(([id]) => id).sort();
    if (!ids.includes(datos.host) && ids[0] === yo) salaRef.child("host").set(yo);
  }

  function pintarJugadores() {
    const tabla = $("tabla-jugadores");
    tabla.innerHTML = "";
    const lista = Object.entries(datos.jugadores).filter(([, j]) => j.nombre);
    lista.forEach(([id, j], i) => {
      const chip = document.createElement("span");
      chip.className = "jugador"
        + (id === yo ? " activo" : "")
        + (j.conectado === false ? " desconectado" : "");
      const color = document.createElement("span");
      color.className = "color";
      color.style.background = COLORES[i % COLORES.length];
      const nombre = document.createElement("span");
      nombre.textContent = j.nombre + (datos.estado === "jugando" && haRespondido(id) ? " ✔" : "");
      const pts = document.createElement("strong");
      pts.textContent = j.puntos || 0;
      chip.append(color, nombre, pts);
      tabla.appendChild(chip);
    });

    $("ronda-actual").textContent = Math.max(1, datos.ronda || 1);
    $("ronda-total").textContent = datos.config?.rondas || 0;
    const conectados = activos();
    const listos = conectados.filter(([id]) => haRespondido(id)).length;
    $("turno").textContent = datos.estado === "revelado"
      ? "Siguiente Pokémon en un momento..."
      : `Sala ${codigo} · ${listos}/${conectados.length} han respondido`;
  }

  // --- Sala de espera ---

  function pintarSala() {
    clearInterval(reloj);
    pantallaFin.classList.add("oculto");
    verPanel("sala");
    $("codigo-sala").textContent = codigo;

    const lista = $("lista-sala");
    lista.innerHTML = "";
    for (const [id, j] of Object.entries(datos.jugadores)) {
      if (!j.nombre) continue;
      const li = document.createElement("li");
      const nombre = document.createElement("span");
      nombre.textContent = `${id === datos.host ? "👑 " : ""}${j.nombre}${id === yo ? " (tú)" : ""}`;
      const estado = document.createElement("span");
      estado.textContent = j.conectado === false ? "desconectado" : "";
      li.append(nombre, estado);
      lista.appendChild(li);
    }

    const cfg = datos.config || {};
    for (const [idSel, valor] of [["sala-generacion", cfg.generacion], ["sala-modo", cfg.modo], ["sala-rondas", cfg.rondas]]) {
      const sel = $(idSel);
      if (document.activeElement !== sel && valor != null) sel.value = String(valor);
    }
    const textoGen = $("sala-generacion").selectedOptions[0]?.textContent || "";
    const textoModo = $("sala-modo").selectedOptions[0]?.textContent || "";
    $("config-texto").textContent = `Generación: ${textoGen} · ${textoModo} · ${cfg.rondas} rondas`;

    $("config-host").classList.toggle("oculto", !esHost);
    $("config-texto").classList.toggle("oculto", esHost);
    $("empezar").classList.toggle("oculto", !esHost);
    $("esperando").classList.toggle("oculto", esHost);
  }

  function guardarConfig() {
    if (!esHost || !salaRef) return;
    salaRef.child("config").set({
      generacion: $("sala-generacion").value,
      modo: $("sala-modo").value,
      rondas: Number($("sala-rondas").value),
    });
  }

  async function empezar() {
    if (!esHost) return;
    const btn = $("empezar");
    btn.disabled = true;
    btn.textContent = "Preparando...";
    const updates = {
      respuestas: null,
      ronda: 0,
      config: {
        generacion: $("sala-generacion").value,
        modo: $("sala-modo").value,
        rondas: Number($("sala-rondas").value),
      },
    };
    for (const id of Object.keys(datos.jugadores)) updates[`jugadores/${id}/puntos`] = 0;
    try {
      await salaRef.update(updates);
      await siguientePregunta();
    } catch (err) {
      console.error(err);
    }
    btn.disabled = false;
    btn.textContent = "Empezar partida";
  }

  // --- Desarrollo de la partida ---

  // Solo el anfitrión: elige el siguiente Pokémon y lo publica en la sala
  async function siguientePregunta() {
    if (avanzando || !esHost || !salaRef) return;
    avanzando = true;
    let reintentar = false;
    try {
      const cfg = datos.config;
      const n = (datos.ronda || 0) + 1;
      if (n > Number(cfg.rondas)) {
        await salaRef.update({ estado: "fin" });
        return;
      }
      const [min, max] = cfg.generacion.split("-").map(Number);
      const r = { min, max };
      const p = await obtenerPokemon(idAleatorio([], r));
      await precargarImagen(p.imagen);
      let opciones = null;
      if (cfg.modo === "opciones") {
        const ids = [p.id];
        while (ids.length < 4) ids.push(idAleatorio(ids, r));
        const nombres = await Promise.all(ids.map(obtenerNombre));
        opciones = ids
          .map((id, i) => ({ id, nombre: nombres[i].nombre }))
          .sort(() => Math.random() - 0.5);
      }
      if (!esHost || !salaRef) return;
      await salaRef.update({
        estado: "jugando",
        ronda: n,
        respuestas: null,
        pregunta: { ...p, opciones, inicio: firebase.database.ServerValue.TIMESTAMP },
      });
    } catch (err) {
      console.error(err);
      reintentar = true;
    } finally {
      avanzando = false;
    }
    if (reintentar) setTimeout(siguientePregunta, 1500);
  }

  function restante() {
    const inicio = datos?.pregunta?.inicio;
    if (!inicio) return TIEMPO_RONDA;
    const r = (inicio + TIEMPO_RONDA * 1000 - ahora()) / 1000;
    return Math.max(0, Math.min(TIEMPO_RONDA, r));
  }

  function mostrarPregunta() {
    const p = datos.pregunta;
    if (!p) return;
    rondaMostrada = datos.ronda;
    const estaRonda = rondaMostrada;
    respondido = false;
    terminado = true;
    pistasUsadas = 0;
    actual = p;

    const escribir = datos.config.modo === "escribir";
    zonaEscribir.classList.toggle("oculto", !escribir);
    zonaOpciones.classList.toggle("oculto", escribir);
    mensaje.textContent = "";
    mensaje.className = "mensaje";
    btnSiguiente.classList.add("oculto");
    btnRendirse.classList.remove("oculto");
    sprite.classList.remove("revelado");
    sprite.style.visibility = "hidden";
    cargando.textContent = "Cargando...";
    cargando.classList.remove("oculto");
    inputRespuesta.value = "";
    inputRespuesta.placeholder = "Escribe el nombre...";
    inputRespuesta.disabled = true;
    if (p.opciones) pintarOpciones(p.opciones);
    else zonaOpciones.innerHTML = "";
    for (const b of zonaOpciones.children) b.disabled = true;

    precargarImagen(p.imagen).catch(() => {}).then(() => {
      if (!enLinea.activo || rondaMostrada !== estaRonda) return;
      sprite.src = p.imagen;
      sprite.style.visibility = "visible";
      cargando.classList.add("oculto");
      if (datos.estado === "jugando" && !respondido) {
        terminado = false;
        inputRespuesta.disabled = false;
        for (const b of zonaOpciones.children) b.disabled = false;
        if (escribir) inputRespuesta.focus();
      }
    });

    clearInterval(reloj);
    reloj = setInterval(tic, 250);
    tic();
  }

  function tic() {
    if (!datos || datos.estado !== "jugando") return;
    const r = restante();
    pintarTiempo(r);
    if (r <= 0) {
      if (!respondido) responder(false, "¡Se acabó el tiempo!");
      if (esHost) revelar();
    }
  }

  function responder(acierto, motivo) {
    if (respondido || !datos || !salaRef) return;
    respondido = true;
    terminado = true;
    const ganados = acierto ? Math.max(1, 3 - pistasUsadas) + Math.floor(restante() / 5) : 0;

    marcarCorrecta();
    inputRespuesta.disabled = true;
    btnRendirse.classList.add("oculto");
    sprite.classList.add("revelado");
    if (acierto) {
      mensaje.textContent = `¡Es ${actual.nombre}! +${ganados}`;
      mensaje.className = "mensaje bien";
      sonar("acierto");
    } else {
      mensaje.textContent = `${motivo ? motivo + " " : ""}Era ${actual.nombre}...`;
      mensaje.className = "mensaje mal";
      sonar("fallo");
    }

    salaRef.child("respuestas/" + yo).set({ ronda: datos.ronda, acierto, puntos: ganados });
    if (ganados) {
      salaRef.child(`jugadores/${yo}/puntos`).transaction((v) => (v || 0) + ganados);
    }
  }

  // Solo el anfitrión: cierra la ronda cuando todos respondieron o se acabó el tiempo
  function revelar() {
    if (!esHost || datos.estado !== "jugando" || revelandoRonda === datos.ronda) return;
    revelandoRonda = datos.ronda;
    salaRef.update({ estado: "revelado" });
  }

  function revelarLocal() {
    clearInterval(reloj);
    if (!respondido) responder(false, "¡Se acabó el tiempo!");
    sprite.classList.add("revelado");
  }

  function programarSiguiente() {
    if (programadaRonda === datos.ronda) return;
    programadaRonda = datos.ronda;
    setTimeout(() => {
      if (esHost && datos?.estado === "revelado") siguientePregunta();
    }, PAUSA_REVELADO);
  }

  function mostrarFinOnline() {
    panel.classList.add("oculto");
    const lista = Object.values(datos.jugadores)
      .filter((j) => j.nombre)
      .map((j) => ({ nombre: j.nombre, puntos: j.puntos || 0 }));
    pintarRanking(lista);
    $("reiniciar").textContent = esHost ? "Volver a la sala" : "Esperando al anfitrión...";
    $("reiniciar").disabled = !esHost;
    pantallaFin.classList.remove("oculto");
  }

  // --- Eventos ---

  enLinea.responder = (acierto) => responder(acierto);
  enLinea.alReiniciar = () => {
    if (esHost && salaRef) salaRef.update({ estado: "espera", respuestas: null, ronda: 0 });
  };

  $("sala-generacion").innerHTML = selGeneracion.innerHTML;
  $("sala-modo").innerHTML = selModo.innerHTML;

  $("btn-online").addEventListener("click", () => abrirPanel());
  $("online-cerrar").addEventListener("click", () => panel.classList.add("oculto"));
  $("crear-sala").addEventListener("click", crearSala);
  $("unirse").addEventListener("click", unirse);
  $("online-codigo").addEventListener("keydown", (e) => { if (e.key === "Enter") unirse(); });
  $("online-nombre").addEventListener("keydown", (e) => {
    if (e.key === "Enter") ($("online-codigo").value ? unirse : crearSala)();
  });
  $("empezar").addEventListener("click", empezar);
  for (const id of ["sala-generacion", "sala-modo", "sala-rondas"]) {
    $(id).addEventListener("change", guardarConfig);
  }
  for (const id of ["salir-sala", "salir-partida", "salir-fin"]) {
    $(id).addEventListener("click", salir);
  }
  $("copiar-enlace").addEventListener("click", () => {
    const url = `${location.origin}${location.pathname}?sala=${codigo}`;
    const btn = $("copiar-enlace");
    navigator.clipboard?.writeText(url).then(() => {
      btn.textContent = "✅ ¡Enlace copiado!";
      setTimeout(() => { btn.textContent = "📋 Copiar enlace para invitar"; }, 2000);
    }).catch(() => { btn.textContent = url; });
  });

  // Si se abre con ?sala=CODIGO, ofrecer unirse directamente
  const salaUrl = new URLSearchParams(location.search).get("sala");
  if (salaUrl) abrirPanel(salaUrl.toUpperCase());
})();
