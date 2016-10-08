'use strict';

var https = require('https');

exports.media_asset_prefix = function(version, map_id, secrets) {
    return exports.media_assets(version, secrets).then(
	function(data){
		for(var i=0; i<data.length; i++){
			if(data[i].map_id == map_id) {
				return Promise.resolve(data[i].filename.split('/')[0]);
			}
		}
		return Promise.reject('missing');
	}, function(reason) {
		return Promise.reject(reason);
	});
}

exports.media_assets = function(version, secrets) {
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
