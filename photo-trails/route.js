(function(root){
const validGPS=(lat,lon)=>typeof lat==='number'&&typeof lon==='number'&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
function ordered(stops,sort='time'){return [...stops].sort((a,b)=>sort==='input'?a.index-b.index:((Number.isFinite(a.time)?a.time:Infinity)-(Number.isFinite(b.time)?b.time:Infinity)||a.index-b.index));}
function sortStops(stops,sort){const s=ordered(stops,sort);if(sort==='reverse')s.reverse();return s;}
function distance(stops){let km=0;for(let i=1;i<stops.length;i++){const a=stops[i-1],b=stops[i],r=Math.PI/180;const q=Math.sin((b.lat-a.lat)*r/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;km+=6371*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));}return km;}
function maps(stops,mode='walking'){const links=[];const xy=p=>`${p.lat},${p.lon}`;if(stops.length===1)return ['https://www.google.com/maps/search/?'+new URLSearchParams({api:'1',query:xy(stops[0])})];for(let i=0;i<stops.length-1;i+=4){const part=stops.slice(i,i+5);const params=new URLSearchParams({api:'1',origin:xy(part[0]),destination:xy(part[part.length-1]),travelmode:mode});if(part.length>2)params.set('waypoints',part.slice(1,-1).map(xy).join('|'));links.push('https://www.google.com/maps/dir/?'+params);}return links;}
const esc=x=>String(x).replace(/[<>&'\"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
function gpx(stops){return '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Photo Trails" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Photo trail</name><trkseg>'+stops.map(p=>`<trkpt lat="${p.lat}" lon="${p.lon}"><name>${esc(p.name)}</name></trkpt>`).join('')+'</trkseg></trk></gpx>';}
const api={validGPS,sortStops,distance,maps,gpx};if(typeof module!=='undefined')module.exports=api;else root.Trail=api;
})(typeof window!=='undefined'?window:this);
