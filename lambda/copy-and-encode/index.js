'use strict';

const AWS = require('aws-sdk');
var secrets = require('secret');
var pips = require('pips');

const SQS = new AWS.SQS({ apiVersion: '2012-11-05' });
const Lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });
const s3 = new AWS.S3();
const sts = new AWS.STS();
const elastictranscoder = new AWS.ElasticTranscoder();

const QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/934623987835/ws-partner-download-poc-request-file';
const PROCESS_MESSAGE = 'process-message';
const BUCKET = 'livemodavdistributionresources-bundledistbucket-29mqlxzzh2';
const MAP_ID = 'piff_abr_low_audio';
const ROLE = 'arn:aws:iam::240129357028:role/LiveModavWorldServiceResour-WorldServiceAccessRole-141XGCC8G4F7Z';
const EXTERNAL_ID = '706f6331';
const DOWNLOAD_BUCKET = 'ws-partner-download-poc-ms';
const PIPELINE_ID = "1475770146187-wrjkd5";

const presets = {
    "best": "1475770385778-fcy56u",
    "high": "1475908912568-9dcnvo",
    "low": "1475770484127-1vzjhu"
 };

function invokePoller(functionName, message) {
    const payload = {
        operation: PROCESS_MESSAGE,
        message,
    };
    const params = {
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: new Buffer(JSON.stringify(payload)),
    };
    return new Promise((resolve, reject) => {
        Lambda.invoke(params, (err) => (err ? reject(err) : resolve()));
    });
}

function copy_and_encode(params, callback) {
    var ismv_file = params.prefix+".ismv";
    s3.headObject({ Bucket: DOWNLOAD_BUCKET, Key: ismv_file },
        function(err) {
            var p1 = sts.assumeRole({
                RoleArn: ROLE,
                ExternalId: EXTERNAL_ID,
                RoleSessionName: 'ws-partner-download-poc-' + Date.now()
            }).promise();
            var p2 = pips.media_asset_prefix(params.pid, MAP_ID, secrets);
            Promise.all([p1, p2]).then(
                function(values) {
                    var data = values[0];
                    var file_prefix = values[1];
                    var creds = new AWS.Credentials({
                        accessKeyId: data.Credentials.AccessKeyId,
                        secretAccessKey: data.Credentials.SecretAccessKey,
                        sessionToken: data.Credentials.SessionToken
                    });
                    var options = {
                        region: 'eu-west-1',
                        credentials: creds
                    };
                    var cross_account_s3 = new AWS.S3(options);
                    var params = {
                        Bucket: BUCKET,
                        EncodingType: 'url',
                        MaxKeys: 100,
                        Prefix: MAP_ID + '/' + file_prefix,
                    };
                    cross_account_s3.listObjectsV2(params,
                        function(err, data) {
                            if(err) {
                                callback(err);
                                return;
                            }
                            // now chose the right file
                            var files = data.Contents;
                            var af_filename = '';
                            for (var i = 0; i < files.length; i++) {
                                if (files[i].Key.endsWith('.ismv')) {
                                    af_filename = files[i].Key;
                                }
                            }
                            // now copy it
                            cross_account_s3.copyObject({
                                'Bucket': DOWNLOAD_BUCKET,
                                'CopySource': BUCKET + '/' + af_filename,
                                'Key': ismv_file,
                                'ACL': 'bucket-owner-full-control'
                                },
                                function(err, data) {
                                    if(err) {
                                        callback(err);
                                        return;
                                    }
                                    console.log("ismv file copied");
                                    elastictranscoder.createJob(
                                        {
                                          Input: { Key: ismv_file},
                                          PipelineId: PIPELINE_ID,
                                          Outputs: [ {Key:params.filename, PresetId:presets[params.quality]} ],
                                        }, 
                                        callback
                                    );
                                }
                            );
                        }
                    );
                }
            );
        }
    );
}

function process(message, callback) {
    console.log("process "+message.Body);
    var filename = message.Body;
    var n = filename.split('.');
    var p = n[0].split('/');
    var params = {
        filename:filename,
        prefix: n[0],
        ext: n[1],
        master_brand: p[0],
        genre:p[1],
        pid:p[2],
        quality:p[3]
    };
    s3.headObject({ Bucket: DOWNLOAD_BUCKET, Key: filename },
        (err) => {
            if(err) {
                var semaphore = params.prefix+".started";
                console.log("encoded file not present. Looking for semaphore file "+semaphore);
                s3.headObject({ Bucket: DOWNLOAD_BUCKET, Key: semaphore },
                    (err) => {
                        if(err) {
                            console.log("semaphore file not present - work to do");
                            s3.putObject({ Bucket: DOWNLOAD_BUCKET, Key: semaphore, Body: '0' },
                                function(err){
                                    if(err)console.log(err)
                                }
                            );
                            copy_and_encode(params, callback);
                        }
                        else {
                            console.log("semaphore file "+semaphore+"exists, nothing to do");
                            callback();
                        }
                    }
                );
            }
            else {
                console.log("encoded file "+filename+"exists, nothing to do");
                callback();
            }
        }
    );
    SQS.deleteMessage(
        {
            QueueUrl: QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle,
        },
        (err) => callback(err, message)
    );
}

function poll(functionName, callback) {
    const params = {
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 10,
    };
    // batch request messages
    SQS.receiveMessage(params, (err, data) => {
        if (err) {
            return callback(err);
        }
        // for each message, reinvoke the function
        if(data.hasOwnProperty("Messages")) {
            const promises = data.Messages.map((message) => invokePoller(functionName, message));
            // complete when all invocations have been made
            Promise.all(promises).then(() => {
                const result = `Messages received: ${data.Messages.length}`;
                console.log(result);
                callback(null, result);
            });
        }
        else {
            return callback("No Message");
        }
    });
}

exports.handler = (event, context, callback) => {
    try {
        if (event.operation === PROCESS_MESSAGE) {
            // invoked by poller
            process(event.message, callback);
        } else {
            // invoked by schedule
            poll(context.functionName, callback);
        }
    } catch (err) {
        callback(err);
    }
};
