const bcrypt = require("bcrypt");
const correo = require("./email.js");
const datos = require("./cad.js");

function Sistema() {
  this.usuarios = {};
  this.usuariosLocales = {};
  this.partidas = {};

  const normalizarEmail = function(email){
    return (email || "").trim().toLowerCase();
  };


  this.cad = new datos.CAD();

  this._obtenerOcrearUsuarioEnMemoria = function(email, nick) {
    const e = normalizarEmail(email);
    if (!e) {
      return null;
    }
    if (!this.usuarios[e]) {
      // Si no se proporciona nick, intentar obtenerlo de la BD o usar el email
      const nickFinal = nick || e;
      this.usuarios[e] = new Usuario(e, nickFinal);
      
      // Si no se proporcionó nick, intentar buscarlo en BD de forma asíncrona
      if (!nick) {
        this.cad.buscarUsuario({ email: e }, (usr) => {
          if (usr && usr.nick && this.usuarios[e]) {
            this.usuarios[e].nick = usr.nick;
          }
        });
      }
    }
    return this.usuarios[e];
  };

  (async () => {
    await this.cad.conectar((db, err) => {
      if (err) {
        console.warn("Mongo no disponible. Operando en memoria:", err.message);
      } else {
        console.log("Conectado a Mongo Atlas");
      }
    });
  })();

  // ----------------------------
  // MÉTODOS DE PARTIDAS
  // ----------------------------

  this.obtenerCodigo = function() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  };
  this.crearPartida = function(email, juego) {
    email = normalizarEmail(email);
    let usuario = this._obtenerOcrearUsuarioEnMemoria(email);
    if (!usuario) {
      console.log("Usuario no encontrado");
      this.registrarActividad("crearPartidaFallido", email);
      return -1;
    }

    // Si el nick del usuario aún es su email (carga perezosa), intenta resolverlo desde BD
    if (usuario.nick === email && this.cad && typeof this.cad.buscarUsuario === "function") {
      try {
        this.cad.buscarUsuario({ email }, (usr) => {
          if (usr && usr.nick) {
            usuario.nick = usr.nick;
          }
        });
      } catch (e) {
        // si falla, seguimos con el mejor esfuerzo
      }
    }

    let codigo = this.obtenerCodigo();

    // Usar el nick del usuario como propietario (si no disponible, caer a email)
    let propietarioVisible = usuario.nick || email;
    let p = new Partida(codigo, propietarioVisible, juego);
    // Guardar también el email para validaciones
    p.propietarioEmail = email;

    p.jugadores.push(usuario);
    this.partidas[codigo] = p;
    this.registrarActividad("crearPartida", email, { partida: codigo });
    return codigo;
  };

  this.unirAPartida = function(email, codigo) {
    email = normalizarEmail(email);
    let usuario = this._obtenerOcrearUsuarioEnMemoria(email);
    if (!usuario) {
      console.log("Usuario no encontrado");
      this.registrarActividad("unirAPartidaFallido", email);
      return -1;
    }
    let partida = this.partidas[codigo];
    if (!partida) {
      console.log("Partida no encontrada");
      this.registrarActividad("unirAPartidaFallido", email);
      return -1;
    }

    if (partida.jugadores.length >= partida.maxJug) {
      console.log("Partida llena");
      console.log("Jugadores:", partida.jugadores.length, "MaxJug:", partida.maxJug, partida.jugadores.map(j => j.email));
      this.registrarActividad("unirAPartidaFallido", email);
      return -1
    }

    let yaEsta = partida.jugadores.some(j => j.email === usuario.email);
    if (yaEsta) {
      console.log("Usuario ya está en la partida");
      this.registrarActividad("unirAPartidaFallido", email);
      return -1;
    }

    partida.jugadores.push(usuario);
    this.registrarActividad("unirAPartida", email, { partida: codigo });
    return codigo;
  };

  this.continuarPartida = function(email, codigo) {
    email = normalizarEmail(email);
    let partida = this.partidas[codigo];
    if (!partida) {
      console.log("Partida no encontrada");
      this.registrarActividad("continuarPartidaFallido", email);
      return -1;
    }
    if (normalizarEmail(partida.propietarioEmail || partida.propietario) !== email) {
      console.log("Solo el propietario puede continuar su partida");
      this.registrarActividad("continuarPartidaFallido", email);
      return -1;
    }
    partida.estado = 'enCurso';
    let usuario = this._obtenerOcrearUsuarioEnMemoria(email);
    let yaEsta = partida.jugadores.some(j => j.email === usuario.email);
    if (!yaEsta) {
      partida.jugadores.push(usuario);
    }
    this.registrarActividad("continuarPartida", email);
    return codigo;
  };

  this.eliminarPartida = function(email, codigo) {
    email = normalizarEmail(email);
    if (!codigo) {
      console.log("Codigo de partida no valido");
      this.registrarActividad("eliminarPartidaFallido", email);
      return -1;
    }
    let partida = this.partidas[codigo];
    if (!partida) {
      console.log("Partida no encontrada");
      this.registrarActividad("eliminarPartidaFallido", email);
      return -1;
    }
    const propietarioNorm = normalizarEmail(partida.propietarioEmail || partida.propietario);
    const esPropietario = propietarioNorm && propietarioNorm === email;
    const esJugador = partida.jugadores.some(j => normalizarEmail(j.email) === email);

    if (esPropietario || (!email && propietarioNorm && !esJugador)) {
      delete this.partidas[codigo];
      this.registrarActividad("eliminarPartida", email, { partida: codigo });
      return codigo;
    }

    // si no eres propietario, solo te borras de la lista de jugadores
    if (esJugador) {
      partida.jugadores = partida.jugadores.filter(j => normalizarEmail(j.email) !== email);
      if (partida.jugadores.length === 0) {
        delete this.partidas[codigo];
      }
      this.registrarActividad("salirPartida", email);
    }
    return codigo;
  };
  this.obtenerPartidasDisponibles = function(juego) {
    // let lista = [];

    // for (let codigo in this.partidas) {
    //   let p = this.partidas[codigo];
    //   let creadorEmail = p.propietario || (p.jugadores[0] && p.jugadores[0].email);
    //   lista.push({
    //     codigo: p.codigo,
    //     propietario: creadorEmail,
    //     disponible: p.jugadores.length < p.maxJug,
    //     jugadores: p.jugadores.length,
    //     maxJug: p.maxJug
    //   });
    // }
    // return lista;
     return Object.values(this.partidas).filter(p => {
      // Solo queremos partidas pendientes
      if (p.estado && p.estado !== 'pendiente') return false;

      // Si no se nos pide un juego concreto, devolvemos todas las pendientes
      if (!juego) return true;

      // Si la partida NO tiene juego, las tratamos como "uno" por compatibilidad
      const juegoPartida = p.juego || 'uno';
      return juegoPartida === juego;
    });
  };

  this.obtenerPartidasDeUsuario = function(email) {
    email = normalizarEmail(email);
    let lista = [];
    if (!email) {
      return lista;
    }
    for (let codigo in this.partidas) {
      let p = this.partidas[codigo];
      const esPropietario = (normalizarEmail(p.propietarioEmail || p.propietario) === email);
      const estaComoJugador = p.jugadores.some(j => normalizarEmail(j.email) === email);
      if (esPropietario || estaComoJugador) {
        // Devolver el nick como propietario para mostrar
        lista.push({ codigo: p.codigo, propietario: p.propietario, esPropietario });
      }
    }
    this.registrarActividad("obtenerPartidasDeUsuario", email);
    return lista;
  };



  // ----------------------------
  // MÉTODOS DE USUARIOS
  // ----------------------------

  this.agregarUsuario = function (nick) {
    let res = { nick: -1 };
    if (!this.usuarios[nick]) {
      this.usuarios[nick] = new Usuario(nick);
      res.nick = nick;
      this.registrarActividad("agregarUsuario", nick);
    } else {
      console.log("El nick " + nick + " está en uso");
      this.registrarActividad("agregarUsuarioFallido", nick);
    }
    return res;
  };

  this.obtenerUsuarios = function () {
    // No email context available here; solo registrar sin usuario
    this.registrarActividad("obtenerUsuarios", null);
    return this.usuarios;
  };

  this.usuarioActivo = function (nick) {
    return this.usuarios.hasOwnProperty(nick);
  };

  this.eliminarUsuario = function (nick) {
    delete this.usuarios[nick];
    this.registrarActividad("eliminarUsuario", nick);
  };

  this.numeroUsuarios = function () {
    return Object.keys(this.usuarios).length;
  };

  this.usuarioGoogle = function (usr, callback) {
    this.cad.buscarOCrearUsuario(usr, function (obj) {
      if (obj && obj.email) {
        this._obtenerOcrearUsuarioEnMemoria(obj.email, obj.nick);
        this.registrarActividad("inicioGoogle", obj.email);
      } else {
        this.registrarActividad("usuarioGoogleFallido", usr ? usr.email : null);
      }
      callback(obj);
    }.bind(this));
  };

  // ===========================
  // REGISTRO con confirmación
  // ===========================
  this.registrarUsuario = function (obj, callback) {
    console.log("[modelo.registrarUsuario] entrada:", obj);
    let modelo = this;

    if (!obj || !obj.email || !obj.password || !obj.nick) {
      console.warn("[modelo.registrarUsuario] datos inválidos");
      modelo.registrarActividad("registrarUsuarioFallido", obj ? obj.email : null);
      callback({ email: -1 });
      return;
    }

    // Normalizar nick a formato visible (letras, números y guiones bajos)
    obj.nick = String(obj.nick).trim();
    if (!obj.nick) {
      callback({ email: -1, reason: "nick_vacio" });
      return;
    }

    // Comprobar duplicados por email
    this.cad.buscarUsuario({ email: obj.email }, function (usr) {
      console.log("[modelo.registrarUsuario] resultado buscarUsuario:", usr);
      if (usr) {
        console.warn("[modelo.registrarUsuario] duplicado:", obj.email);
        modelo.registrarActividad("registrarUsuarioFallido", obj.email);
        callback({ email: -1, reason: "email_ya_registrado" });
        return;
      }

      // Comprobar duplicados por nick
      modelo.cad.buscarUsuario({ nick: obj.nick }, function (usrNick) {
        if (usrNick) {
          console.warn("[modelo.registrarUsuario] nick duplicado:", obj.nick);
          modelo.registrarActividad("registrarUsuarioFallido", obj.email);
          callback({ email: -1, reason: "nick_ya_registrado" });
          return;
        }

      const key = Date.now().toString();

      const hash = bcrypt.hashSync(obj.password, 10);

      const nuevoUsuario = {
        email: obj.email,
        nick: obj.nick,
        password: hash,
        key: key,
        confirmada: false,
      };

      modelo.cad.insertarUsuario(nuevoUsuario, function (res) {
        console.log("[modelo.registrarUsuario] resultado insertarUsuario:", res);
        modelo.registrarActividad("registroUsuario", nuevoUsuario.email);

        Promise.resolve()
          .then(() => correo.enviarEmail(obj.email, key, "Confirmar cuenta"))
          .catch((e) => {
            console.warn("[registrarUsuario] Fallo enviando email:", e.message);
            modelo.registrarActividad("registroUsuarioFallido", nuevoUsuario.email);
          });

        callback(res);
      });
    });
    // cierre de la búsqueda por email
    });
  };

  // ===========================
  // CONFIRMAR cuenta
  // ===========================
  this.confirmarUsuario = function (obj, callback) {
    console.log("[modelo.confirmarUsuario] entrada:", obj);
    let modelo = this;
    let responded = false;
    const finish = (result) => {
      if (!responded) {
        responded = true;
        console.log("[modelo.confirmarUsuario] respuesta:", result);
        callback(result);
      }
    };

    setTimeout(() => finish({ email: -1, reason: "timeout" }), 8000);

    this.cad.buscarUsuario(
      { email: obj.email, key: obj.key, confirmada: false },
      function (usr) {
        console.log("[modelo.confirmarUsuario] usuario encontrado:", usr ? { email: usr.email, _id: usr._id } : null);
        if (!usr) {
          modelo.registrarActividad("confirmarUsuarioFallido", obj.email);
          return finish({ email: -1 });
        }

        usr.confirmada = true;
        modelo.cad.actualizarUsuario(usr, function (res) {
          callback(res && res.email ? { email: res.email } : { email: -1 });
        });
        modelo.registrarActividad("confirmarUsuario", usr.email);
      }
    );
  };

  // ===========================
  // LOGIN local (exige confirmada: true)
  // ===========================
  this.loginUsuario = function (obj, callback) {
    let modelo = this;
    console.log("[modelo.loginUsuario] entrada:", obj);
    if (!obj || !obj.email || !obj.password) {
      console.warn("[modelo.loginUsuario] datos inválidos");
      modelo.registrarActividad("loginUsuarioFallido", obj ? obj.email : null);
      callback({ email: -1 });
      return;
    }

    this.cad.buscarUsuario({ email: obj.email, confirmada: true }, function (usr) {
      console.log("[modelo.loginUsuario] resultado buscarUsuario:", usr);

      if (!usr || !usr.password) {
        console.warn("[modelo.loginUsuario] usuario inexistente o sin password");
        modelo.registrarActividad("loginUsuarioFallido", obj.email);
        callback({ email: -1 });
        return;
      }

      // Comparación con hash
      const ok = bcrypt.compareSync(obj.password, usr.password);
      if (ok) {
        modelo._obtenerOcrearUsuarioEnMemoria(usr.email, usr.nick);
        modelo.registrarActividad("inicioLocal", usr.email);
        callback(usr);
      } else {
        console.warn("[modelo.loginUsuario] credenciales inválidas");
        modelo.registrarActividad("loginUsuarioFallido", obj.email);
        callback({ email: -1 });
      }
    });
  };
  // ===========================
  // REGISTRO de actividad
  // ===========================

  this.registrarActividad = function (tipoOperacion, emailUsuario) {
    const operacionesExito = {
      registroUsuario: true,
      inicioLocal: true,
      inicioGoogle: true,
      crearPartida: true,
      unirAPartida: true,
      cerrarSesion: true,
      eliminarPartida: true,
    };

    if (!operacionesExito[tipoOperacion] || !emailUsuario) {
      return;
    }

    const usuarioConDetalle = arguments[2] && arguments[2].partida
      ? `${emailUsuario} [partida:${arguments[2].partida}]`
      : emailUsuario;

    (async () => {
      try {
        await this.cad.insertarLog(tipoOperacion, usuarioConDetalle);
      } catch (err) {
        console.error("[modelo.registrarActividad] Error guardando log:", err && err.message ? err.message : err);
      }
    })();
  };

}
function getMaxJugPorJuego(juego) {
  switch (juego) {
    case 'uno':      // "Última carta"
      return 4;      // aquí tienes tu juego de 3+ jugadores
    case '4raya':
      return 2;
    case 'hundir':
      return 2;
    default:
      return 2;      // por defecto, 2
  }
}


function Usuario(email, nick) {
  this.email = email;
  this.nick = nick || email;
}

function Partida(codigo, propietario, juego, maxJug) {
  const juegoVal = juego || 'uno';
  this.codigo = codigo;
  this.propietario = propietario;
  this.jugadores = [];
  this.maxJug = typeof maxJug === 'number' ? maxJug : getMaxJugPorJuego(juegoVal);
  this.estado = 'pendiente';
  this.juego = juegoVal;
}
module.exports.Sistema = Sistema;
