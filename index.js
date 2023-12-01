const express = require('express');
const expressWinston = require('express-winston');
const asyncHandler = require('express-async-handler');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const notFoundHandlerDefault = (isHTML) => (req, res) => {
  res.status(404);
  if (isHTML && req.accepts('html')) return res.render('404');
  return res.send({ error: 'Not found' });
};

function getOriginFromReferer(referer) {
  if (!referer) return null;
  const parsedUrl = new URL(referer);
  const port = parsedUrl.port ? `:${parsedUrl.port}` : '';
  return `${parsedUrl.protocol}//${parsedUrl.hostname}${port}`;
}

module.exports = ({
  port,
  host,
  corsWhitelist = [],
  corsAllowHeaders = 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
  corsAllowMethods = 'GET, POST, PUT, DELETE, OPTIONS',
  corsAllowCredentials = 'true',
  endpoints = [],
  rawBodyEndpoints = [],
  isHTML = false,
  extraFirstMiddlewares = null,
  extraMiddlewares = null,
  extraMiddlewaresAfterEndpoint = null,
  extraMiddlewaresAfterNotFound = null,
  extraMiddlewaresAfterError = null,
  enableJsonBody = true,
  enableFormBody = true,
  enableCookies = true,
  enableHealth = true,
  removeTrailingSlashes = true,
  enableCompression = true,
  notFoundHandler = notFoundHandlerDefault,
  jsonLog = process.env.NODE_ENV === 'production',
}) => ({
  name: 'express',
  init: async ({ logger }) => {
    let httpServer;

    const hostParam = host || process.env.EXPRESS_HOST || '0.0.0.0';
    const portParam = port || process.env.EXPRESS_PORT || process.env.PORT || 80;

    // Helper to get route
    const getRouter = () => express.Router();

    const throwError = (message, errorCode, state) => {
      const err = new Error(message);
      err.status = errorCode;
      if (state) {
        err.state = state;
      }
      throw err;
    };

    // Bootstrap express server
    const app = express();

    // extra First Middlewares
    if (extraFirstMiddlewares) {
      extraFirstMiddlewares(app, { express });
    }

    // rawBodyEndpoints
    rawBodyEndpoints.forEach((endpoint) => {
      app.use(endpoint, express.raw({ type: '*/*', limit: process.env.EXPRESS_RAW_LIMIT || '50mb' }));
    });

    app.disable('x-powered-by');
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    if (enableJsonBody) app.use(express.json({ limit: process.env.EXPRESS_JSON_LIMIT || '10mb' }));
    if (enableFormBody) app.use(express.urlencoded({ limit: process.env.EXPRESS_BODY_LIMIT || '10mb', extended: true, parameterLimit: 10000 }));
    if (enableCookies) app.use(cookieParser());

    // Middleware to add CORS headers if the origin is valid
    if (corsWhitelist.length) {
      app.use((req, res, next) => {
        const origin = req.headers.origin || getOriginFromReferer(req.headers.referer);
        // Check if the origin is in the whitelist
        if (corsWhitelist.includes(origin)) {
          res.header('Access-Control-Allow-Origin', origin);
          res.header('Access-Control-Allow-Methods', corsAllowMethods);
          res.header('Access-Control-Allow-Credentials', corsAllowCredentials);
          res.header('Access-Control-Allow-Headers', corsAllowHeaders);

          // Check if it's a preflight request
          if (req.method === 'OPTIONS') {
            // Send response with status 200 to indicate that the preflight request is accepted
            res.sendStatus(200);
            return;
          }
        }

        next();
      });
    }

    // health check
    if (enableHealth) app.get('/~health', (req, res) => res.send('ok'));

    // extra Middlewares
    if (extraMiddlewares) {
      extraMiddlewares(app, { express });
    }

    // Remove trailing slashes
    if (removeTrailingSlashes) {
      app.use((req, res, next) => {
        if (req.path.substr(-1) === '/' && req.path.length > 1) {
          const query = req.url.slice(req.path.length);
          res.redirect(301, req.path.slice(0, -1) + query);
        } else {
          next();
        }
      });
    }

    if (enableCompression) app.use(compression());

    if (logger.winstonInstance) {
      const defaultRequestLogger = expressWinston.logger({
        winstonInstance: logger.winstonInstance,
        msg: '{{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms {{req.ip}}',
        expressFormat: false,
        meta: false,
        colorize: process.env.NODE_ENV !== 'production',
        skip: (req) => {
          const urlLog = req.url.substring(0, 500);
          return /(^\/assets)|(\.(ico|png|jpg|jpeg|webp|woff|woff2|ttf|svg|css|js))|~*health/ig.exec(urlLog);
        },
      });

      const jsonRequestLogger = expressWinston.logger({
        format: logger.format,
        transports: [
          new logger.winston.transports.Console(),
        ],
        metaField: null,
        responseField: null,
        requestWhitelist: [],
        responseWhitelist: ['body'],
        skip: (req) => {
          const urlLog = req.url.substring(0, 500);
          return /(^\/assets)|(\.(ico|png|jpg|jpeg|webp|woff|woff2|ttf|svg|css|js))|~*health/ig.exec(urlLog);
        },
        dynamicMeta: (req, res) => {
          const httpRequest = {};
          const meta = {};
          if (req) {
            const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '').split(',')[0];
            meta.httpRequest = httpRequest;
            httpRequest.requestMethod = req.method;
            httpRequest.requestUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
            httpRequest.protocol = `HTTP/${req.httpVersion}`;
            httpRequest.remoteIp = ip.indexOf(':') >= 0 ? ip.substring(ip.lastIndexOf(':') + 1) : ip; // just ipv4
            httpRequest.requestSize = req.socket.bytesRead;
            httpRequest.userAgent = req.get('User-Agent');
            httpRequest.referrer = req.get('Referrer');
          }

          if (res) {
            meta.httpRequest = httpRequest;
            httpRequest.status = res.statusCode;
            httpRequest.latency = `${(res.responseTime / 1000)}s`;
            if (res.body) {
              if (typeof res.body === 'object') {
                httpRequest.responseSize = JSON.stringify(res.body).length;
              } else if (typeof res.body === 'string') {
                httpRequest.responseSize = res.body.length;
              }
            }
            meta.severity = (res.statusCode >= 500) ? 'warn' : 'info';
          }
          return meta;
        },
      });
      app.use(jsonLog ? jsonRequestLogger : defaultRequestLogger);
    }

    // API Endpoints
    endpoints.forEach((endpoint) => {
      const expressCtx = {
        asyncHandler,
        getRouter,
        throwError,
        app,
      };

      if (endpoint.middleware) {
        app.use(
          endpoint.path,
          endpoint.middleware,
          endpoint.handler(expressCtx),
        );
      } else {
        app.use(endpoint.path, endpoint.handler(expressCtx));
      }
    });

    // extra Middlewares After Endpoint
    if (extraMiddlewaresAfterEndpoint) {
      extraMiddlewaresAfterEndpoint(app, { express });
    }

    // Page not found
    app.use(notFoundHandler(isHTML));

    // extra Middlewares After NotFound
    if (extraMiddlewaresAfterNotFound) {
      extraMiddlewaresAfterNotFound(app, { express });
    }

    // Log Error
    app.use((err, req, res, next) => {
      const status = err.status || 500;
      if (status >= 500) {
        logger.error(`${err.message} (${(err.stack || '').replace(/\n/g, ', ')})`);
      }
      return next(err);
    });

    // Output Error page
    app.use((err, req, res, next) => { // eslint-disable-line
      const status = err.status || 500;
      res.status(status);
      const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '').split(',')[0];
      if (process.env.NODE_ENV !== 'production' || ip === process.env.EXPRESS_DEBUG_IP) {
        return res.send({
          error: err.message,
          status,
          trace: err,
          stack: err.stack,
        });
      }
      if (isHTML && req.accepts('html')) return res.render('500');
      const message = (status >= 500) ? 'Internal server error' : err.message;
      return res.send({ error: message });
    });

    // extra Middlewares After Error
    if (extraMiddlewaresAfterError) {
      extraMiddlewaresAfterError(app, { express });
    }

    // Init
    await new Promise((resolve, reject) => {
      httpServer = app.listen(portParam, hostParam, (err) => {
        if (err) return reject(err);
        logger.info(` ✔ Listening to http://${hostParam}:${portParam}`);
        return resolve(true);
      });
    });

    // Close function
    const close = () => new Promise((resolve, reject) => {
      httpServer.close((err) => {
        if (err) return reject(err);
        return resolve(true);
      });
    });

    return {
      name: 'express',
      close,
      app,
      httpServer,
    };
  },
});
