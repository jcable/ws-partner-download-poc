'use strict';

const AWS = require("aws-sdk");
const elastictranscoder = new AWS.ElasticTranscoder();


/**
 * convert an ismv file to one or more of wav, high or low mp3 files.
 * pid: the vpid to transcode
 * output: an array of one or more of 'high','low','best'
 * master_brand: a master brand
 * genre: a genre
 * 
 * we would like this to return a token which can be used to subscribe to notifications
 * b>ut this needs a lot more thought.
 */
 
const presets = {
    "best": "1475770385778-fcy56u",
    "high": "1475908912568-9dcnvo",
    "low": "1475770484127-1vzjhu"
 };

const pipelineId = "1475770146187-wrjkd5";

function encode(data, callback) {
    console.log(data);
    var source = data.pid+".ismv";
    var params = {
      Input: { Key: source },
      PipelineId: pipelineId,
      Outputs: [],
    };
    for(var i=0; i<data.output.length; i++) {
        var quality = data.output[i];
        var filename = data.master_brand+"/"+data.genre+"/"+data.pid+"/"+quality+((quality=="best")?".wav":".mp3");
        params.Outputs.push({Key:filename, PresetId:presets[quality]});
    }
    elastictranscoder.createJob(params, callback);
}

exports.handler = (event, context, callback) => {
    //console.log('Received event:', JSON.stringify(event, null, 2));

    const done = (err, res) => callback(null, {
        statusCode: err ? '400' : '200',
        body: err ? err.message : JSON.stringify(res),
        headers: {
            'Content-Type': 'application/json',
        },
    });

    switch (event.httpMethod) {
        case 'POST':
            var data = JSON.parse(event.body);
            encode(data, done);
            break;
        default:
            done(new Error(`Unsupported method "${event.httpMethod}"`));
    }
};