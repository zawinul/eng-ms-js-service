const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const validazioneRichiesta = require('./validazione-richiesta');
const portfinder = require('portfinder');
const winston = require('winston');
const path = require('path');
const cors = require('cors');
const randomstring = require("randomstring");
const YAML = require('yamljs');

// serve a fare in modo che nelle chiamate https siano accettati anche certificati autofirmati
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";


async function init(cfg) {
	const configDefaults = {
		name: 'SRV'+(new Date().getTime()),
		httpPort: 7000,
		httpsPort: 7100,
		preValidation: function(req) {  },
		postValidation: function(req) {  }
	};
	
	
	var config = Object.assign({}, configDefaults, cfg);
	getCurrent.current = config;
	config.logger = initLogger(config);
	config.logger.info(`starting ${config.name}`);
	config.app = await initExpress(config);
	config.instanceName = config.instanceName || randomstring.generate(7).toUpperCase();
	config.addSwagger = addSwagger;
	logger.info(`service ${config.name} started!`);

	return config;
}

function initLogger(config) {
	const { createLogger, format, transports } = require('winston');
	const { combine, timestamp, label, printf } = format;

	const myFormat = printf(({ level, message, label, timestamp }) => {
		return `${timestamp} [${label}] ${level}: ${message}`;
	});

	const consoleFormat = combine(
		label({ label: config.name }),
		timestamp(),
		myFormat
  	);

	logger = winston.createLogger({
		level: 'info',
		format: winston.format.json(),
		defaultMeta: {
			service: config.name
		},
		transports: [
			new winston.transports.File({ filename: 'service.log' }),
			new winston.transports.Console({ 
				format: consoleFormat })

		]
	});
	return logger;
}

function addSwagger(yamlFilePath) {
	var cfg = this;
	const swaggerUi = require('swagger-ui-express');
	var yamlString = fs.readFileSync(yamlFilePath, {encoding:'utf8'});
	var swaggerDocument = YAML.parse(yamlString);
	cfg.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

}
async function initExpress(config) {
	var app = express();
	app.use(cors());
	app.use(express.json());       // supporta JSON-encoded bodies
	app.use(express.urlencoded()); // supporta URL-encoded bodies

	app.use('/alive', function (req, res, next) {
		// anche senza autenticazione
		res.status(200).send('OK');
	});

	// pre-validazione 
	app.use(async function (req, res, next) {
		config.preValidation(req);
		next();
	});

	// validazione 
	app.use(async function (req, res, next) {
		if (req.isValidated) {
			next();
			return;
		}
		try {
			await validazioneRichiesta(req, config.name);
			logger.debug('validazione ok');
			req.isValidated = true;
			next();
		}
		catch (error) {
			logger.error('errore: ' + error.message);
			req.isValidated = false;
		}
	});

	
	// post-validazione 
	app.use(async function (req, res, next) {
		config.postValidation(req);
		if (req.isValidated)
			next();
		else 
			res.status(400).send("Fail!");
	});

	if (config.httpsPort>0) {
		const certificateDirectory = path.join(__dirname, '/certificati');
		const certificateFile = config.certificateFile || path.join(certificateDirectory, 'my-https-cert.pem');
		const encriptedKeyFile = config.encriptedKeyFile || path.join(certificateDirectory, 'my-https-key-encrypted.pem');
		const encriptedKeyPassPhrase = config.encriptedKeyPassPhrase || 'ZHCC JTXP';

		const sslOptions = config.sslOptions ||  {
			cert: fs.readFileSync(certificateFile),
			key: fs.readFileSync(encriptedKeyFile),
			passphrase: encriptedKeyPassPhrase
		};
		config.httpsPort = await portfinder.getPortPromise({
			port: config.httpsPort,    // minimum port
			stopPort: config.httpsPort+100 // maximum port
		});

		https.createServer(sslOptions, app).listen(config.httpsPort);
		config.logger.info('HTTPS server started at port '+config.httpsPort);
	}
	if (config.httpPort>0) {
		config.httpPort = await portfinder.getPortPromise({
			port: config.httpPort,    // minimum port
			stopPort: config.httpPort+100 // maximum port
		});

		http.createServer(app).listen(config.httpPort);
		config.logger.info('HTTP server started at port '+config.httpPort);
	}

	return app;
}

function getCurrent() {
	return getCurrent.current;
}



module.exports = {
	init: init,
	getCurrent: getCurrent
};


