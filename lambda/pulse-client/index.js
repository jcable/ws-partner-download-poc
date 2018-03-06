'use strict';
var http = require('http');
var https = require('https');
var AWS = require("aws-sdk");
var sqs = new AWS.SQS({region : 'eu-west-1'});
var dynamodb = new AWS.DynamoDB();
var docClient = new AWS.DynamoDB.DocumentClient();

function getConfig() {
    return docClient.scan({TableName: 'ws-partner-download-poc-config'}).promise();
}

function putGenres(genres) {
    var params = {
        TableName:"ws-partner-download-poc-config",
        Item:{
          "key": "genres",
          "value": docClient.createSet(genres)
        }
    };
    docClient.put(params, function(err, data) {
        if (err) {
            console.error("Unable to update genres. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            console.log("updated genres:", JSON.stringify(genres));
        }
    });
}

function nitrorequest(params) {
    var qs = "pid="+params.pid;
    /* can't use pulse_reference with programme_details
    if(params.hasOwnProperty("pulse_reference")) {
        qs += "&pulse_reference="+params.pulse_reference
    }
    */
    if(params.hasOwnProperty("partner_pid")) {
        qs += "&partner_pid="+params.partner_pid;
    }
    var options = {
        host: "programmes.api.bbc.com",
        path: "/nitro/api/programme_details?api_key="+process.env.API_KEY+"&"+qs,
        headers: {
            accept: 'application/json'
        }
    };
    console.log("nitro request "+options.path);
    return new Promise(function(resolve,reject){
        http.get(options, function(res) {
            var data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
                var results = JSON.parse(data).nitro.results;
                if(results.total == 1) {
                    resolve(results.items[0]);
                }
                else {
                    console.log("not available");
                    console.log(data);
                    resolve(null);
                }
            });
        }).on('error', function(e) {
            console.log(e);
            reject(e);
        });
    });
}

function putEpisode(episode, genre, brand) {
    var params = {
        TableName:"ws-partner-download-poc-prog",
        Item:{
          "MasterBrand": episode.master_brand.mid, // partition key
          "pid": episode.pid, // primary sort key
          "Genre": genre, // additional sort key
          "episode": episode,
          "brand": brand
        }
    };
    docClient.put(params, function(err, data) {
        if (err) {
            console.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            console.log("Added item:", JSON.stringify(episode.pid, null, 2));
        }
    });    
}

function processEpisode(episodes, bv_promises, config, episode)
{
    // for each new availability check if it is associated with one of our master brands
    var version = null;
    if(config.master_brands.indexOf(episode.master_brand.mid)>=0) {
        // find out if there is an available version
        var av = episode.available_versions;
        for(var i=0; i<av.version.length; i++) {
            if(av.version[i].types.type!="Podcast") {
	            if(av.version[i].availabilities.availability[0].status == "available") {
                    version = av.version[i];
	            }
            }
        }
    }
    if(version !== null) {
        // if yes, get the brand information
        var brand_pid = null;
        for(var j=0; j<episode.ancestor_titles.length; j++) {
            var at = episode.ancestor_titles[j];
            if(at.ancestor_type == 'brand') {
                brand_pid = at.pid;
            }
        }
        // get the brand record from nitro (to get the brand synopsis mostly)
        bv_promises.push(nitrorequest({pid:brand_pid})); // TODO what if brand_pid is still null?
        episodes.push(episode);
    }
    else {
        console.log("unwanted episode");
    }
}

/*
 * we have the clip data - assume this is for publishing a single subject BBC Minute.
 * The idea is to send a message to Caravan which will then fetch the essence and publish it to CDS and email
*/
function processWantedClip(clip)
{
    processWantedClipToValidQueue(clip, process.env.QUEUE);
    processWantedClipToValidQueue(clip, process.env.TEST_QUEUE);
    var v = clip.available_versions.version[0];
    var media_set = v.availabilities.availability[0].media_sets.media_set;
    var have_mp3 = false;
    var have_aac = false;
    for(var i=0; i<media_set.length; i++) {
        if(media_set[i].name == 'ws-clip-syndication-audio') {
            have_mp3 = true;
        }
        if(media_set[i].name == 'mobile-tablet-main') {
            have_aac = true;
        }
    }
    if(have_mp3) {
        processWantedClipToValidQueue(clip, process.env.LIVE_MP3_QUEUE);
        processWantedClipToValidQueue(clip, process.env.TEST_MP3_QUEUE);
    }
    if(have_aac) {
        processWantedClipToValidQueue(clip, process.env.LIVE_AAC_QUEUE);
        processWantedClipToValidQueue(clip, process.env.TEST_AAC_QUEUE);
    }
}

function processWantedClipToValidQueue(clip, queue)
{
    if(queue.includes("aws")) {
        processWantedClipToQueue(clip, queue);
    }
    else {
        console.log("ignoring queue "+queue);
    }
}

function processWantedClipToQueue(clip, queue)
{
    console.log("sending to "+queue);
    var params = {
      MessageBody: JSON.stringify(clip),
      QueueUrl: queue
    };
    sqs.sendMessage(params, function(err,data){
      if(err) {
        console.log('error:',"Fail Send Message" + err);
      }else{
        console.log('data:',data.MessageId);
      }
    });
}

function fixClip(item) {
    item["clip_of"] = { "pid" : "w13xttlc" };
    item["genre_groupings"] = 
    {
        "genre_group":[
            {"id":"C00079","type":"iplayer_composite",
            "genres":{"genre":[{"id":"100007","type":"iplayer_toplevel","$":"News"}]}
            }
            ]
    };
}

function processIdentifiedClip(item) {
    if(item.available_versions.available > 0) {
        var v = item.available_versions.version[0];
        var status = v.availabilities.availability[0].status;
        console.log("clip "+item.pid+" version "+v.pid+" availability: "+status);
        if(status == "available") {
            console.log("wanted clip");
            processWantedClip(item);
        }
        else {
            console.log("unwanted clip");
        }
    }
}

function processAudioClip(item) {
    console.log("clip");
    if(item.hasOwnProperty("clip_of")) {
        console.log("clip of "+item.clip_of.pid);
        if(process.env.CLIP_BRANDS.includes(item.clip_of.pid)) {
            processIdentifiedClip(item);
        }        
        else {
            console.log("unwanted clip of "+item.clip_of.pid);
        }
    }
    else if(process.env.TITLE.toUpperCase().includes(item.title.trim().toUpperCase())) {
        console.log("clip title match");
        fixClip(item);
        processIdentifiedClip(item);
    }
    else {
        console.log("unwanted clip");
    }
}

function processWantedItem(item)
{
    processWantedItemToValidQueue(item, process.env.QUEUE);
    processWantedItemToValidQueue(item, process.env.TEST_QUEUE);
    var v = item.available_versions.version[0];
    var media_set = v.availabilities.availability[0].media_sets.media_set;
    var have_mp3 = false;
    var have_aac = false;
    for(var i=0; i<media_set.length; i++) {
        if(media_set[i].name == 'ws-clip-syndication-audio') {
            have_mp3 = true;
        }
        if(media_set[i].name == 'mobile-tablet-main') {
            have_aac = true;
        }
    }
    if(have_mp3) {
        processWantedItemToValidQueue(item, process.env.LIVE_MP3_QUEUE);
        processWantedItemToValidQueue(item, process.env.TEST_MP3_QUEUE);
    }
    if(have_aac) {
        processWantedItemToValidQueue(item, process.env.LIVE_AAC_QUEUE);
        processWantedItemToValidQueue(item, process.env.TEST_AAC_QUEUE);
    }
}

function processWantedItemToValidQueue(clip, queue)
{
    if(queue.includes("aws")) {
        processWantedItemToQueue(clip, queue);
    }
    else {
        console.log("ignoring queue "+queue);
    }
}

function processWantedItemToQueue(item, queue)
{
    console.log("sending to "+queue);
    var params = {
      MessageBody: JSON.stringify(item),
      QueueUrl: queue
    };
    sqs.sendMessage(params, function(err,data){
      if(err) {
        console.log('error:',"Fail Send Message" + err);
      }else{
        console.log('data:',data.MessageId);
      }
    });
}

function processIdentifiedEpisode(item) {
    if(item.available_versions.available > 0) {
        var v = item.available_versions.version[0];
        var status = v.availabilities.availability[0].status;
        console.log("episode "+item.pid+" version "+v.pid+" availability: "+status);
        if(status == "available") {
            console.log("wanted episode");
            processWantedItem(item);
        }
        else {
            console.log("unwanted episode");
        }
    }
}

function processAudioEpisode(item) {
    console.log("episode");
    if(item.hasOwnProperty("episode_of")) {
        console.log("episode of "+item.episode_of.pid);
        if(process.env.EPISODE_BRANDS.includes(item.episode_of.pid)) {
            processIdentifiedEpisode(item);
        }        
        else {
            console.log("unwanted episode "+item.clip_of.pid);
        }
    }
    else {
        console.log("unwanted episode");
    }
}

exports.handler = (event, context, callback) => {
    var promises = [];
    // get a promise for the nitro query for every changed pid
    for(var i=0; i<event.Records.length; i++) {
        var ms = event.Records[i].Sns.Message;
        var m = JSON.parse(ms);
        var partner_pid = "s0000001";
        if(m.query_string.hasOwnProperty("partner_pid")) {
            partner_pid = m.query_string.partner_pid;
        }
        if(partner_pid=="s0000001") {
            promises.push(nitrorequest(m.query_string));
        }
    }
    // add a promise for the dynamodb config table
    promises.push(getConfig().then(function(data){
        var config = {};
        for(var i=0; i<data.Count; i++) {
          var item = data.Items[i];
          if(item.key == "master_brands") {
              config["master_brands"] = Object.keys(item.value);
          }
          if(item.key == "genres") {
              config["genres"] = item.value.values;
          }
        }
        return config;
    }));
    // now we have the config data and the nitro data, do what we need to do with it
    Promise.all(promises).then(values => {
        var config = values.pop();
        var bv_promises = [];
        var episodes = [];
        console.log("got "+values.length+" messages");
        for(var i=0; i<values.length; i++) {
            var item = values[i];
            if(item) {
                var item_type = item.item_type;
                if(item_type == "episode") {
                    processAudioEpisode(item);
                }
                else if((item_type == "clip") && (item.media_type == "Audio")) {
                    processAudioClip(item);
                }
            }
        }
        // now all the nitro and PIPS requests have completed
        Promise.all(bv_promises).then(bv => {
            var new_genres = false;
            var genres = config.genres;
            for(var i=0; i<episodes.length; i++) {
                var episode = episodes[i];
                var brand = bv.shift();
                var genre = episode.genre_groupings.genre_group[0].genres.genre[0].$;
                putEpisode(episode, genre, brand);
                if(genres.indexOf(genre)==-1){
                   genres.push(genre);
                   new_genres = true;
                }
            }
            if(new_genres) {
                // put genres back into config table
                putGenres(genres);
            }
        });
    });
    callback(null, "ok");
}
