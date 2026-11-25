/* Fictional district graph. Each sensor controls all roads incident to its station node. */
(function(root){
'use strict';
const xs=[95,235,445,655,795], ys=[75,185,315,445,555];
const stations=[{id:'n11',name:'서온광장',area:'서북 생활권',pin:'A0'},{id:'n31',name:'해온시장',area:'동북 상업권',pin:'A1'},{id:'n13',name:'푸른공원',area:'서남 녹지권',pin:'A2'},{id:'n33',name:'물빛교차로',area:'동남 주거권',pin:'A3'}];
const hubs=[{id:'n00',name:'서북 진입로'},{id:'n40',name:'동북 진입로'},{id:'n22',name:'중앙 대피광장'},{id:'n04',name:'서남 진입로'},{id:'n44',name:'동남 진입로'}];
const nodes={}, edges=[];
for(let y=0;y<5;y++)for(let x=0;x<5;x++){const id=`n${x}${y}`;nodes[id]={id,x:xs[x],y:ys[y]};}
const edgeId=(a,b)=>[a,b].sort().join('-');
function add(a,b){const sensors=stations.flatMap((s,i)=>s.id===a||s.id===b?[i]:[]);edges.push({id:edgeId(a,b),a,b,sensors,length:Math.round(Math.hypot(nodes[a].x-nodes[b].x,nodes[a].y-nodes[b].y)*3)});}
for(let y=0;y<5;y++)for(let x=0;x<5;x++){if(x<4)add(`n${x}${y}`,`n${x+1}${y}`);if(y<4)add(`n${x}${y}`,`n${x}${y+1}`);}
const labels={normal:'정상',caution:'주의',closed:'통제',unknown:'미확인',assumed:'비관측'};
const severity={normal:0,caution:1,unknown:2,closed:3};
function classify(v){return !Number.isInteger(v)||v<0||v>1023?'unknown':v<=400?'closed':v<=700?'caution':'normal';}
function edgeState(edge,states){return edge.sensors.length?edge.sensors.map(i=>states[i]||'unknown').reduce((a,b)=>severity[b]>severity[a]?b:a,'normal'):'assumed';}
// Lexicographic Dijkstra: minimize caution-road length first, then total length.
function findRoute(from,to,states){
 if(!nodes[from]||!nodes[to])return null;
 const dest=stations.findIndex(s=>s.id===to),start=stations.findIndex(s=>s.id===from);
 if([dest,start].some(i=>i>=0&&['closed','unknown'].includes(states[i]||'unknown')))return null;
 const costs={},prev={},remaining=new Set(Object.keys(nodes));costs[from]=[0,0];
 const less=(a,b)=>a[0]<b[0]||a[0]===b[0]&&a[1]<b[1];
 while(remaining.size){let u=null;for(const id of remaining)if(costs[id]&&(!u||less(costs[id],costs[u])))u=id;if(!u)break;remaining.delete(u);if(u===to)break;
  for(const e of edges){const v=e.a===u?e.b:e.b===u?e.a:null;if(!v||!remaining.has(v))continue;const state=edgeState(e,states);if(state==='closed'||state==='unknown')continue;const next=[costs[u][0]+(state==='caution'?e.length:0),costs[u][1]+e.length];if(!costs[v]||less(next,costs[v])){costs[v]=next;prev[v]={u,e};}}
 }
 if(!costs[to])return null;const path=[];for(let u=to;u!==from;){if(!prev[u])return null;path.unshift(prev[u].e);u=prev[u].u;}
 return {path,distance:costs[to][1],cautionDistance:costs[to][0]};
}
const api={classify,edgeState,findRoute,stations,nodes,edges};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(!root.document)return;
const $=id=>document.getElementById(id), svg=$('districtMap');if(!svg)return;
const ns='http://www.w3.org/2000/svg';
function el(tag,attrs={},parent=svg,text){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;parent.append(e);return e;}
function html(tag,parent,text,cls){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;parent.append(e);return e;}
let live={sample:null,fresh:false,source:'Google Sheets 원격 조회'}, demo=false, demoValues=[900,650,900,300], lastKey='';
const roadElements={},stationEls=[],listEls=[];
function line(e,attrs,parent){const a=nodes[e.a],b=nodes[e.b];return el('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,...attrs},parent);}
// Static cartography, original schematic; no external map tiles or services.
el('rect',{width:900,height:630,fill:'#172b32'});
for(let x=0;x<900;x+=30)el('line',{x1:x,y1:0,x2:x,y2:630,stroke:'#20353d','stroke-width':0.6});
for(let y=0;y<630;y+=30)el('line',{x1:0,y1:y,x2:900,y2:y,stroke:'#20353d','stroke-width':0.6});
el('path',{d:'M865 -20 Q830 90 861 165 T858 325 T862 480 T850 650',stroke:'#254b60','stroke-width':57,fill:'none'});
el('path',{d:'M865 -20 Q830 90 861 165 T858 325 T862 480 T850 650',stroke:'#376278','stroke-width':1.2,fill:'none','stroke-dasharray':'5 6'});
el('text',{x:868,y:310,fill:'#7ba6b7','font-size':12,transform:'rotate(90 868 310)','letter-spacing':4},svg,'해 온 천');
const blocks=el('g');
for(let j=0;j<4;j++)for(let i=0;i<4;i++){
 const x=xs[i]+17,y=ys[j]+17,w=xs[i+1]-xs[i]-34,h=ys[j+1]-ys[j]-34;
 const park=(i===0&&j===2)||(i===1&&j===3)||(i===3&&j===0), civic=i===2&&j===2;
 el('rect',{x,y,width:w,height:h,rx:5,fill:park?'#24423e':civic?'#343c43':'#263b43',stroke:'#38515a','stroke-width':0.8},blocks);
 if(park){for(let k=0;k<7;k++){const cx=x+12+((k*37+9)%(w-24)),cy=y+12+((k*23+7)%(h-24));el('circle',{cx,cy,r:4+(k%3),fill:'#436959'},blocks);}el('path',{d:`M${x+7} ${y+h-8} Q${x+w*.5} ${y+h*.35} ${x+w-9} ${y+8}`,stroke:'#678274','stroke-width':2,fill:'none'},blocks);}
 else{const cols=w>130?3:2,rows=2;for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const bw=(w-20)/cols-6,bh=(h-16)/rows-5;el('rect',{x:x+8+c*(bw+6),y:y+7+r*(bh+5),width:bw,height:bh,rx:1,fill:(i+j+r+c)%3===0?'#42545b':'#364b53',stroke:'#52636a','stroke-width':.45},blocks);}}
}
const roadBase=el('g'),roads=el('g');for(const e of edges){line(e,{stroke:'#122127','stroke-width':23,'stroke-linecap':'round'},roadBase);line(e,{stroke:'#53616a','stroke-width':16,'stroke-linecap':'round'},roadBase);line(e,{stroke:'#819098','stroke-width':1,'stroke-dasharray':'4 7',opacity:.5},roadBase);roadElements[e.id]=line(e,{'stroke-width':7,'stroke-linecap':'round',class:'road-state'},roads);}
const routeLayer=el('g',{'pointer-events':'none'});
const captions=el('g',{'pointer-events':'none'});
[['서온로',165,65],['해온대로',445,305],['물빛로',725,545],['북문길',86,240],['남문길',86,485]].forEach(([t,x,y])=>el('text',{x,y,fill:'#a2b4b8','font-size':10,'text-anchor':'middle',class:'map-text'},captions,t));
for(const h of hubs){const n=nodes[h.id];el('circle',{cx:n.x,cy:n.y,r:6,fill:'#d5e5e5',stroke:'#24353c','stroke-width':2},captions);el('text',{x:n.x,y:n.y-13,'text-anchor':'middle',fill:'#c3d5d9','font-size':11,class:'map-text'},captions,h.name);}
for(let i=0;i<stations.length;i++){
 const s=stations[i],n=nodes[s.id],g=el('g',{class:'station-marker',tabindex:'0',role:'button','aria-label':`${s.name} 길찾기`,transform:`translate(${n.x} ${n.y})`});
 const halo=el('circle',{r:30,class:'station-halo'},g);el('circle',{r:17,class:'station-ring'},g);const number=el('text',{'text-anchor':'middle',y:5,'font-size':14,'font-weight':800,fill:'#15232a'},g,String(i+1).padStart(2,'0'));
 el('rect',{x:-69,y:23,width:138,height:43,rx:6,fill:'#14252e',stroke:'#53616a'},g);
 el('text',{x:0,y:39,'text-anchor':'middle','font-size':12,'font-weight':700,fill:'#f3f7f7'},g,s.name);
 const text=el('text',{x:0,y:55,'text-anchor':'middle','font-size':11,class:'marker-value'},g,'미확인 · —');
 g.addEventListener('click',()=>{ $('routeTo').value=s.id;refresh(true); });g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();g.click?.();$('routeTo').value=s.id;refresh(true);}});stationEls.push({g,halo,number,text});
 const btn=html('button',$('stationList'),undefined,'station-item');btn.type='button';btn.onclick=()=>{$('routeTo').value=s.id;refresh(true);};const dot=html('span',btn,undefined,'station-index');dot.textContent=String(i+1).padStart(2,'0');const info=html('span',btn,undefined,'station-info');html('b',info,s.name);html('small',info,`${s.pin} · ${s.area}`);const right=html('span',btn,undefined,'station-right');const value=html('b',right,'—'),state=html('small',right,'미확인');listEls.push({btn,value,state});
}
el('text',{x:24,y:29,fill:'#b1c4c8','font-size':12,'font-weight':700},svg,'N ↑');el('line',{x1:24,y1:603,x2:124,y2:603,stroke:'#c3d5d9','stroke-width':2});el('text',{x:24,y:595,fill:'#b1c4c8','font-size':10},svg,'300 m (가상 축척)');el('text',{x:800,y:605,'text-anchor':'end',fill:'#8ba6ae','font-size':10,'letter-spacing':1},svg,'HAEON / SCHEMATIC MAP');
function addOption(select,n){const opt=html('option',select,n.name);opt.value=n.id;}
[...hubs,...stations].forEach(n=>addOption($('routeFrom'),n));stations.forEach(n=>addOption($('routeTo'),n));$('routeFrom').value='n00';$('routeTo').value='n31';
$('routeFrom').onchange=$('routeTo').onchange=()=>refresh(true);
function statusLine(result,title,body,state){result.className='route-result '+state;result.replaceChildren();html('b',result,title);html('p',result,body);}
function refresh(force=false){
 const current=live.sample, fresh=demo||live.fresh, values=demo?demoValues:current?.v||[null,null,null,null];const states=stations.map((s,i)=>fresh?classify(values[i]):'unknown');
 const feed=$('mapFeed');feed.textContent=demo?'시뮬레이션 · 실제 데이터 아님':fresh?`${live.source} · 수신 중`:live.error?'조회 오류 · 미확인':current?'데이터 지연 · 미확인':'데이터 수신 대기';feed.dataset.state=demo?'warn':fresh?'ok':'warn';
 $('mapTime').textContent=demo?'가상 측정값':current?`마지막 측정 ${new Date(current.t).toLocaleTimeString('ko-KR',{hour12:false})} · ${Math.max(0,Math.floor((Date.now()-current.t)/1000))}초 전`:'마지막 측정 —';
 const from=$('routeFrom').value,to=$('routeTo').value,key=JSON.stringify([demo,states,values,from,to]);if(!force&&key===lastKey)return;lastKey=key;
 edges.forEach(e=>{roadElements[e.id].setAttribute('data-state',edgeState(e,states));});
 stations.forEach((s,i)=>{const st=states[i],v=values[i];const e=stationEls[i],l=listEls[i];e.g.dataset.state=st;e.text.textContent=`${labels[st]} · ${fresh&&Number.isInteger(v)?v:'—'}`;l.btn.dataset.state=st;l.value.textContent=fresh&&Number.isInteger(v)?String(v):'—';l.state.textContent=labels[st];l.btn.classList.toggle('selected',to===s.id);});
 const result=$('routeResult');routeLayer.replaceChildren();const dest=stations.findIndex(s=>s.id===to),start=stations.findIndex(s=>s.id===from);
 if(dest<0||!nodes[from]){statusLine(result,'출발지와 목적지를 선택하세요.','','unknown');return;}
 if([dest,start].some(i=>i>=0&&states[i]==='closed')){statusLine(result,'도로 통제 · 이동 불가','출발지 또는 도착 거점의 연결 도로가 통제되어 경로를 제공하지 않습니다.','closed');return;}
 if([dest,start].some(i=>i>=0&&states[i]==='unknown')){statusLine(result,'도로 상태 미확인','유효한 센서 데이터를 수신할 때까지 해당 거점 경로를 안내하지 않습니다.','unknown');return;}
 const route=findRoute(from,to,states);if(!route){statusLine(result,'이동 가능한 경로 없음','통제 또는 미확인 구간을 제외하면 연결 가능한 도로가 없습니다.','closed');return;}
 if(from===to){statusLine(result,'이미 목적지에 있습니다.',states[dest]==='caution'?'현재 거점은 침수 주의 상태입니다.':'현재 거점의 관측 상태는 정상입니다.',states[dest]);return;}
 for(const e of route.path){line(e,{stroke:'#102229','stroke-width':13,'stroke-linecap':'round'},routeLayer);line(e,{stroke:edgeState(e,states)==='caution'?'#f6b94e':'#69e4ef','stroke-width':7,'stroke-linecap':'round'},routeLayer);}
 const first=nodes[from],last=nodes[to];el('circle',{cx:first.x,cy:first.y,r:9,fill:'#101820',stroke:'#69e4ef','stroke-width':3},routeLayer);el('circle',{cx:last.x,cy:last.y,r:20,fill:'none',stroke:states[dest]==='caution'?'#f6b94e':'#69e4ef','stroke-width':2,'stroke-dasharray':'3 3'},routeLayer);
 const km=(route.distance/1000).toFixed(2),mins=Math.max(1,Math.ceil(route.distance/75));const caution=route.cautionDistance>0;
 statusLine(result,caution?'통행 가능 · 침수 주의':'통제 구간을 피한 경로',`${km} km · 도보 약 ${mins}분 (가상 거리)${caution?` · 주의 도로 ${route.cautionDistance} m 포함`:''}. ${caution?'황색 안내 구간은 위험 가능성이 있습니다.':'비관측 도로는 통행 가능하다고 가정합니다.'}`,caution?'caution':'normal');
}
for(let i=0;i<4;i++){const row=html('label',$('demoSliders'),undefined,'demo-slider');const label=html('span',row,`${stations[i].name} (${stations[i].pin})`);const value=html('output',row,String(demoValues[i]));const input=html('input',row);input.type='range';input.min=0;input.max=1023;input.value=demoValues[i];input.id='demo'+i;input.setAttribute('aria-label',stations[i].name+' 가상 ADC');value.id='demoOut'+i;input.oninput=()=>{demoValues[i]=Number(input.value);value.textContent=input.value;refresh(true);};}
$('demoToggle').onclick=()=>{demo=!demo;$('demoToggle').setAttribute('aria-pressed',String(demo));$('demoToggle').textContent=demo?'실제 데이터로 돌아가기':'시뮬레이션 켜기';$('demoControls').hidden=!demo;refresh(true);};
document.querySelectorAll('[data-demo]').forEach(b=>b.onclick=()=>{demoValues=b.dataset.demo.split(',').map(Number);demoValues.forEach((v,i)=>{$('demo'+i).value=v;$('demoOut'+i).textContent=v;});refresh(true);});
root.FloodMap={...api,update(data){live=data;refresh();}};refresh(true);
})(typeof window!=='undefined'?window:globalThis);
