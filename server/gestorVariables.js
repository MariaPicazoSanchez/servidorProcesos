const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const client = new SecretManagerServiceClient();

// Cache resolved project id so we don't call metadata repeatedly
let _cachedProjectId = null;
async function _resolveProjectId() {
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  if (_cachedProjectId) return _cachedProjectId;
  try {
    _cachedProjectId = await client.getProjectId();
    return _cachedProjectId;
  } catch (err) {
    console.error('[gestorVariables] No se pudo resolver GOOGLE_CLOUD_PROJECT:', err && err.message);
    throw new Error('No se pudo resolver el projectId para Secret Manager. Asegure la variable de entorno GOOGLE_CLOUD_PROJECT o la metadata de GCP.');
  }
}

async function accessCLAVECORREO() {
  const pid = await _resolveProjectId();
  const name = `projects/${pid}/secrets/CLAVECORREO/versions/latest`;
  const [version] = await client.accessSecretVersion({ name });
  const datos = version.payload.data.toString('utf8');
  return datos;
}

async function accessCORREOCUENTA() {
  const pid = await _resolveProjectId();
  const name = `projects/${pid}/secrets/CORREOCUENTA/versions/latest`;
  const [version] = await client.accessSecretVersion({ name });
  const datos = version.payload.data.toString('utf8');
  return datos;
}

async function accessMONGOURI() {
  const pid = await _resolveProjectId();
  const name = `projects/${pid}/secrets/MONGOURI/versions/latest`;
  const [version] = await client.accessSecretVersion({ name });
  const uri = version.payload.data.toString('utf8');
  return uri;
}

module.exports.obtenerOptions = async function (callback) {
  let options = { user: "", pass: "", mongoURI: "" };

  // Lee los dos secretos
  let user = await accessCORREOCUENTA();
  let pass = await accessCLAVECORREO();

  options.user = user;
  options.pass = pass;

  // Para depurar
  // console.log("[gestorVariables] user:", user);
  // console.log("[gestorVariables] pass leída (NO la imprimas en producción)");

  callback(options);
};

module.exports.obtenerMongoUri = async function () {
  // Desarrollo local
  if (process.env.MONGO_URI) {
    return process.env.MONGO_URI;
  }

  // Producción
  return await accessMONGOURI();
};