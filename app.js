'use strict';
const $ = id => document.getElementById(id);
const cfg = window.WATER_CONFIG || {};
const UPLOAD = Math.max(5000, Number(cfg.uploadMs) || 10000);
const POLL = Math.max(5000, Number(cfg.pollMs) || 10000);
const BAUD = Number(cfg.baudRate) || 9600;
const LIMIT = 120;
let mode = 'viewer', endpoint = '', port = null, reader = null, reading = false, connecting = false, closing = false;
let latest = null, local = [], remote = [], lastLocalChart = 0, lastPaint = 0;
let cloudBusy = false, uploadBusy = false, pending = null, lastAck = null, lastCloudOk = 0, cloudError = '', generation = 0;
let message = '설정 후 연결할 수 있습니다.';
const colors = ['#5cdbed','#ffbe70','#b8a6ff'];
const formatter = new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
function clock(t){return formatter.format(new Date(t));}
function validValues(v){return Array.isArray(v) && v.length===3 && v.every(n=>Number.isInteger(n)&&n>=0&&n<=1023);}
function parseLine(line){
  // 기존 Sensor1:123\tSensor2:456\tSensor3:789 및 CSV 지원
  const match = line.trim().match(/^Sensor1:\s*(\d+)\s+Sensor2:\s*(\d+)\s+Sensor3:\s*(\d+)$/i) || line.trim().match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
  if(!match) return null;
  const v=match.slice(1).map(Number);return validValues(v)?v:null;
}
function normalizeUrl(raw){const u=new URL(raw.trim());if(u.origin!=='https://script.google.com'||!/^\/macros\/s\/[\w-]+\/exec$/.test(u.pathname)||u.search||u.hash)throw Error('Apps Script의 https://script.google.com/macros/s/…/exec 주소를 입력하세요.');return u.href;}
function showMessage(t){message=t;$('message').textContent=t;}
function status(t,state){$('status').textContent=t;$('status').dataset.state=state||'';}
function setMode(next){
  if(mode===next)return;
  if((reading||connecting||closing||uploadBusy)&&next==='viewer'){showMessage('먼저 Arduino 연결을 해제하고 진행 중인 전송을 완료해 주세요.');return;}
  mode=next;$('viewerMode').setAttribute('aria-pressed',String(next==='viewer'));$('collectorMode').setAttribute('aria-pressed',String(next==='collector'));
  $('collectorControls').hidden=next!=='collector';$('modeHint').textContent=next==='collector'?'USB로 측정하고 최신 값을 Google Sheets에 저장합니다.':'Google Sheets에서 최신 측정값을 읽습니다.';
  $('chartHint').textContent=next==='collector'?'로컬 1초 간격 · 최근 최대 120건':'클라우드 저장 데이터 · 최근 최대 120건';
  if(next==='viewer')$('token').value='';
  render();if(next==='viewer')poll();
}
function applyEndpoint(){
  if(reading||connecting||closing||uploadBusy){showMessage('Arduino 연결을 해제한 후 URL을 변경해 주세요.');return;}
  try{endpoint=normalizeUrl($('endpoint').value);generation++;remote=[];pending=null;lastAck=null;lastCloudOk=0;cloudError='';try{localStorage.setItem('water.endpoint',endpoint);}catch{}showMessage('Google 웹 앱에 연결 중…');render();poll();}catch(e){showMessage(e.message);}
}
// Apps Script ContentService의 읽기 전용 JSONP. 공개 센서 값만 조회합니다.
function jsonp(url){return new Promise((resolve,reject)=>{
  const cb='waterCb_'+crypto.randomUUID().replaceAll('-','');const el=document.createElement('script');const u=new URL(url);u.searchParams.set('callback',cb);u.searchParams.set('_',String(Date.now()));
  let finished=false;const timer=setTimeout(()=>finish(Error('Google 조회 시간 초과')),12000);
  function finish(err,data){if(finished)return;finished=true;clearTimeout(timer);el.remove();delete window[cb];err?reject(err):resolve(data);}
  window[cb]=data=>finish(null,data);el.onerror=()=>finish(Error('Google 웹 앱 조회 실패 (배포 권한/URL 확인)'));el.src=u.href;document.head.append(el);
});}
function ingestCloud(data){if(!data||data.ok!==true||!Array.isArray(data.rows))throw Error(data?.error||'Google 응답 형식 오류');remote=data.rows.filter(r=>r&&typeof r.id==='string'&&Number.isFinite(r.t)&&validValues(r.v)).slice(-LIMIT);lastCloudOk=Date.now();cloudError='';}
async function poll(){if(!endpoint||cloudBusy||uploadBusy)return;cloudBusy=true;const g=generation;try{const data=await jsonp(endpoint);if(g===generation){ingestCloud(data);if(!reading)showMessage(mode==='viewer'?'Google Sheets 조회 중 · 자동 갱신':'Google 연결 완료 · Arduino 연결 가능');}}catch(e){if(g===generation){cloudError=e.message;if(!reading)showMessage(e.message);}}finally{cloudBusy=false;render();}}
async function connect(){
  if(reading||connecting||closing)return;
  if(!navigator.serial){showMessage('Web Serial 미지원: USB 연결 PC에서 Chrome 또는 Edge의 HTTPS 페이지를 사용하세요.');return;}
  if(!endpoint||!$('token').value.trim()){showMessage('Google 웹 앱 URL을 연결하고 송신용 비밀키를 입력하세요.');return;}
  connecting=true;$('connect').disabled=true;
  try{port=await navigator.serial.requestPort();await port.open({baudRate:BAUD});reading=true;connecting=false;latest=null;local=[];lastLocalChart=0;lastPaint=0;$('disconnect').disabled=false;$('token').disabled=true;$('applyEndpoint').disabled=true;$('endpoint').disabled=true;showMessage('Arduino 연결됨 · 첫 데이터 수신 대기');render();void readSerial();}
  catch(e){connecting=false;if(port){try{await port.close();}catch{}port=null;}$('connect').disabled=false;showMessage('Arduino 연결 실패: '+e.message);render();}
}
async function readSerial(){
  const decoder=new TextDecoder();let buffer='';
  try{reader=port.readable.getReader();while(reading){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const v=parseLine(line);if(v){const t=Date.now();latest={t,v};if(t-lastLocalChart>=1000){local.push(latest);if(local.length>LIMIT)local.shift();lastLocalChart=t;}if(t-lastPaint>=100){lastPaint=t;render();}}}if(buffer.length>4096)buffer='';}}
  catch(e){if(reading)showMessage('시리얼 수신 오류: '+e.message);}
  finally{reading=false;closing=true;try{reader?.releaseLock();}catch{}reader=null;try{await port?.close();}catch{}port=null;closing=false;$('connect').disabled=false;$('disconnect').disabled=true;$('token').disabled=false;$('applyEndpoint').disabled=false;$('endpoint').disabled=false;render();}
}
async function disconnect(){if(!reading)return;reading=false;closing=true;$('disconnect').disabled=true;try{await reader?.cancel();}catch{}showMessage('Arduino 연결 해제 · 새 데이터 송신 중지');render();}
async function upload(){
  if(mode!=='collector'||!reading||!endpoint||uploadBusy||cloudBusy)return;
  if(!pending&&(!latest||Date.now()-latest.t>3000))return;
  if(!pending)pending={id:crypto.randomUUID(),t:latest.t,v:[...latest.v]};
  const item=pending;const token=$('token').value.trim();if(!token)return;
  uploadBusy=true;let postError='';
  // no-cors 응답은 읽을 수 없으므로 뒤의 공개 조회에서 동일 ID가 있는지 확인합니다.
  try{await fetch(endpoint,{method:'POST',mode:'no-cors',credentials:'omit',redirect:'follow',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({...item,token}),signal:AbortSignal.timeout(15000)});}catch(e){postError=e.message;}
  try{const data=await jsonp(endpoint);ingestCloud(data);if(!remote.some(r=>r.id===item.id))throw Error(postError||'저장 확인 실패: 비밀키/배포/실행 로그를 확인하세요.');lastAck=Date.now();pending=null;showMessage('Google Sheets 저장 확인 · 자동 송신 중');}
  catch(e){cloudError=e.message;showMessage('송신 미확인 · 같은 ID로 재시도: '+e.message);}
  finally{uploadBusy=false;render();}
}
function drawChart(rows){
  const c=$('chart'),rect=c.getBoundingClientRect();if(!rect.width||!rect.height)return;const dpr=window.devicePixelRatio||1,w=rect.width,h=rect.height;
  if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}const x=c.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,w,h);
  const left=41,right=w-12,top=10,bottom=h-29;const y=v=>bottom-v/1023*(bottom-top);x.font='11px system-ui';x.textAlign='right';x.textBaseline='middle';
  for(const v of [0,256,512,768,1023]){x.strokeStyle='#30414e';x.lineWidth=1;x.beginPath();x.moveTo(left,y(v));x.lineTo(right,y(v));x.stroke();x.fillStyle='#a4b5c3';x.fillText(String(v),left-6,y(v));}
  if(!rows.length){x.textAlign='center';x.fillText('데이터 수신 대기',(left+right)/2,(top+bottom)/2);return;}
  const t0=rows[0].t,t1=rows[rows.length-1].t,span=Math.max(1,t1-t0);const xx=t=>left+(t-t0)/span*(right-left);
  colors.forEach((color,k)=>{x.strokeStyle=color;x.fillStyle=color;x.lineWidth=1.8;x.beginPath();rows.forEach((r,i)=>{const px=xx(r.t),py=y(r.v[k]);i?x.lineTo(px,py):x.moveTo(px,py);});x.stroke();const last=rows.at(-1);x.beginPath();x.arc(xx(last.t),y(last.v[k]),3,0,Math.PI*2);x.fill();});
  x.fillStyle='#a4b5c3';x.textBaseline='top';for(let i=0;i<3;i++){if(i>0&&t0===t1)break;x.textAlign=['left','center','right'][i];x.fillText(clock(t0+(t1-t0)*i/2),left+(right-left)*i/2,bottom+8);}
}
function render(){
  const rows=mode==='collector'?local:remote;const current=mode==='collector'?latest:rows.at(-1);const now=Date.now();
  for(let i=0;i<3;i++){const n=current?.v[i];$('v'+i).textContent=n??'—';$('bar'+i).style.width=n===undefined?'0%':(100*n/1023)+'%';$('pct'+i).textContent=n===undefined?'원시 신호 —':`원시 신호 ${(100*n/1023).toFixed(1)}%`;}
  $('lastSeen').textContent=current?`마지막 측정 ${clock(current.t)} · ${Math.max(0,Math.floor((now-current.t)/1000))}초 전`:'마지막 측정 —';
  if(mode==='collector'){if(reading&&latest&&now-latest.t<=3000)status('USB 수신 중','ok');else if(reading)status('센서 수신 대기','warn');else status('Arduino 미연결');}
  else if(cloudError)status('조회 오류','warn');else if(current&&now-current.t<=UPLOAD+POLL+15000)status('원격 수신 중','ok');else if(current)status('오래된 데이터','warn');else if(lastCloudOk)status('저장 데이터 없음');else status('연결 대기');
  $('cloudInfo').textContent=cloudError?'클라우드 오류 / 미확인':mode==='collector'?(lastAck?'저장 확인 '+clock(lastAck):'저장 대기'):(lastCloudOk?'조회 '+clock(lastCloudOk):'클라우드 —');
  $('download').disabled=!rows.length;const body=$('rows');const frag=document.createDocumentFragment();if(!rows.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=4;td.textContent='수신 대기';tr.append(td);frag.append(tr);}else rows.slice(-10).reverse().forEach(r=>{const tr=document.createElement('tr');[clock(r.t),...r.v].forEach(n=>{const td=document.createElement('td');td.textContent=n;tr.append(td);});frag.append(tr);});body.replaceChildren(frag);drawChart(rows);
}
function download(){const rows=mode==='collector'?local:remote;if(!rows.length)return;const csv='timestamp_iso,A0,A1,A2\r\n'+rows.map(r=>[new Date(r.t).toISOString(),...r.v].join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='water-'+mode+'-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('viewerMode').onclick=()=>setMode('viewer');$('collectorMode').onclick=()=>setMode('collector');$('applyEndpoint').onclick=applyEndpoint;$('connect').onclick=connect;$('disconnect').onclick=disconnect;$('download').onclick=download;
window.addEventListener('resize',render);setInterval(()=>{if(mode==='viewer')poll();},POLL);setInterval(upload,UPLOAD);setInterval(render,1000);
try{$('endpoint').value=cfg.endpoint||localStorage.getItem('water.endpoint')||'';}catch{$('endpoint').value=cfg.endpoint||'';}
if($('endpoint').value)applyEndpoint();else render();
