diff --git a/src/pkjs/index.js b/src/pkjs/index.js
index 3ea3de68ec2a2bcdbc78bb1ceed2f5ddff9de3ac..92369fe84e6f7de4697619cbf50967e6f0192229 100644
--- a/src/pkjs/index.js
+++ b/src/pkjs/index.js
@@ -75,92 +75,116 @@ function detectType(d, num){
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
-  if (!api){ sendKV({ ERROR:'Missing API key' }); return; }
+  console.log('fetchDeparturesFor stop="'+stop+'" limit='+limit);
+  if (!api){
+    console.log('Missing API key');
+    sendKV({ ERROR:'Missing API key' });
+    return;
+  }
 
   var url = 'https://api.golemio.cz/v2/pid/departureboards?limit='+encodeURIComponent(limit)+
             '&minutesAfter=90&names[]='+encodeURIComponent(stop);
+  console.log('Request URL: '+url);
 
   var xhr = new XMLHttpRequest();
   xhr.open('GET', url);
   xhr.setRequestHeader('x-access-token', api);
   xhr.setRequestHeader('accept', 'application/json');
   xhr.timeout = 8000;
 
   xhr.onload = function(){
-    if (xhr.status !== 200){ sendKV({ ERROR:'HTTP '+xhr.status }); return; }
-    var data = {}; try{ data=JSON.parse(xhr.responseText); } catch(e){ sendKV({ ERROR:'Bad JSON' }); return; }
+    console.log('Response status: '+xhr.status);
+    if (xhr.status !== 200){
+      console.log('Non-200 response body: '+xhr.responseText);
+      sendKV({ ERROR:'HTTP '+xhr.status });
+      return;
+    }
+    var data = {};
+    try{
+      data=JSON.parse(xhr.responseText);
+    } catch(e){
+      console.log('Bad JSON', e, xhr.responseText);
+      sendKV({ ERROR:'Bad JSON' });
+      return;
+    }
 
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
-  xhr.onerror   = function(){ sendKV({ ERROR:'Net err' }); };
-  xhr.ontimeout = function(){ sendKV({ ERROR:'Timeout' }); };
+  xhr.onerror   = function(){
+    console.log('Network error while fetching departures');
+    sendKV({ ERROR:'Net err' });
+  };
+  xhr.ontimeout = function(){
+    console.log('Request to Golemio API timed out');
+    sendKV({ ERROR:'Timeout' });
+  };
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
