var LRU = require("lru-cache");
const fs = require('fs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const randomstring = require("randomstring");
const path = require('path');

var authCache, infoCache;
var testToken, testTokenData, testUserInfo;
var dirCertificati;
var oidcCertPem;

function init() {
	authCache = LRU(1000);
	infoCache = LRU(1000);

	dirCertificati = path.join(__dirname, './certificati');
	oidcCertPem = fs.readFileSync(path.join(dirCertificati, 'oidc-provider-certificate.pem'),{encoding:'UTF8'});

	testToken = randomstring.generate({charset:'alphabetic', length:8, capitalization:'uppercase' });
	var now = Math.floor(new Date().getTime()/1000);

	testTokenData = {
		jti: randomstring.generate(20),
		sub: "prova-servizio1",
		iss: "https://oidc-provider:3043",
		iat: now,
		exp: now+24*60*60,
		scope: "openid profile dati_applicativi altro servizio1 servizio5",
		aud: "foo"
	};

	testUserInfo = {
		sub: "prova-servizio1",
		organigramma: [{
			societa: "pippo",
			dipartimento: "pluto",
			ruolo: "direttore"
		}],
		abilitazioni: [{
				sistema: "protocollo",
				ambito: "affari legali",
				profilo: "inserimento dati"
			}
		]
	}
	initCache();
	console.log("Per test autenticare con \"Bearer "+testToken+"\"");
}

function initCache() {
	authCache.reset();
	infoCache.reset();
	authCache.set(testToken, testTokenData, 24*60*60*1000);
	infoCache.set(testToken, testUserInfo,  24*60*60*1000);
}

async function validazioneRichiesta(req, serviceName) {
	
	async function main() {
	
		if (req.headers["reset-authorization-cache"])  
			initCache();

		var token = getToken();
		var validated = await validate(token);
		var userInfo = await userInfoFromToken(token);
		req.accessToken = token;
		req.decodedAccessToken = validated;
		req.userInfo = userInfo;
		return true;
	}

	function getToken() { // => token
		var auth = req.headers.Authorization || req.headers.authorization;
		token = null;
		
		if (auth) {
			let splits = auth.split(' ');
			if (splits.length>=2 && splits[0]=='Bearer')
			token = splits[1];
		}
		if (!token)
			throw new Error("la richiesta dovrebbe contenere l'header 'Authorization: Bearer <accessToken>'");
		return token;
	}

	function validate(token) { // => decoded data
		console.log('TOKEN: '+token);
		tokenData = authCache.get(token);
		if (tokenData) {
			console.log('token già verificato');
			return tokenData;
		}
		return new Promise((resolve, reject) => {
			jwt.verify(token, oidcCertPem, function(err, decoded){
				if (err) {
					console.log('Validation KO', err);
					reject('errore nella validazione del token di accesso: '+err);		
				}
				else {
					console.log('Validation OK', JSON.stringify(decoded, null,2));
					var abilitato = decoded.scope.split(' ').indexOf(serviceName)>=0;
					if (!abilitato) 
						reject("accesso a '"+serviceName+"' non previsto nello scope del token");		
					else {
						authCache.set(token, decoded, 1000*60*60);
						resolve(decoded);
					}
				}
			});
		});
	}

	function userInfoFromToken(token) {
		var infoData = infoCache.get(token);
		if (infoData)
			return infoData;
	
		return axios({
			method:'get',
			url:'https://oidc-provider:3043/me',
			headers: {
				Authorization: 'Bearer '+token
			}
		})
		.then(response=>{
			//console.log("getUserInfo response", response);
			var userInfo = response.data;
			infoCache.set(token, userInfo, 1000*60*60);
			return userInfo;
		})
		.catch(error=>{
			console.log("getUserInfo error", error);
		})
	}

	return main();
}

init();
module.exports = validazioneRichiesta;