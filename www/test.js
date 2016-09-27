$(function () { 
  var master_brand = "#";
  var selected = {}; // lang_genre : [array of pids]
  var genre = "#";
  function setsidebar(config) {
    var master_brands, genres;
    for(var i=0; i<config.Count; i++) {
      var item = config.Items[i];
      if(item.key.S == "master_brands") {
          master_brands = item.value.M;
      }
      if(item.key.S == "genres") {
          genres = item.value.SS.sort();
      }
    }
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
  }
  AWS.config.update(secret);
  AWS.config.region = 'eu-west-1';
  var dynamodb = new AWS.DynamoDB();
  dynamodb.scan({TableName: 'ws-partner-download-poc-config'}, function (err, data) {
    if (err) console.log(err, err.stack); // an error occurred
    else setsidebar(data);
  });
$('#sidebar').on("changed.jstree", function (e, data) {
  var grid = $("#content").data("JSGrid");
  var ck = $("#content :checked");
  var s = []
  for(var i=0; i<ck.length; i++) {
    s.push(ck[i].parentElement.parentElement.firstElementChild.textContent);
  }
  selected[master_brand+genre] = s; // old master_brand and genre
  console.log(selected);
  master_brand = data.node.parent;
  genre = data.node.text;
  if((master_brand != "#") && (genre != "#")) {
    grid.loadData();
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
			console.log(data);
			var r = [];
			for(var i=0; i<data.Count; i++) {
			  var prog = data.Items[i];
			  var episode = prog.episode.M;
			  var brand = prog.brand.M;
			  var media = prog.media.M;
			  var title = brand.title.S;
			  var sel = selected[prog.MasterBrand.S+prog.Genre.S];
			  if(sel === undefined) {
			     sel = [];
			  }
			  var pid = episode.pid.S;
		          var ck = sel.indexOf(pid)>=0;
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
				"pid": pid,
				"Image": episode.images.M.image.M.template_url.S, 
				"Brand":brand.title.S, 
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
            { name: "pid", type: "text", width:"1"},//, visible: false },
            { name: "Image", 
              itemTemplate: function(val, item) {
                return $("<img>").attr("src", "https://"+val.replace("$recipe", "480x270")).css({ height: 50 });
              }, 
              type: "text", width: 30, editing:false, validate: "required" },
            { name: "Brand", type: "text", width: 50 },
            { name: "Title", type: "text", width: 50 },
            { name: "Description", type: "text", width: 200 },
            { name: "Download", 
              itemTemplate: function(val, item) {
                return "<input type='checkbox' "+(val?"checked='checked'":"")+" onClick='console.log(this.checked)'/>";
              }, 
		type: "checkbox", width: 20 }
        ]
    });
});
