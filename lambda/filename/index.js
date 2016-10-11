'use strict';

console.log('Loading function');


/**
 * To get a filename, make a POST request with the following parameters:
 * master_brand
 * genre
 * pid (should be a version pid)
 * quality (low|high|best)
 */
exports.handler = (event, context, callback) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    const done = (err, res) => callback(null, {
        statusCode: err ? '400' : '200',
        body: err ? err.message : JSON.stringify(res),
        headers: {
            'Content-Type': 'application/json',
        },
    });
    var ext = (event.quality=='best')?".wav":".mp3";
    var file_name = event.master_brand+"/"+event.genre+"/"+event.pid+"/"+event.quality+ext;
    done(null, {fileName:file_name});
};