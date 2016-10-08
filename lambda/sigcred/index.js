'use strict';

var jwt = require('jsonwebtoken');

exports.handler = (event, context, callback) => {
    var apiKey = "b9ad203f-246d-4682-978a-43ae398acd53";
    var secret = "a519d6b6-f665-4925-a233-28ad191d846d";
    var configId = "mysdEfPuG";
    var claims = { iss:apiKey, cfg:configId, aud: "signiant_flight_console"};
    var token = jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: 5*60});
    callback(null, {api_key: apiKey, config_id: configId, token:token});
};
