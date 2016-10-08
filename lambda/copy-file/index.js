'use strict';
var AWS = require('aws-sdk');
var secrets = require('secret');
var pips = require('pips');

var BUCKET = 'livemodavdistributionresources-bundledistbucket-29mqlxzzh2';
var MAP_ID = 'piff_abr_low_audio';
var ROLE = 'arn:aws:iam::240129357028:role/LiveModavWorldServiceResour-WorldServiceAccessRole-141XGCC8G4F7Z';
var EXTERNAL_ID = '706f6331';

exports.handler = (event, context, callback) => {
    var vpid = event.pid;
    var sts = new AWS.STS();
    sts.assumeRole({
        RoleArn: ROLE,
        ExternalId: EXTERNAL_ID,
        RoleSessionName: 'ws-partner-download-poc-' + Date.now()
    }, function(err, data) {
        if (err) {
            console.log(err, err.stack); // an error occurred
        } else {
            var creds = new AWS.Credentials({
                accessKeyId: data.Credentials.AccessKeyId,
                secretAccessKey: data.Credentials.SecretAccessKey,
                sessionToken: data.Credentials.SessionToken
            });
            var options = {
                region: 'eu-west-1',
                credentials: creds
            };
            var s3 = new AWS.S3(options);
            pips.media_asset_prefix(vpid, MAP_ID, secrets).then(
                function(file_prefix) {
                    var params = {
                        Bucket: BUCKET,
                        EncodingType: 'url',
                        MaxKeys: 100,
                        Prefix: MAP_ID + '/' + file_prefix,
                    };
                    s3.listObjectsV2(params, function(err, data) {
                        if (err) console.log(err, err.stack); // an error occurred
                        else {
                            // now chose the right file
                            var files = data.Contents;
                            var filename = '';
                            for (var i = 0; i < files.length; i++) {
                                if (files[i].Key.endsWith('.ismv')) {
                                    filename = files[i].Key;
                                }
                            }
                            // now copy it
                            s3.copyObject({
                                    'Bucket': 'ws-partner-download-poc-ms',
                                    'CopySource': BUCKET + '/' + filename,
                                    'Key': vpid + '.ismv',
                                    'ACL': 'bucket-owner-full-control'
                                },
                                function(err, data) {
                                    if (err)
                                        console.log(err, err.stack); // an error occurred
                                    else
                                        callback(null, data); // Echo back the first key value
                                });
                        }
                    });
                }
            );
        }
    });
};
