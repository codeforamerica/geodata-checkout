/*jshint laxcomma:true */

/**
 * Module dependencies.
 */
var express = require('express')
    , mongoose = require('mongoose')
    , routes = require('./routes')
    , middleware = require('./middleware')
    , request = require('request')
    , timepoint = require('./timepoint')
    , customgeo = require('./customgeo')
    ;

var HOUR_IN_MILLISECONDS = 3600000;

var init = exports.init = function (config) {
  
  var db_uri = process.env.MONGOLAB_URI || process.env.MONGODB_URI || config.default_db_uri;

  mongoose.connect(db_uri);

  var app = express.createServer();

  app.configure(function(){
    app.set('views', __dirname + '/views');
    app.set('view engine', 'jade');
    app.set('view options', { pretty: true });

    app.use(express.bodyParser());
    app.use(express.cookieParser());
    app.use(express.methodOverride());
    app.use(express.static(__dirname + '/public'));
    app.use(app.router);

  });

  app.configure('development', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  });

  app.configure('production', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: false}));
  });
  
  // Routes

  app.get('/', function(req, res){
    // show timeline editor (not yet designed)
    res.render('checkouttimemaker');
  });
  
  app.post('/customgeo', function(req, res){
    var shape = new customgeo.CustomGeo({
      latlngs: req.body.pts.split("|")
    });
    shape.save(function (err){
      res.send({ id: shape._id });
    });
  });
  app.get('/timeline', function(req, res){
    // show timeline
    res.render('checkouttime', { customgeo: req.query['customgeo'] });
  });
  app.post('/timeline', function(req, res){
    // load this point into MongoDB
    pt = new timepoint.TimePoint({
      start: req.body['start'],
      end: req.body['end'],
      // use [ lng , lat ] format to be consistent with GeoJSON
      ll: [ req.body['lng'] * 1.0, req.body['lat'] * 1.0 ]
    });
    pt.save(function(err){
      res.send(err || 'success');
    });
  });
  
  var processTimepoints = function(timepoints, req, res){
    if(req.url.indexOf('kml') > -1){
      // time-enabled KML output
      var kmlintro = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://earth.google.com/kml/2.2">\n	<Document>\n		<name>Time-Enabled Code Enforcement KML</name>\n		<description>Rounded locations of code enforcement cases 1997-2012</description>\n		<Style id="dot-icon">\n			<IconStyle>\n					<scale>0.6</scale>\n        <Icon>\n          <href>http://homestatus.herokuapp.com/images/macon-marker-02.png</href>\n        </Icon>\n      </IconStyle>\n    </Style>\n    <Style>\n      <ListStyle>\n        <listItemType>checkHideChildren</listItemType>\n      </ListStyle>\n    </Style>\n';
      var kmlpts = '';
      for(var t=0; t<timepoints.length; t++){
        var latitude = timepoints[t].ll[1];
        var longitude = timepoints[t].ll[0];
        var convertToDate = function(timecode){
          timecode -= 2000;
          year = 1997 + Math.floor( timecode / 12 );
          timecode -= (year - 1997) * 12;
          month = 1 + timecode;
          if(month < 10){
            month = "0" + month;
          }
          return year + "-" + month;
        };
        var startstamp = convertToDate( timepoints[t].start );
        var endstamp = convertToDate( timepoints[t].end );
        kmlpts += '	<Placemark>\n		<TimeSpan>\n';
        kmlpts += '			<begin>' + startstamp + '</begin>\n';
        kmlpts += '			<end>' + endstamp + '</end>\n';
        kmlpts += '		</TimeSpan>\n		<styleUrl>#dot-icon</styleUrl>\n		<Point>\n';
        kmlpts += '			<coordinates>' + longitude + ',' + latitude + '</coordinates>\n';
        kmlpts += '		</Point>\n	</Placemark>\n';
      }
      var kmlout = '  </Document>\n</kml>';
      res.setHeader('Content-Type', 'application/kml');
      res.send(kmlintro + kmlpts + kmlout);
    }
    else{
      // GeoJSON output
      for(var t=0; t<timepoints.length; t++){
        timepoints[t] = {
          "geometry": {
            "coordinates": [ timepoints[t].ll[0], timepoints[t].ll[1] ]
          },
          "properties": {
            "startyr": timepoints[t].start,
            "endyr": timepoints[t].end
          }
        };
      }
      res.send({ "type":"FeatureCollection", "features": timepoints });
    }
  };
  
  app.get('/timeline-at*', function(req, res){
    if(req.query['customgeo'] && req.query['customgeo'] != ""){
      // do a query to return GeoJSON inside a custom polygon
      customgeo.CustomGeo.findById(req.query['customgeo'], function(err, geo){
        if(err){
          res.send(err);
          return;
        }
        var poly = geo.latlngs;
        for(var pt=0;pt<poly.length;pt++){
          poly[pt] = [ poly[pt].split(",")[1] * 1.0, poly[pt].split(",")[0] * 1.0 ];
        }
        //res.send(poly);
        //return;
        timepoint.TimePoint.find({ ll: { "$within": { "$polygon": poly } } }).limit(10000).exec(function(err, timepoints){
          if(err){
            res.send(err);
            return;
          }
          processTimepoints(timepoints, req, res);
        });
      });
    }
    else{
      // do a query to return GeoJSON timeline near a point
      timepoint.TimePoint.find({ ll: { "$nearSphere": [  req.query["lng"] || -83.645782, req.query['lat'] || 32.837026 ], "$maxDistance": 0.01 } }).limit(10000).exec(function(err, timepoints){
        // convert all timepoints into GeoJSON format
        if(err){
          res.send(err);
          return;
        }
        processTimepoints(timepoints, req, res);
      });
    }
  });

  //app.get('/auth', middleware.require_auth_browser, routes.index);
  //app.post('/auth/add_comment',middleware.require_auth_browser, routes.add_comment);
  
  // redirect all non-existent URLs to doesnotexist
  app.get('*', function onNonexistentURL(req,res) {
    res.render('doesnotexist',404);
  });

  return app;
};

// Don't run if require()'d
if (!module.parent) {
  var config = require('./config');
  var app = init(config);
  app.listen(process.env.PORT || 3000);
  console.info("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
}