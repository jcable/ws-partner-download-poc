$(function () {

  var poolData = {
      UserPoolId : 'eu-west-1_5ZgsW5tJQ',
      ClientId : '6vf8hgnljbermv3btl97racemq',
  };
  var region = 'eu-west-1';
  var identityPoolId = region+':3466c124-6320-43dd-b11e-a9b8295c0742';
  var downloadBucket = 'ws-partner-download-poc-ms';
  var signiantServer = 'eu-west-1-am.cloud.signiant.com';
  var signiantKey = '';
  var signiantStorageConfig = {};

  var cart = {}; // lang_genre : [array of objects]
  var master_brand = "#";
  var genre = "#";
  var brand_data = {};

  function setsidebar(master_brands, genres) {
	var children = [];
	for(var j=0; j<genres.length; j++) {
		children.push({ 'text' : genres[j]});
	}
	var data = [];
	var mbs = Object.keys(master_brands).sort();
	for(var i=0; i<mbs.length; i++) {
		var key = mbs[i];
		data.push({ 'id' : key, 'text' : master_brands[key].S, 'children' : children});
	}
	$('#sidebar').jstree({ 'core' : { 'data' : data }});
	$('#sidebar').on("changed.jstree", function (e, data) {
		var grid = $("#content").data("JSGrid");
		master_brand = data.node.parent;
		genre = data.node.text;
		if((master_brand != "#") && (genre != "#")) {
			grid.loadData();
		}
	});
  }

  function main() {

	checkForSigniant();

	var dynamodb = new AWS.DynamoDB();
	dynamodb.scan({TableName: 'ws-partner-download-poc-config'}, function (err, data) {
		if (err) {
			console.log(err, err.stack); // an error occurred
		}
		else {
			var master_brands, genres;
			for(var i=0; i<data.Count; i++) {
				var item = data.Items[i];
				switch(item.key.S) {
				case "master_brands":
					master_brands = item.value.M;
					break;
				case "genres":
					genres = item.value.SS.sort();
					break;
				case "signiant_key":
					signiantKey = item.value.S;
					break;
				case "brands":
					brand_data = item.value.M;
					break;
				}
			}
			setsidebar(master_brands, genres);
		}
	});
	$("#content").jsGrid({
        width: "100%",
        height: "400px",
 
        inserting: false,
        editing: false,
        sorting: true,
        paging: true,
	autoload: true,
        controller: {
            loadData: function() {
                var d = $.Deferred();
                dynamodb.query({
			TableName:"ws-partner-download-poc-prog",
			IndexName:"MasterBrand-Genre-index",
			KeyConditionExpression:"#mb = :mb and #g = :g",
			ExpressionAttributeNames:{ "#mb" : "MasterBrand", "#g":"Genre"},
			ExpressionAttributeValues:{":mb":{S:master_brand}, ":g":{S:genre}}
		  },
		  function(err, data) {
		     if (err) {
			console.error("Unable to query. Error:", JSON.stringify(err, null, 2));
	             } else {
			var r = [];
			for(var i=0; i<data.Count; i++) {
			  var prog = data.Items[i];
			  var episode = prog.episode.M;
			  var brand = prog.brand.M;
			  var media = prog.media.M;
			  var pid = episode.pid.S;
		          var ck = cart.hasOwnProperty(pid);
			  // set Brand column to brand title unless we have a brand override (so there is a column in English)
			  var brand_title = brand.title.S;
		          if(brand_data.hasOwnProperty(brand.pid.S)) {
				var brand_override = brand_data[brand.pid.S].M;
				brand_title = brand_override.title.S;
			  }
			  // set title column to presentation title or episode title or brand title
			  var title = brand_title;
			  if(episode.hasOwnProperty("title")) {
			      title = episode.title.S;
			  }
			  else if(episode.hasOwnProperty("presentation_title")) {
			      title = episode.presentation_title.S;
			  }
			  var synopsis = brand.synopses.M.short.S.trim();
			  if(episode.hasOwnProperty("synopses")) {
			      var esynopsis = episode.synopses.M.short.S.trim();
			      if(esynopsis != synopsis) {
				  synopsis = synopsis + " - " + esynopsis;
			      }
			  }
			  r.push({
				"object": prog,
				"pid": pid,
				"Image": episode.images.M.image.M.template_url.S, 
				"Brand":brand_title, 
				"Title":title, 
				"Description":synopsis,
				"Download": ck
				});
			}
		        d.resolve(r);
		     }
                  });
                return d.promise();
              }
        },
 
        fields: [
            { name: "Image", 
              itemTemplate: function(val, item) {
                return $("<img>").attr("src", "https://"+val.replace("$recipe", "480x270")).css({ height: 50 })
			.wrap("<a href='http://bbc.co.uk/programmes/"+item.pid+"'></a>");
              }, 
              type: "text", width: 30 },
            { name: "Brand", type: "text", width: 50 },
            { name: "Title", type: "text", width: 50 },
            { name: "Description", type: "text", width: 200 },
            { name: "Download", 
              itemTemplate: function(val, item) {
		var at = {
			type: "checkbox",
			id: item.pid
			};
		if(val) {
		  at['checked'] = 'checked';
		}
		var ip = $("<input>").attr(at).data("prog", item.object);
                ip.on("click", function (event) {
		  if(this.checked) {
		    cart[this.id] = $(this).data("prog");
		  }
		  else {
		    delete cart[this.id];
		  }
                });
		return ip;
              }, 
		type: "checkbox", width: 20 }
        ]
	});
	$("#header").html("Files available in the selected language/genre will appear here");
	var footer = $("#footer");
	footer.append($("<input type='radio' checked='checked' name='fmt' value='wav'>wav</input>"));
	footer.append($("<input type='radio' name='fmt' value='low'>MP3 high</input>"));
	footer.append($("<input type='radio' name='fmt' value='high'>MP3 low</input>"));
	var db = $("<button>Start Download</button>");
	db.attr("type", "button");
	db.on("click", function (event) {
		var fmt = $("input[name=fmt]:checked").val();
		var k = Object.keys(cart);
		var assets = [];
		for(var i=0; i<k.length; i++) {
			var prog = cart[k[i]];
			var versions = prog.episode.M.available_versions.M.version.L;
			for(var j=0; j<versions.length; j++) {
				var version = versions[j].M;
				var pid = version.pid.S;
				var av = version.availabilities.M.availability.L;
				var type = version.types.M.type.L[0].S;
				//console.log(pid+" "+type);
				//console.log(av);
			}
			var filename = "";
			var media = prog.media.L;
			for(var l=0; l<media.length; l++) {
				var mi = media[l].M;
				if(mi.map_id.S == "piff_abr_low_audio") {
					filename = mi.map_id.S+"/"+mi.filename.S.split("/")[0];
				}
			}
			assets.push(filename);
		}
		console.log(assets);
		var apigClient = apigClientFactory.newClient();
		console.log(apigClient);
		apigClient.wsPartnerDownloadPocSigcredGet({}, {}, null)
    			.then(function(result){
				console.log(result);
				downloadFiles(
					['wudc.mp3'], 
					result.api_key,
					{
						configId : result.config_id,
						signature : result.token,
						bucket : downloadBucket
					},
					signiantServer 
				);
    			}).catch( function(result){
				console.log(result);
    		});
	});
	footer.append(db);
  }
// checking a file checks if we already know the download url and if not invokes a restful call to discover it, storing the promise in the cart entry
// restful call invokes a lambda function which if the content is available returns the bucket addresses
// or if AF is lazy it returns a query id and an expected completion datetime.
// clicking the download button invokes Promise.all on the cart. At this point we can start the download of files that exist and
// give the user an indication of what files are still copying/transcoding.
// then we can re-invoke the call(s) with query id and wait for completion
// we can invoke a separate signiant download for the remaining files (unless signiant allows adding files during a download)
// We thought about:
//     AF gives us the .wav file for everything
//     all other files are encoded on demand, either by invoking an AF function or by using AWS elastic transcode.
  function setup(session) {
  	    var upId = poolData.UserPoolId;
	    var upRegion = upId.split('_')[0];
	    var logins = {};
	    logins['cognito-idp.'+upRegion+'.amazonaws.com/'+upId] = session.getIdToken().getJwtToken();
  	    AWS.config.region = region;
	    AWS.config.credentials = new AWS.CognitoIdentityCredentials({
		  IdentityPoolId: identityPoolId,
		  Logins: logins
	    });
  	    AWS.config.credentials.get(function(){
		main();
  	    });
  }

  function login2(authenticationData) {
    var authenticationDetails = new AWSCognito.CognitoIdentityServiceProvider.AuthenticationDetails(authenticationData);
    var userPool = new AWSCognito.CognitoIdentityServiceProvider.CognitoUserPool(poolData);
    var userData = {
        Username : authenticationData.Username,
        Pool : userPool
    };
    var cognitoUser = new AWSCognito.CognitoIdentityServiceProvider.CognitoUser(userData);
    cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: function (result) {
            console.log('logged in ok');
  	    setup(result);
        },

        onFailure: function(err) {
            console.log(err);
        }
    });
  }

  function login() {
    var userName = prompt('User Name','');
    var password = prompt('password','');
    login2({ Username : userName, Password : password });
  }
  function logout() {
	alert("not done");
  }

  var userPool = new AWSCognito.CognitoIdentityServiceProvider.CognitoUserPool(poolData);
  var cognitoUser = userPool.getCurrentUser();

  if (cognitoUser == null) {
    $("<input type='button' value='Click to log in'/>").on("click", login).appendTo("#login");
  }
  else {
	if(false) { // might need this if session expired - also might need to use a refresh token in that case.
	    var userName = cognitoUser.getUsername();
	    var password = prompt('password','');
	    login2({ Username : userName, Password : password });
	}
	else {
    		$("<input/>").attr({type:'button', value:'log out from '+cognitoUser.getUsername()}).on("click", logout).appendTo("#login");
		cognitoUser.getSession(function(err, session){
			setup(session);
		});
	}
  }
        
    function checkForSigniant() {
	console.log("Check for Signiant App");
	Signiant.Mst.configure({
            networkConnectivityErrorCallback: function(){
		console.log("Network Connectivity Loss Detected");
		alert("Network Loss Detected, Waiting for Restore");
		},
            appCommunicationErrorCallback: function(){
		  console.log("Connection to Signiant App Lost");
		  alert("Your connection has been lost. Press launch application on the next dialog.")
		  reInitializeApp();
		},
            networkConnectivityRestoredCallback: function(){
		  console.log("Network Connectivity Restored");
		  alert("Network Connectivity Restored");
		}
	});
          
	detectPlugin({
		success:function(){
			console.log("Signiant plugin available");
		},
		error:function(){
			alert("Signiant App Failed to load.");
		}
	});
          
    }
      
     /* Timeout is time to wait for app to respond to new session request.
      * We suggest 20 seconds, but you may want to lower this.
      * If the timer completes and no message is received, reInitializeFailure will fire 
      */
    function reInitializeApp() {
	  console.log("Attempt Re Initialize Connection to Signiant");
          Signiant.Mst.initialize(
		function () {
		  console.log("Connection to Signiant App Re-established");
		  alert("Connection to Signiant App Re-established");
		},
		function () {
		  console.log("Re-Initialize Signiant App Failed, retrying");
		  alert("Signiant App Connection Lost, Retrying...");
		  reInitializeApp();
		},		
          	{ "timeout" : 20000 }
	);
    }

    function downloadFiles(fileNames, apiKey, storageConfig, defaultServer) {
          //create a new download Object
          var download = new Signiant.Mst.Download();
          //set the download server
          download.setServer(defaultServer);
          //set the apikey for downloading
          download.setApiKey(apiKey); //required
          //set the storage configuration
          download.setStorageConfig(JSON.stringify(storageConfig));
          //set the probeLB (probe load balancer) to true (always true for Flight).
          download.setProbeLB(true);
          download.setFilePathHandlingMode(Signiant.Mst.Transfer.filePathModePath);
          download.setFileCollisionHandlingMode(Signiant.Mst.Transfer.fileCollisionModeVersion);
          //set the files to download to the file that is passed
          download.setFilesToDownload(fileNames);
          download.subscribeForTransferErrors(
        	function (transferObject, eventCode, eventMsg, propertyName){
			  console.log("Sample Upload Transfer Error " + eventCode + ", " + eventMsg);
		}
	  );
	  download.subscribeForBasicEvents(
		function ( transferObject, eventCode, eventMsg, eventData ) {
		  console.log("Download Transfer Event " + eventCode + ", " + eventMsg);
		  var message = eventMsg;			
		  switch(eventCode) {
		    case "TRANSFER_STARTED":
		    break;

		    case "TRANSFER_CANCEL_EVENT":
		    case "TRANSFER_COMPLETED":
		    case "TRANSFER_ERROR_EVENT":
		      transferObject.clearAllFiles();
		    break;

		    default:
		      return
		  }
		}
	  );
          download.subscribeForTransferProgress(
		function (transferObject, numBytesSent, numBytesTotal, estimatedTimeRemaining) {
		  var percent = Math.round((numBytesSent/numBytesTotal)*100);
		  $("#progress").html(percent+"% completed.<p>Completes in about "+moment.duration(estimatedTimeRemaining*1000).humanize()+"</p>");
		}
	  );

          //open the file picker so the user selects where to save the file.
          download.chooseDownloadFolder(
		function(message, folder) {
		    //set the download folder to what they set
		    download.setDownloadFolder(folder);
		    //double check that we actually set the files 
		    selectedFiles = download.getFiles(); 
		    if (selectedFiles.length == 0)
		      alert("No files Selected for Download");
		    else{
		      //do the download
		      download.startDownload();
		    }
		}
	  );
    }
});
