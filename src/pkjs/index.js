var Clay = require('pebble-clay');
var clayConfig = require('./config');
// vypneme auto-odesílání Clay; posíláme manuálně přes sendKV
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });

// Mapování message keys -> čísla (generuje bundler)
var MSG = {}; try { MSG = require('message_keys'); } catch(e) { MSG = {}; }

// Bezpečné odeslání: převede string klíče na číselné ID (žádné 'NaN')
function sendKV(obj, cb) {
  var out = {};
  Object.keys(obj).forEach(function(k){
    var id = (MSG && typeof MSG[k] === 'number') ? MSG[k] : k;
    if (!(typeof id === 'number' && isNaN(id))) out[id] = obj[k];
  });
  Pebble.sendAppMessage(out, function(){ if(cb)cb(); }, function(){ if(cb)cb(); });
}

var DEFAULT_LIMIT = 5;
var DEFAULT_STOPS = ['Sídliště Lhotka'];

function get(k, d){ try{ var v=localStorage.getItem(k); return (v===null||v==='')?d:v; }catch(e){ return d; } }
function set(k,v){ try{ localStorage.setItem(k, String(v)); }catch(e){} }

function asciiSafe(s){
  var m={'á':'a','č':'c','ď':'d','é':'e','ě':'e','í':'i','ň':'n','ó':'o','ř':'r','š':'s','ť':'t','ú':'u','ů':'u','ý':'y','ž':'z',
         'Á':'A','Č':'C','Ď':'D','É':'E','Ě':'E','Í':'I','Ň':'N','Ó':'O','Ř':'R','Š':'S','Ť':'T','Ú':'U','Ů':'U','Ý':'Y','Ž':'Z'};
  return (s||'').replace(/[ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽáčďéěíňóřšťúůýž]/g,function(ch){return m[ch]||ch;});
}
function two(n){ return (n<10?'0':'')+n; }

function parseStops(str){
  var s = (str||'').replace(/\r/g,'');
  var arr = s.split(/[,\n;|]+/).map(function(x){ return x.trim(); }).filter(Boolean);
  return arr.length ? arr : DEFAULT_STOPS.slice(0);
}
function getStops(){ return parseStops(get('STOPS','')); }
function getIndex(){ var i=parseInt(get('STOP_IDX','0'),10); return isNaN(i)?0:i; }
function setIndex(i){ set('STOP_IDX', i); }
function currentStop(idx){
  var stops = getStops(); if (!stops.length) stops = DEFAULT_STOPS;
  if (typeof idx!=='number') idx = getIndex();
  var n = ((idx%stops.length)+stops.length)%stops.length;
  setIndex(n);
  return stops[n];
}
function fontSmallInt(){
  var v = get('FONT_SMALL','0');
  if (v === 'true') return 1;
  if (v === 'false') return 0;
  var n = parseInt(v,10); return isNaN(n)?0:(n?1:0);
}

// ---- typ linky → prefix ----
function detectType(d, num){
  var sType = null, nType = null;
  if (d){
    if (d.route){
      var rt = d.route.type; if (typeof rt === 'string') sType = rt; if (typeof rt === 'number') nType = rt;
      if (d.route.route_type != null) nType = d.route.route_type;
      if (d.route.transport_mode) sType = d.route.transport_mode;
      if (d.route.vehicle_type)   sType = d.route.vehicle_type;
      if (d.route.mode)           sType = d.route.mode;
      if (d.route.type_id != null) nType = d.route.type_id;
      if (d.route.gtfs && typeof d.route.gtfs.type === 'number') nType = d.route.gtfs.type;
    }
    if (typeof d.route_type === 'number') nType = d.route_type;
    if (typeof d.type === 'string')       sType = d.type;
    if (d.trip){ if (typeof d.trip.route_type==='number') nType=d.trip.route_type; if (typeof d.trip.type==='string') sType=d.trip.type; }
    if (d.vehicle && d.vehicle.type) sType = d.vehicle.type;
  }
  if (sType){ var s=String(sType).toLowerCase();
    if (~s.indexOf('tram')) return 'tram';
    if (~s.indexOf('subway') || ~s.indexOf('metro')) return 'metro';
    if (~s.indexOf('rail') || ~s.indexOf('train'))   return 'rail';
    if (~s.indexOf('trolley')) return 'trolleybus';
    if (~s.indexOf('ferry'))   return 'přívoz';
    if (~s.indexOf('bus'))     return 'bus';
  }
  if (typeof nType==='number'){
    if (nType===0) return 'tram';
    if (nType===1) return 'metro';
    if (nType===2) return 'rail';
    if (nType===3) return 'bus';
    if (nType===4) return 'přívoz';
    if (nType===11) return 'trolleybus';
  }
  if (typeof num==='string'){
    if (/^[ABC]$/.test(num)) return 'metro';
    if (/^\d{1,2}$/.test(num)) return 'tram';
  }
  return null;
}
function typePrefix(t){ if (!t || t==='bus') return ''; var map={tram:'tram',metro:'metro',rail:'vlak',trolleybus:'trolleybus','přívoz':'přívoz'}; return map[t]||t; }

// ---- network ----
function fetchDeparturesFor(stop){
  var api   = get('API_KEY','');
  var limit = parseInt(get('LIMIT', DEFAULT_LIMIT),10)||DEFAULT_LIMIT;
  if (!api){ sendKV({ ERROR:'Missing API key' }); return; }

  var url = 'https://api.golemio.cz/v2/pid/departureboards?limit='+encodeURIComponent(limit)+
            '&minutesAfter=90&names[]='+encodeURIComponent(stop);

  var xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.setRequestHeader('x-access-token', api);
  xhr.setRequestHeader('accept', 'application/json');
  xhr.timeout = 8000;

  xhr.onload = function(){
    if (xhr.status !== 200){ sendKV({ ERROR:'HTTP '+xhr.status }); return; }
    var data = {}; try{ data=JSON.parse(xhr.responseText); } catch(e){ sendKV({ ERROR:'Bad JSON' }); return; }

    var deps = data.departures || [];
    // pošli font preferenci a hlavičku + počet
    sendKV({ FONT_SMALL: fontSmallInt() });
    sendKV({ STOP_LABEL: asciiSafe(stop) });
    sendKV({ COUNT: Math.min(deps.length, limit) });

    var i=0; (function next(){
      if (i >= deps.length || i >= limit) return;
      var d = deps[i++];
      var num  = (d.route && (d.route.short_name || d.route.name)) || d.route_id || '';
      var head = (d.trip && d.trip.headsign) || d.headsign || '';
      var ts = d.departure_timestamp && (d.departure_timestamp.predicted || d.departure_timestamp.estimated ||
                 d.departure_timestamp.scheduled || d.departure_timestamp.actual || d.departure_timestamp.planned);

      var hhmm = ''; if (ts){ var t=new Date(ts); if (!isNaN(t.getTime())) hhmm = two(t.getHours())+':'+two(t.getMinutes()); }
      var mins = ''; if (ts){ var diff=Math.round((new Date(ts).getTime()-Date.now())/60000); if (!isNaN(diff)) mins=' ('+diff+'m)'; }

      var typ = detectType(d, String(num));
      var pref = typePrefix(typ);
      var label = (pref ? (pref + (num?(' '+num):'')) : (num||''));
      var line = label + (head?(' '+asciiSafe(head)):'') + (hhmm?(' '+hhmm):'') + mins;

      sendKV({ INDEX: i-1, LINE: line }, next);
    })();
  };
  xhr.onerror   = function(){ sendKV({ ERROR:'Net err' }); };
  xhr.ontimeout = function(){ sendKV({ ERROR:'Timeout' }); };
  xhr.send();
}

// ---- settings flow ----
function parseResponse(resp){
  try { var d = clay.getSettings(resp); if (d && typeof d==='object') return d; } catch(e){}
  var dec = resp; try { dec = decodeURIComponent(resp); } catch(e){}
  if (dec && dec[0]==='{'){
    try { var j=JSON.parse(dec); if (j && typeof j==='object') return j; } catch(e){}
  }
  var h=resp.indexOf('#'); var q=h>=0?resp.slice(h+1):resp; var out={};
  if (q) q.split('&').forEach(function(p){
    var a=p.split('=');
    var k=decodeURIComponent(a[0]||'');
    var v=decodeURIComponent((a[1]||'').replace(/\+/g,' '));
    if(k) out[k]=v;
  });
  return out;
}
function pick(src, name){
  if (src.hasOwnProperty(name)) return src[name];
  var lower = name.toLowerCase(); if (src.hasOwnProperty(lower)) return src[lower];
  var keyNum = MSG && typeof MSG[name] === 'number' ? String(MSG[name]) : null;
  if (keyNum && src.hasOwnProperty(keyNum)) return src[keyNum];
  return undefined;
}

Pebble.addEventListener('showConfiguration', function(){ Pebble.openURL(clay.generateUrl()); });

Pebble.addEventListener('webviewclosed', function(e){
  if (!e || !e.response) return;
  var dict = parseResponse(e.response) || {};

  var stops = pick(dict,'STOPS'); if (stops !== undefined) set('STOPS', stops);
  var api   = pick(dict,'API_KEY'); if (api   !== undefined) set('API_KEY', api);
  var limit = pick(dict,'LIMIT');   if (limit !== undefined) set('LIMIT', limit);
  var font  = pick(dict,'FONT_SMALL'); if (font !== undefined) set('FONT_SMALL', font);

  setIndex(0); // po uložení začni od první zastávky
  sendKV({ FONT_SMALL: fontSmallInt() });
  sendKV({ REQUEST: 1, STOP_INDEX: 0 });
});

// Watch → PKJS
Pebble.addEventListener('appmessage', function(e){
  if (!e || !e.payload) return;
  if (e.payload.REQUEST){
    var idx = (typeof e.payload.STOP_INDEX !== 'undefined') ? e.payload.STOP_INDEX : getIndex();
    setIndex(idx);
    fetchDeparturesFor(currentStop(idx));
  }
});

// Auto-fetch po startu (po krátké prodlevě, aby byl bridge ready)
Pebble.addEventListener('ready', function(){
  if (!get('LIMIT')) set('LIMIT', DEFAULT_LIMIT);
  if (!get('STOPS')) set('STOPS', DEFAULT_STOPS.join(', '));
  setTimeout(function(){
    sendKV({ FONT_SMALL: fontSmallInt() });
    sendKV({ REQUEST: 1, STOP_INDEX: getIndex() });
  }, 200);
});
