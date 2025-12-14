const fs = require("fs");
const path = require('path');
const express = require("express");
const app = express();
const http = require('http');
const httpServer = http.Server(app);
const { Server } = require("socket.io");
const cors = require("cors");

require('dotenv').config();

const PORT = process.env.PORT;
const CORS_ORIGIN = process.env.CORS_ORIGIN;
const DEBUG_AUTH = String(process.env.DEBUG_AUTH || '').toLowerCase() === 'true';

app.use(cors({
  origin: function(origin, callback) {
    // Permitir requests sin origin (como herramientas de desarrollo)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [CORS_ORIGIN];
    // También permitir el dominio del APP_URL
    if (APP_URL) {
      try {
        const appOrigin = new URL(APP_URL).origin;
        if (!allowedOrigins.includes(appOrigin)) {
          allowedOrigins.push(appOrigin);
        }
      } catch(e) {}
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('[CORS] origin no permitido:', origin);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['set-cookie']
}));

const APP_URL = process.env.APP_URL;
const passport=require("passport");
const session = require('express-session');

function redirectClient(res, path = "/", query = {}) {
  const u = new URL(path, APP_URL);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return res.redirect(u.toString());
}

require("./server/passport-setup.js");
const modelo = require("./server/modelo.js");
let sistema = new modelo.Sistema();
// Socket.io server
const moduloWS = require("./server/servidorWS.js");

// Enlazamos Socket.IO al httpServer
let io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true
  }
});
let ws = new moduloWS.ServidorWS();

// Request logger (conditional)
if (DEBUG_AUTH) {
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    const origin = req.headers.origin;
    const referer = req.headers.referer || req.headers.referrer;
    const ua = req.headers['user-agent'];
    const cookiesPresent = !!(req.headers.cookie);
    const cookieNames = (req.headers.cookie || '').split(';').map(s => s.trim().split('=')[0]).filter(Boolean);
    const hasSessionId = !!(req.session && req.session.id);
    const hasReqUser = !!req.user;
    const hasSessionUser = !!(req.session && req.session.user);

    console.log('[REQ]', { method: req.method, path: req.path, origin, referer, ua, cookiesPresent, cookieNames, hasSessionId, hasReqUser, hasSessionUser });

    res.on('finish', () => {
      const end = process.hrtime.bigint();
      const ms = Number((end - start) / 1000000n);
      console.log('[RES]', { path: req.path, status: res.statusCode, timeMs: ms });
    });
    next();
  });
}

// --------------------
// Juegos 
// --------------------
// const unoDistPath = path.join(__dirname, 'client/games/uno/dist');
// app.use('/uno', express.static(unoDistPath));


// Diagnostic middleware for static assets (helps debug production 503/404)
app.use(function(req, res, next){
  // only log requests for likely static assets
  if (req.path.match(/^\/(css|img|clienteRest\.js|controlWeb\.js|config\.js|favicon\.ico)/)){
    const fpath = path.join(__dirname, 'client', req.path.replace(/^\//, ''));
    fs.access(fpath, fs.constants.R_OK, function(err){
      if (err){
        console.warn('[static-diagnostic] asset requested but not accessible:', { url: req.url, fsPath: fpath, err: err.message });
        // continue to static middleware so behavior is unchanged; but also attach flag for later
        req._staticMissing = true;
      }
      next();
    });
    return;
  }
  next();
});

// Configurar Express: servir archivos estáticos desde /client
// app.use(express.static(path.join(__dirname, 'client')));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const IN_PROD = process.env.NODE_ENV === 'production';
if (IN_PROD){
  app.set('trust proxy', 1);
}
app.get('/test-session', (req, res) => {
  if (!req.session.views) req.session.views = 0;
  req.session.views++;
  res.send(`Views: ${req.session.views}`);
});

app.use(session({
 name: 'sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: IN_PROD,
  cookie: {
    httpOnly: true,
    secure: true,        // en Cloud Run SIEMPRE true
    sameSite: 'none',    // clave para cross-site (cliente<->servidor)
    maxAge: 24 * 60 * 60 * 1000
  }
}));


app.use(passport.initialize());
app.use(passport.session());
const haIniciado = function(request, response, next){
  try{
    const isAuth = (typeof request.isAuthenticated === 'function' && request.isAuthenticated())
                    || !!request.user
                    || !!(request.session && request.session.user);

    if (isAuth){
      return next();
    }
  }catch(e){
    console.warn('[haIniciado] error comprobando auth:', e && e.message);
  }

  console.warn('[haIniciado] acceso no autorizado:', { path: request.path, method: request.method, ip: request.ip });

  // Si no hay usuario, redirigimos al cliente (/) como indica el ejemplo
  return response.redirect(`${APP_URL}/`);
};

// --------------------
// Rutas
// --------------------

app.get("/auth/google",
  (req, res, next) => { if (DEBUG_AUTH) console.log('[AUTH/GOOGLE] start', { origin: req.headers.origin, referer: req.headers.referer }); next(); },
  passport.authenticate('google', { scope: ['profile','email'] })
);

app.get('/google/callback',
  (req, res, next) => { if (DEBUG_AUTH) console.log('[GOOGLE/CALLBACK] enter'); next(); },
  passport.authenticate('google', {failureRedirect: '/fallo'}),
  function(req, res) {
    if (DEBUG_AUTH) console.log('[GOOGLE/CALLBACK] success');
    res.redirect('/good'); 
});

app.get("/good", function(req, res) {
  console.log("[/good] Google OAuth callback, usuario:", req.user ? { id: req.user.id, displayName: req.user.displayName, emails: req.user.emails } : 'NONE');
  if (!req.user) {
    console.error("[/good] ERROR: req.user es null/undefined");
    return res.redirect('/fallo');
  }

  let email = null;
  if (req.user.emails && Array.isArray(req.user.emails) && req.user.emails.length > 0) {
    email = req.user.emails[0].value;
  }
  
  if (!email) {
    console.error("[/good] ERROR: no email en profile");
    return res.redirect('/fallo');
  }

  const displayName = req.user.displayName || '';
  console.log("[/good] email extraído:", email, "displayName:", displayName);

  process.nextTick(() => {
    sistema.usuarioGoogle({ email, displayName }, function(obj) {
      console.log("[/good] usuarioGoogle retornó:", obj);
      if (!obj || !obj.email) {
        console.error("[/good] ERROR: objeto inválido de usuarioGoogle");
        return res.redirect('/fallo');
      }
      try {
        req.session.user = { email };
      } catch(e) {
        console.warn("[/good] session.user error:", e && e.message);
      }
      const nickToSet = obj.nick || email;
      console.log("[/good] nick final:", nickToSet);
      if (DEBUG_AUTH) console.log('[GOOD] setting session/cookie', { email, nick: nickToSet });
      
      // Configurar cookie con opciones para cross-domain
      res.cookie('nick', nickToSet, {
        maxAge: 24 * 60 * 60 * 1000, // 24 horas
        httpOnly: false, // debe ser false para que JavaScript pueda leerla
        secure: IN_PROD, // true solo en producción
        sameSite: IN_PROD ? 'none' : 'lax', // 'none' en producción requiere secure:true
        domain: undefined // no especificar domain para que funcione en subdominios
      });
      
      // Pasar nick en APP_URL porque cookies cross-domain no funcionan en navegadores modernos
      res.redirect(`${APP_URL}/?nick=${encodeURIComponent(nickToSet)}`);
    });
  });
});

app.get("/fallo", function(req, res) {
  console.error("[/fallo] Redirigiendo, usuario no autenticado correctamente");
  if (DEBUG_AUTH) console.log('[FALLO] redirect', { target: `${APP_URL}/fallo` });
  res.redirect(`${APP_URL}/fallo`);
});

app.get("/agregarUsuario/:nick", haIniciado, function(request, response) {
  let nick = request.params.nick;
  let res = sistema.agregarUsuario(nick);
  response.send(res);
});

app.get("/obtenerUsuarios", haIniciado, function(request, response) {
  let res = sistema.obtenerUsuarios();
  response.send(res);
});

app.get("/usuarioActivo/:nick", haIniciado, function(request, response) {
  let nick = request.params.nick;
  let res = { activo: sistema.usuarioActivo(nick) };
  response.send(res);
});

app.get("/numeroUsuarios", haIniciado, function(request, response) {
  let res = { num: sistema.numeroUsuarios() };
  response.send(res);
});

app.get("/eliminarUsuario/:nick", haIniciado, function(request, response) {
  let nick = request.params.nick;
  sistema.eliminarUsuario(nick);
  response.send({ eliminado: nick });
});

app.get('/salir', function(req, res){
  console.log('[/salir] petición de cierre de sesión, user?', !!req.user);
  try{
    // Passport: intenta logout si está disponible
    if (typeof req.logout === 'function'){
      // En algunas versiones puede requerir callback
      try { req.logout(); } catch(e) { console.warn('[/salir] req.logout fallo:', e && e.message); }
    }
  }catch(e){ console.warn('[/salir] error al llamar logout:', e && e.message); }

  // Destruir la sesión
  if (req.session){
    req.session.destroy(function(err){
      if (err) console.warn('[/salir] error destruyendo sesión:', err && err.message);
      // Borrar cookie de sesión y cookie 'nick'
      res.clearCookie('nick');
      // Responder según tipo de petición
      const acceptsJson = req.xhr || (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1);
      if (acceptsJson) return res.json({ ok: true });
      return res.redirect(`${URL}/`);
    });
  } else {
    res.clearCookie('nick');
    const acceptsJson = req.xhr || (req.headers.accept && req.headers.accept.indexOf('application/json') !== -1);
    if (acceptsJson) return res.json({ ok: true });
    return res.redirect(`${APP_URL}/`);
  }
});


// One Tap: callback
app.post('/oneTap/callback', (req, res, next) => {
  console.log('[oneTap/callback] credential presente:', !!req.body.credential);
  if (DEBUG_AUTH) {
    const cred = req.body.credential || '';
    const prefix = cred.substring(0, 10);
    const suffix = cred.substring(Math.max(0, cred.length - 4));
    console.log('[oneTap/callback] detail', { len: cred.length, prefix, suffix });
  }
  if (!req.body.credential) {
    console.error('[oneTap] sin credential');
    return res.status(400).json({ redirect: `${APP_URL}/fallo`, error: 'missing_credential' });
  }
  
  passport.authenticate('google-one-tap', (err, user, info) => {
    if (err) {
      console.error('[oneTap] error:', err);
      if (DEBUG_AUTH) console.log('[oneTap] info:', info);
      return res.status(401).json({ redirect: `${APP_URL}/fallo`, error: 'auth_failed' });
    }
    if (!user) {
      console.warn('[oneTap] no user de strategy');
      return res.status(401).json({ redirect: `${APP_URL}/fallo`, error: 'no_user' });
    }
    
    req.login(user, (loginErr) => {
      if (loginErr) {
        console.error('[oneTap] login error:', loginErr);
        return res.status(401).json({ redirect: `${APP_URL}/fallo`, error: 'login_error' });
      }
      
      let email = null;
      if (user.emails && Array.isArray(user.emails) && user.emails.length > 0) {
        email = user.emails[0].value;
      } else if (user.email) {
        email = user.email;
      }
      
      const displayName = user.displayName || '';
      
      if (!email) {
        console.error('[oneTap] sin email');
        return res.status(401).json({ redirect: `${APP_URL}/fallo`, error: 'no_email' });
      }
      
      sistema.usuarioGoogle({ email, displayName }, function(obj) {
        if (!obj || !obj.email) {
          console.error('[oneTap] usuarioGoogle fallo');
          return res.status(401).json({ redirect: `${APP_URL}/fallo`, error: 'usuarioGoogle_failed' });
        }
        try {
          req.session.user = { email };
          const nickToSet = obj.nick || email;
          res.cookie('nick', nickToSet, {
            maxAge: 24 * 60 * 60 * 1000, // 24 horas
            httpOnly: false, // debe ser false para que JavaScript pueda leerla
            secure: IN_PROD, // true solo en producción
            sameSite: IN_PROD ? 'none' : 'lax', // 'none' en producción requiere secure:true
            domain: undefined // no especificar domain para que funcione en subdominios
          });
        } catch (e) {
          console.warn('[oneTap] cookie error:', e.message);
        }
        if (DEBUG_AUTH) console.log('[oneTap] success', { email, nick: obj.nick || email });
        return res.status(200).json({ redirect: `${APP_URL}/?nick=${encodeURIComponent(obj.nick || email)}` });
      });
    });
  })(req, res, next);
});

// Diagnostic endpoint: listar archivos estáticos desplegados (útil en producción)
app.get('/assets-debug', (req, res) => {
  const dir = path.join(__dirname, 'client');
  const walk = (dirPath) => {
    let results = [];
    try {
      const list = fs.readdirSync(dirPath);
      list.forEach(function(file) {
        const full = path.join(dirPath, file);
        const stat = fs.statSync(full);
        if (stat && stat.isDirectory()) {
          results = results.concat(walk(full));
        } else {
          results.push(path.relative(path.join(__dirname, 'client'), full));
        }
      });
    } catch (e) {
      return ['ERROR: ' + (e.message || e)];
    }
    return results;
  };
  res.json({ files: walk(dir) });
});




// Registro de usuario
app.post("/registrarUsuario", function(req, res){
  console.log("[/registrarUsuario] body recibido:", req.body);
  const t0 = Date.now();
  let responded = false;
  const send = (status, payload) => {
    if (responded) return;
    responded = true;
    console.log(`[/registrarUsuario] -> ${status} en ${Date.now()-t0}ms; payload:`, payload);
    return res.status(status).json(payload);
  };

  try {
    sistema.registrarUsuario(req.body, function(out){
      console.log("[/registrarUsuario] callback del modelo:", out);
      if (out && out.email && out.email !== -1){
        return send(201, { nick: out.email });
      } else {
        // Devolver reason si existe para mejor feedback al cliente
        const reason = (out && out.reason) || "unknown";
        const errorMsg = reason === "email_ya_registrado" ? "El email ya está registrado" :
                        reason === "nick_ya_registrado" ? "El nick ya está en uso" :
                        reason === "nick_vacio" ? "El nick no puede estar vacío" :
                        "No se ha podido registrar el usuario";
        return send(409, { nick: -1, reason, error: errorMsg });
      }
    });

    setTimeout(() => {
      if (!responded){
        console.warn("[/registrarUsuario] SIN RESPUESTA tras 10s (posible cuelgue en modelo/CAD)");
        send(504, { nick: -1, reason: "timeout", error: "Tiempo de respuesta agotado" });
      }
    }, 10000);

  } catch (err) {
    console.error("[/registrarUsuario] EXCEPCIÓN sin capturar:", err);
    send(500, { nick: -1, error: "Error interno del servidor" });
  }
});

app.get("/confirmarUsuario/:email/:key", (req, res) => {
  const { email, key } = req.params;
  let responded = false;

  // Función para enviar una única respuesta
  const sendResponse = (usr) => {
    if (responded) return;
    responded = true;

    if (usr && usr.email && usr.email !== -1) {
      console.log("[/confirmarUsuario] confirmación exitosa para:", usr.email);
      req.session.user = { email: usr.email };
      res.cookie('nick', usr.email);
    } else {
      console.log("[/confirmarUsuario] confirmación fallida:", usr);
    }
    res.redirect(`${APP_URL}/`);
  };

  // Procesar la confirmación
  sistema.confirmarUsuario({ email, key }, (usr) => {
    console.log("[/confirmarUsuario] resultado confirmarUsuario:", usr);
    sendResponse(usr);
  });

  // Timeout de seguridad
  setTimeout(() => {
    console.warn("[/confirmarUsuario] timeout alcanzado");
    sendResponse({ email: -1, reason: "timeout" });
  }, 5000);
});

// Servir configuración cliente (variables de entorno) como JS
app.get('/config.js', (req, res) => {
  // Soporta varios nombres de variable en .env para compatibilidad
  const CLIENT_ID = process.env.CLIENT_ID || process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || '';
  const LOGIN_URI = process.env.LOGIN_URI || process.env.ONE_TAP_CALLBACK_URL || process.env.ONE_TAP_LOGIN_URI || process.env.GOOGLE_CALLBACK_URL || '';
  const cfg = { CLIENT_ID, LOGIN_URI };
  console.log('[config.js] sirviendo configuración al cliente:', cfg);
  res.type('application/javascript');
  res.send(`window.APP_CONFIG = ${JSON.stringify(cfg)};`);
});

app.post('/loginUsuario', function(req, res){
  sistema.loginUsuario(req.body, function(out){
    if (out && out.email && out.email !== -1){
      req.session.user = { email: out.email };
      res.send({ nick: out.email });
    } else {
      res.status(401).send({ nick: -1 });
    }
  });
});

app.get('/api/logs', async function(req, res) {
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 100);
  const email = (req.query.email || '').toLowerCase();
  try {
    const col = sistema && sistema.cad && sistema.cad.logs;
    if (!col) {
      throw new Error("Coleccion logs no disponible");
    }
    const filtro = email ? { usuario: { $regex: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } } : {};
    const docs = await col.find(filtro, { maxTimeMS: 5000 }).sort({ "fecha-hora": -1 }).limit(limit).toArray();
    return res.status(200).json(docs);
  } catch (err) {
    console.error("[/api/logs] Error obteniendo logs:", err && err.message ? err.message : err);
    return res.status(500).json({ error: "Error al obtener logs" });
  }
});
// Simple health/env summary (no secrets)
app.get('/health', (req, res) => {
  try {
    const summary = {
      PORT: !!process.env.PORT,
      SESSION_SECRET: !!process.env.SESSION_SECRET,
      CORS_ORIGIN: process.env.CORS_ORIGIN || null,
      APP_URL: process.env.APP_URL || null,
      GOOGLE_CLIENT_ID: !!(process.env.GOOGLE_CLIENT_ID || process.env.CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID),
      GOOGLE_CLIENT_SECRET: !!(process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_ONE_TAP_CLIENT_SECRET),
      GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || null,
      ONE_TAP_CALLBACK_URL: process.env.ONE_TAP_CALLBACK_URL || process.env.ONE_TAP_LOGIN_URI || null,
      DEBUG_AUTH: String(process.env.DEBUG_AUTH || '').toLowerCase() === 'true',
      NODE_ENV: process.env.NODE_ENV || null
    };
    res.status(200).json({ ok: true, summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: e && e.message });
  }
});
// ------------------------------------
// Iniciar el servidor
// ------------------------------------
try {
  const clientDir = path.join(__dirname, 'client');
  const walkSync = (dir, filelist = []) => {
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat && stat.isDirectory()) {
        walkSync(full, filelist);
      } else {
        filelist.push(path.relative(path.join(__dirname, 'client'), full));
      }
    });
    return filelist;
  };
  const files = walkSync(clientDir);
  console.log('[startup] archivos en client/ (muestra hasta 50):', files.slice(0,50));
} catch (e) {
  console.warn('[startup] no se pudo listar client/:', e && e.message);
}

function startServer(port){
  try {
    httpServer.listen(port, () => {
      console.log(`App está escuchando en el puerto ${port}`);
      console.log("Ctrl+C para salir");
      ws.lanzarServidor(io, sistema);
    });
  } catch(e) {
    if (e && e.code === 'EADDRINUSE'){
      const next = (parseInt(port,10) || 3000) + 1;
      console.warn(`[startup] Puerto ${port} en uso, intentando ${next}...`);
      startServer(next);
    } else {
      throw e;
    }
  }
}

startServer(PORT);

// Socket.IO connection log
io.on('connection', (socket) => {
  if (DEBUG_AUTH) {
    const h = socket.handshake || {};
    const hdrs = h.headers || {};
    console.log('[WS] connection', { id: socket.id, origin: hdrs.origin, ua: hdrs['user-agent'] });
  }
  socket.on('disconnect', (reason) => {
    if (DEBUG_AUTH) console.log('[WS] disconnect', { id: socket.id, reason });
  });
});

// Global error handlers
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', { reason: (reason && reason.message) || String(reason) });
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', { error: err && err.message });
});


