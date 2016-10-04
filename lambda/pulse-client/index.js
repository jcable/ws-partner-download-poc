'use strict';
var http = require('http');
var https = require('https');
var AWS = require("aws-sdk");
var secrets = require("secret");

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

function pipsrequest(version) {
    var options = {
        key:   secrets.key,  // Secret client key
        cert:  secrets.cert,  // Public client key
        rejectUnauthorized: false, // Used for self signed server
        host: "api.live.bbc.co.uk",
        path: "/pips/api/v1/version/pid."+version+"/media_assets/?format=json"
    };
    return new Promise(function(resolve,reject){
        https.get(options, function(res) {
            var data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
                var ma = JSON.parse(data);
                var r = [];
                for(var i=0; i<ma[0].length; i++) {
                    if(ma[0][i][0]=="media_asset") {
                        var a = ma[0][i];
                        var m = {};
                        for(var j=2; j<a.length; j++) {
                            if(a[j][0] == "media_asset_profile") { var map = a[j][1]; m["map_id"] = map.map_id; }
                            if(a[j][0] == "filename") { m["filename"] = a[j][2]; }
                        }
                        r.push(m);
                    }
                }
                resolve(r);
            });
        }).on('error', function(e) {
            reject(e);
        });
    });
}

function nitrorequest(params) {
    var qs = "pid="+params.pid;
    if(params.hasOwnProperty("pulse_reference")) {
        qs += "&pulse_reference="+params.pulse_reference // TODO - use the pulse reference
    }
    var options = {
        host: "nitro.api.bbci.co.uk",
        path: "/nitro/api/programmes?api_key="+secrets.api_key+"&mixin=available_versions&mixin=images&mixin=ancestor_titles&mixin=genre_groupings&"+qs,
        headers: {
            accept: 'application/json'
        }
    };
    return new Promise(function(resolve,reject){
        http.get(options, function(res) {
            var data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
                resolve(JSON.parse(data).nitro.results.items[0]);
            });
        }).on('error', function(e) {
            reject(e);
        });
    });
}

function putEpisode(episode, genre, brand, media) {
    var params = {
        TableName:"ws-partner-download-poc-prog",
        Item:{
          "MasterBrand": episode.master_brand.mid, // partition key
          "pid": episode.pid, // primary sort key
          "Genre": genre, // additional sort key
          "episode": episode,
          "brand": brand,
          "media": media
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

exports.handler = (event, context, callback) => {
    var promises = [];
    // get a promise for the nitro query for every changed pid
    for(var i=0; i<event.Records.length; i++) {
        var ms = event.Records[i].Sns.Message;
        var m = JSON.parse(ms);
        if(m.type == 'episode') {
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
            var episode = values[i];
            // for each new availability check if it is associated with one of our master brands
	    var version = null;
            if(config.master_brands.indexOf(episode.master_brand.mid)>=0) {
		// find out if there is an available version
                var av = episode.available_versions;
                for(i=0; i<av.version.length; i++) {
                    if(av.version[i].types.type!="Podcast") {
			if(av.version[i].availabilities.availability[0].status == "available") {
                            version = av.version[i];
			}
                    }
                }
	    }
	    if(version != null) {
                // if yes, get the brand and media information
                var brand_pid = null;
                for(var j=0; j<episode.ancestor_titles.length; j++) {
                    var at = episode.ancestor_titles[j];
                    if(at.ancestor_type == 'brand') {
                        brand_pid = at.pid;
                    }
                }
                // get the brand record from nitro (to get the brand synopsis mostly)
                bv_promises.push(nitrorequest({pid:brand_pid})); // TODO what if brand_pid is still null?
                var version_pid = null;
                // get the media assets from PIPS (to get the filenames)
                bv_promises.push(pipsrequest(version.pid));
                episodes.push(episode);
            }
            else {
                console.log("unwanted");
            }
        }
        // now all the nitro and PIPS requests have completed
        Promise.all(bv_promises).then(bv => {
            var new_genres = false;
            var genres = config.genres;
            for(var i=0; i<episodes.length; i++) {
                var episode = episodes[i];
                var brand = bv.shift();
                var media = bv.shift();
                var genre = episode.genre_groupings.genre_group[0].genres.genre[0].$;
                putEpisode(episode, genre, brand, media);
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
