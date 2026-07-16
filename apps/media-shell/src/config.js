'use strict';

/**
 * Config loading + validation.
 *
 * config.json shape (see README):
 *   {
 *     "slug":        "landscape-bar",              // required — signage slot slug
 *     "mediaDir":    "C:\\BunkerMedia",            // required — must exist
 *     "port":        48151,                         // optional — DEFAULT_MEDIA_PORT
 *     "catalogUrl":  "https://…/functions/v1/media-catalog-sync", // optional (dev)
 *     "deviceToken": "…",                           // optional (dev)
 *     "appUrl":      "https://os.bunkerokc.com"      // optional — DEFAULT_APP_URL
 *   }
 *
 * Resolution order for the file path:
 *   1. explicit path passed to loadConfig()
 *   2. $BUNKER_MEDIA_CONFIG
 *   3. config.json next to the app (cwd / app dir)
 *   4. {userDataDir}/config.json   (Electron passes app.getPath('userData'))
 *
 * On any problem we throw ConfigError with a human-readable message; the shell
 * shows it in a loud error window instead of a black kiosk screen.
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_MEDIA_PORT, DEFAULT_APP_URL } = require('./constants');

class ConfigError extends Error {}

function candidatePaths({ explicitPath, appDir, userDataDir } = {}) {
  const out = [];
  if (explicitPath) out.push(explicitPath);
  if (process.env.BUNKER_MEDIA_CONFIG) out.push(process.env.BUNKER_MEDIA_CONFIG);
  if (appDir) out.push(path.join(appDir, 'config.json'));
  out.push(path.join(process.cwd(), 'config.json'));
  if (userDataDir) out.push(path.join(userDataDir, 'config.json'));
  return out;
}

function findConfigPath(opts) {
  const tried = candidatePaths(opts);
  for (const p of tried) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  throw new ConfigError(
    'No config.json found. Looked in:\n  ' +
      tried.join('\n  ') +
      '\n\nCreate one (see config.example.json / README) with at least "slug" and "mediaDir".'
  );
}

function validate(raw, configPath) {
  if (typeof raw !== 'object' || raw === null) {
    throw new ConfigError(`config.json (${configPath}) is not a JSON object.`);
  }

  const errors = [];

  const slug = raw.slug;
  if (typeof slug !== 'string' || !slug.trim()) {
    errors.push('"slug" is required (the signage slot slug, e.g. "landscape-bar").');
  }

  const mediaDir = raw.mediaDir;
  if (typeof mediaDir !== 'string' || !mediaDir.trim()) {
    errors.push('"mediaDir" is required (absolute path to the media folder).');
  } else {
    try {
      const st = fs.statSync(mediaDir);
      if (!st.isDirectory()) errors.push(`"mediaDir" is not a directory: ${mediaDir}`);
    } catch {
      errors.push(`"mediaDir" does not exist or is unreadable: ${mediaDir}`);
    }
  }

  let port = raw.port == null ? DEFAULT_MEDIA_PORT : raw.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    errors.push(`"port" must be an integer 1024–65535 (got ${JSON.stringify(raw.port)}).`);
    port = DEFAULT_MEDIA_PORT;
  }

  let appUrl = raw.appUrl == null ? DEFAULT_APP_URL : raw.appUrl;
  let appOrigin = DEFAULT_APP_URL;
  try {
    appOrigin = new URL(appUrl).origin;
  } catch {
    errors.push(`"appUrl" is not a valid URL: ${JSON.stringify(raw.appUrl)}`);
  }

  const catalogUrl = raw.catalogUrl == null ? '' : raw.catalogUrl;
  if (catalogUrl) {
    try {
      // eslint-disable-next-line no-new
      new URL(catalogUrl);
    } catch {
      errors.push(`"catalogUrl" is not a valid URL: ${JSON.stringify(raw.catalogUrl)}`);
    }
  }

  const deviceToken = raw.deviceToken == null ? '' : String(raw.deviceToken);

  if (errors.length) {
    throw new ConfigError(
      `Invalid config.json (${configPath}):\n  - ${errors.join('\n  - ')}`
    );
  }

  const devMode = !catalogUrl || !deviceToken;

  return {
    slug: slug.trim(),
    mediaDir: path.resolve(mediaDir),
    port,
    appUrl,
    appOrigin,
    catalogUrl,
    deviceToken,
    devMode,
    kioskUrl: `${appUrl.replace(/\/$/, '')}/signage/s/${encodeURIComponent(slug.trim())}`,
    _configPath: configPath,
  };
}

/**
 * @param {{explicitPath?:string, appDir?:string, userDataDir?:string}} [opts]
 */
function loadConfig(opts = {}) {
  const configPath = findConfigPath(opts);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    throw new ConfigError(`config.json (${configPath}) is not valid JSON: ${String(e)}`);
  }
  return validate(raw, configPath);
}

module.exports = { loadConfig, validate, ConfigError, findConfigPath };
