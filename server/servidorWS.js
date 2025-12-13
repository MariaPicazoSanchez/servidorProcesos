const {
  createInitialState,
  applyAction,
  ACTION_TYPES,
} = require("./game/unoEngineMultiplayer");


function ServidorWS() {
  let srv = this;
  const estadosUNO = {};

  this.enviarAlRemitente = function(socket, mensaje, datos) {
    socket.emit(mensaje, datos);
  };

  this.enviarATodosMenosRemitente = function(socket, mensaje, datos) {
    socket.broadcast.emit(mensaje, datos);
  };

  this.enviarGlobal = function(io, mensaje, datos) {
    io.emit(mensaje, datos);
  };

  this.lanzarServidor = function(io, sistema) {
    io.on("connection", function(socket) {
      console.log("Capa WS activa");

      // Enviar lista inicial de partidas disponibles
      socket.on("obtenerListaPartidas", function(datos) {
        const juego = datos && datos.juego;
        let lista = sistema.obtenerPartidasDisponibles(juego);
        srv.enviarAlRemitente(socket, "listaPartidas", lista);
      });
      // dispara una vez al conectar
      socket.emit("listaPartidas", sistema.obtenerPartidasDisponibles());

      // === crearPartida ===
      socket.on("crearPartida", function(datos) {
        if (datos && datos.email) {
          socket.data.email = datos.email;
        }
        let codigo = sistema.crearPartida(datos.email);

        if (codigo !== -1) {
          socket.join(codigo); // sala de socket.io
        }

        srv.enviarAlRemitente(socket, "partidaCreada", { codigo: codigo });

        let lista = sistema.obtenerPartidasDisponibles(datos.juego);
        srv.enviarGlobal(io, "listaPartidas", lista);
      });

      // === unirAPartida ===
      socket.on("unirAPartida", function(datos) {
        if (datos && datos.email) {
          socket.data.email = datos.email;
        }
        let codigo = sistema.unirAPartida(datos.email, datos.codigo);

        if (codigo !== -1) {
          socket.join(codigo);
        }

        srv.enviarAlRemitente(socket, "unidoAPartida", { codigo: codigo });

        let lista = sistema.obtenerPartidasDisponibles(datos.juego);
        srv.enviarGlobal(io, "listaPartidas", lista);
      });

      // === continuarPartida ===
      socket.on("continuarPartida", function(datos) {
        if (datos && datos.email) {
          socket.data.email = datos.email;
        }
        // Marca la partida como "en curso" en tu sistema
        let codigo = sistema.continuarPartida(datos.email, datos.codigo);

        if (codigo !== -1) {
          // Aseguramos que este socket está en la sala
          socket.join(codigo);

          // Enviar a TODOS los jugadores de la sala que la partida empieza
          io.to(codigo).emit("partidaContinuada", {
            codigo: codigo,
            juego: datos.juego || "uno"
          });

          // Actualizar la lista para TODO el mundo
          // (si sistema.obtenerPartidasDisponibles ya filtra las "en curso",
          //   desaparecerá del listado como quieres)
          let lista = sistema.obtenerPartidasDisponibles(datos.juego);
          srv.enviarGlobal(io, "listaPartidas", lista);
        } else {
          // No se pudo continuar la partida (no es el propietario, código inválido, etc.)
          srv.enviarAlRemitente(socket, "partidaContinuada", { codigo: -1 });
        }
      });

      // === eliminarPartida ===
      socket.on("eliminarPartida", function(datos) {
        let codigo = sistema.eliminarPartida(datos.email, datos.codigo);

        if (codigo !== -1 && estadosUNO[codigo]) {
          delete estadosUNO[codigo];
          console.log("[UNO] engine eliminado para partida", codigo);
        }

        srv.enviarAlRemitente(socket, "partidaEliminada", { codigo: codigo });

        let lista = sistema.obtenerPartidasDisponibles(datos.juego);
        srv.enviarGlobal(io, "listaPartidas", lista);
      });

      // === salirPartida (jugador abandona sin ser propietario) ===
      socket.on("salirPartida", function(datos) {
        if (datos && datos.email) {
          socket.data.email = datos.email;
        }
        let codigo = sistema.eliminarPartida(datos.email, datos.codigo);

        // Si existía engine de UNO, lo descartamos; se recreará con los jugadores restantes
        if (codigo !== -1 && estadosUNO[codigo]) {
          delete estadosUNO[codigo];
          console.log("[UNO] engine eliminado por salida de jugador", codigo);
        }

        // Sacar a todos los sockets de este jugador de la sala
        try {
          const room = io.sockets.adapter.rooms.get(codigo);
          if (room) {
            for (const sid of Array.from(room)) {
              const s = io.sockets.sockets.get(sid);
              if (s && s.data && s.data.email && s.data.email.toLowerCase() === (datos.email || '').toLowerCase()) {
                s.leave(codigo);
              }
            }
          }
        } catch(e) {
          console.warn("[WS] error al sacar sockets en salirPartida:", e && e.message);
        }

        srv.enviarAlRemitente(socket, "salistePartida", { codigo: codigo });

        // Avisar a la sala que un jugador salió (para UIs conectadas)
        if (codigo !== -1) {
          io.to(codigo).emit("jugadorSalio", { codigo: codigo, email: datos.email });
        }

        let lista = sistema.obtenerPartidasDisponibles(datos.juego);
        srv.enviarGlobal(io, "listaPartidas", lista);
      });
      // ==========================
      //  UNO MULTIJUGADOR (WS)
      // ==========================

      // Cuando el juego UNO (en /uno) se conecta
      socket.on("uno:suscribirse", function(datos) {
        const codigo = datos && datos.codigo;
        const email  = datos && datos.email;
        if (!codigo || !email) {
          console.warn("[UNO] suscribirse sin codigo o email");
          return;
        }

        const partida = sistema.partidas[codigo];
        if (!partida) {
          console.warn("[UNO] partida no encontrada", codigo);
          return;
        }
        if (partida.juego !== "uno") {
          console.warn("[UNO] la partida no es de UNO", codigo, partida.juego);
          return;
        }

        // Si aún no hemos creado el engine para esta partida, lo creamos
        if (!estadosUNO[codigo]) {
          const names = partida.jugadores.map(j => j.email);
          estadosUNO[codigo] = {
            engine: createInitialState({
              numPlayers: names.length,
              names,
            }),
          };
          console.log("[UNO] engine creado para partida", codigo);
        }

        // Este socket entra en la room de la partida
        socket.join(codigo);

        // Mandamos estado actual de la partida UNO a todos los jugadores
        io.to(codigo).emit("uno:estado", {
          codigo,
          engine: estadosUNO[codigo].engine,
        });
      });

      // Cuando un jugador realiza una acción en el UNO
      socket.on("uno:accion", function(datos) {
        const codigo = datos && datos.codigo;
        const email  = datos && datos.email;
        const action = datos && datos.action;
        if (!codigo || !email || !action) {
          console.warn("[UNO] accion con datos incompletos", datos);
          return;
        }

        const partida = sistema.partidas[codigo];
        const datosUNO = estadosUNO[codigo];
        if (!partida || !datosUNO) {
          console.warn("[UNO] partida o engine no encontrados", codigo);
          return;
        }
        if (partida.juego !== "uno") {
          console.warn("[UNO] partida no es de UNO al recibir accion", codigo);
          return;
        }

        // Buscamos el índice del jugador según el Sistema
        const playerIndex = partida.jugadores.findIndex(
          j => j.email.toLowerCase() === email.toLowerCase()
        );
        if (playerIndex === -1) {
          console.warn("[UNO] jugador no pertenece a la partida", email, codigo);
          return;
        }

        // Inyectamos playerIndex en la acción y aplicamos el engine
        const fullAction = { ...action, playerIndex };
        const newEngine = applyAction(datosUNO.engine, fullAction);
        datosUNO.engine = newEngine;

        // Broadcast del nuevo estado a todos los sockets de la partida
        io.to(codigo).emit("uno:estado", {
          codigo,
          engine: datosUNO.engine,
        });
      });

    });

  };
}

module.exports.ServidorWS = ServidorWS;
