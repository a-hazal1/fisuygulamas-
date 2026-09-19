const $ = s => document.querySelector(s);
const queue = $('#queue'), grid = $('#grid'), empty = $('#empty'), queuePanel = $('#queuePanel'), count = $('#count');
let results = [];
const cfg = window.APP_CONFIG || {};
const sb = (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY)
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY)
  : null;


// ---------- Supabase bulut arşivi ----------
// Fişler ve PDF'ler artık kullanıcı hesabına bağlı olarak Supabase'de tutulur.
// Aynı hesapla farklı cihazdan giriş yapıldığında kayıtlar tekrar yüklenir.
let currentUserId = null;
let savedPdfs = [];

const RECEIPT_BUCKET = 'receipts';
const PDF_BUCKET = 'pdfs';

function safeFileName(name='file'){
  return String(name)
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g,'_')
    .replace(/_+/g,'_')
    .slice(0,120) || 'file';
}

async function storageUpload(bucket,path,blob,contentType,upsert=false){
  const {error}=await sb.storage
    .from(bucket)
    .upload(path,blob,{contentType:contentType||blob.type||'application/octet-stream',upsert});
  if(error)throw error;
}

async function storageDownload(bucket,path){
  const {data,error}=await sb.storage.from(bucket).download(path);
  if(error)throw error;
  return data;
}

async function storageRemove(bucket,paths){
  const clean=(paths||[]).filter(Boolean);
  if(!clean.length)return;
  const {error}=await sb.storage.from(bucket).remove(clean);
  if(error)throw error;
}

async function cloudInsertResult(r){
  if(!currentUserId)throw new Error('Oturum bulunamadı');

  const originalPath=`${currentUserId}/${r.id}/original_${safeFileName(r.name)}`;
  const scanPath=`${currentUserId}/${r.id}/scan.jpg`;

  await Promise.all([
    storageUpload(RECEIPT_BUCKET,originalPath,r.file,r.file.type||'image/jpeg',false),
    storageUpload(RECEIPT_BUCKET,scanPath,r.blob,'image/jpeg',false)
  ]);

  const row={
    id:r.id,
    user_id:currentUserId,
    filename:r.name,
    branch:r.branch||'',
    note:r.note||'',
    corners:r.corners,
    state:r.state||'Otomatik algılandı',
    selected:!!r.selected,
    mode:r.mode||'scan',
    original_path:originalPath,
    scan_path:scanPath,
    created_at:new Date(r.createdAt||Date.now()).toISOString()
  };

  const {error}=await sb.from('receipts').insert(row);
  if(error){
    await storageRemove(RECEIPT_BUCKET,[originalPath,scanPath]).catch(()=>{});
    throw error;
  }

  r.cloudOriginalPath=originalPath;
  r.cloudScanPath=scanPath;
}

async function cloudUpdateResult(r){
  if(!currentUserId)return;

  if(r.cloudScanPath){
    await storageUpload(RECEIPT_BUCKET,r.cloudScanPath,r.blob,'image/jpeg',true);
  }

  const {error}=await sb.from('receipts')
    .update({
      corners:r.corners,
      state:r.state,
      selected:!!r.selected,
      mode:r.mode||'scan',
      branch:r.branch||'',
      note:r.note||''
    })
    .eq('id',r.id)
    .eq('user_id',currentUserId);

  if(error)throw error;
}

async function cloudUpdateSelected(r){
  if(!currentUserId)return;
  const {error}=await sb.from('receipts')
    .update({selected:!!r.selected})
    .eq('id',r.id)
    .eq('user_id',currentUserId);
  if(error)console.error('Seçim buluta kaydedilemedi',error);
}

async function cloudDeleteResult(r){
  if(!currentUserId)return;
  await storageRemove(RECEIPT_BUCKET,[r.cloudOriginalPath,r.cloudScanPath]).catch(console.error);
  const {error}=await sb.from('receipts')
    .delete()
    .eq('id',r.id)
    .eq('user_id',currentUserId);
  if(error)throw error;
}

async function cloudLoadResults(){
  if(!currentUserId)return [];

  const {data:rows,error}=await sb.from('receipts')
    .select('*')
    .eq('user_id',currentUserId)
    .order('created_at',{ascending:false});

  if(error)throw error;

  const out=[];
  for(const row of rows||[]){
    try{
      const [scanBlob,originalBlob]=await Promise.all([
        storageDownload(RECEIPT_BUCKET,row.scan_path),
        storageDownload(RECEIPT_BUCKET,row.original_path)
      ]);

      const file=new File(
        [originalBlob],
        row.filename||'fis.jpg',
        {type:originalBlob.type||'image/jpeg'}
      );

      out.push({
        id:row.id,
        name:row.filename,
        branch:row.branch||'',
        note:row.note||'',
        corners:row.corners||[],
        state:row.state||'Kaydedildi',
        selected:row.selected!==false,
        mode:row.mode||'scan',
        createdAt:new Date(row.created_at).getTime(),
        blob:scanBlob,
        file,
        originalBlob,
        url:URL.createObjectURL(scanBlob),
        originalUrl:URL.createObjectURL(originalBlob),
        cloudOriginalPath:row.original_path,
        cloudScanPath:row.scan_path
      });
    }catch(e){
      console.error('Fiş dosyası indirilemedi',row.id,e);
    }
  }
  return out;
}

async function cloudInsertPdf(record){
  if(!currentUserId)throw new Error('Oturum bulunamadı');

  const path=`${currentUserId}/${record.id}/${safeFileName(record.name)}`;
  await storageUpload(PDF_BUCKET,path,record.blob,'application/pdf',false);

  const {error}=await sb.from('pdfs').insert({
    id:record.id,
    user_id:currentUserId,
    filename:record.name,
    item_count:record.count||0,
    storage_path:path,
    created_at:new Date(record.createdAt||Date.now()).toISOString()
  });

  if(error){
    await storageRemove(PDF_BUCKET,[path]).catch(()=>{});
    throw error;
  }

  record.storagePath=path;
}

async function cloudDeletePdf(record){
  if(!currentUserId)return;
  await storageRemove(PDF_BUCKET,[record.storagePath]).catch(console.error);
  const {error}=await sb.from('pdfs')
    .delete()
    .eq('id',record.id)
    .eq('user_id',currentUserId);
  if(error)throw error;
}

async function cloudLoadPdfs(){
  if(!currentUserId)return [];

  const {data:rows,error}=await sb.from('pdfs')
    .select('*')
    .eq('user_id',currentUserId)
    .order('created_at',{ascending:false});

  if(error)throw error;

  const out=[];
  for(const row of rows||[]){
    try{
      const blob=await storageDownload(PDF_BUCKET,row.storage_path);
      out.push({
        id:row.id,
        name:row.filename,
        createdAt:new Date(row.created_at).getTime(),
        count:row.item_count||0,
        blob,
        storagePath:row.storage_path
      });
    }catch(e){
      console.error('PDF indirilemedi',row.id,e);
    }
  }
  return out;
}

function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1200);
}

function renderPdfArchive(){
  const host=$('#pdfArchive');
  if(!host)return;
  if(!savedPdfs.length){
    host.innerHTML='<div class="pdf-empty">Henüz oluşturulmuş PDF yok.</div>';
    return;
  }
  host.innerHTML=savedPdfs.map(p=>`<div class="pdf-item" data-id="${p.id}">
    <div class="pdf-icon">PDF</div>
    <div class="pdf-info"><strong>${esc(p.name)}</strong><span>${new Date(p.createdAt).toLocaleString('tr-TR')} · ${p.count||0} fiş</span></div>
    <div class="pdf-item-actions"><button class="pdf-download">İndir</button><button class="pdf-delete">Sil</button></div>
  </div>`).join('');
  host.querySelectorAll('.pdf-item').forEach(row=>{
    const id=row.dataset.id,p=savedPdfs.find(x=>x.id===id);if(!p)return;
    row.querySelector('.pdf-download').onclick=()=>downloadBlob(p.blob,p.name);
    row.querySelector('.pdf-delete').onclick=async()=>{try{await cloudDeletePdf(p);savedPdfs=savedPdfs.filter(x=>x.id!==id);renderPdfArchive();toast('PDF arşivden silindi')}catch(e){console.error(e);toast('PDF silinemedi')}};
  });
}

function clearRuntimeResults(){
  results.forEach(r=>{
    try{URL.revokeObjectURL(r.url)}catch{}
    try{URL.revokeObjectURL(r.originalUrl)}catch{}
  });
  results=[];
}

function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800)}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

async function health(){
  try{const r=await fetch('/health');if(!r.ok)throw 0;$('#apiStatus').className='status ok';$('#apiStatus').innerHTML='<span></span> Hibrit tarayıcı hazır'}
  catch{$('#apiStatus').className='status bad';$('#apiStatus').innerHTML='<span></span> Tarama servisi kapalı'}
}

function updateSelection(){
  const n=results.filter(r=>r.selected).length;
  $('#selectedCount').textContent=n;
  $('#pdfBtn').disabled=n===0;
  $('#selectAll').textContent=results.length&&n===results.length?'Seçimi Kaldır':'Tümünü Seç';
}

function render(){
  count.textContent=results.length;
  empty.classList.toggle('hidden',results.length>0);
  grid.innerHTML=results.map(r=>`<article class="card ${r.selected?'selected':''}" data-id="${r.id}">
    <label class="pick"><input class="pick-input" type="checkbox" ${r.selected?'checked':''}><span>PDF</span></label>
    <div class="image-wrap"><img src="${r.url}" alt="Taranmış fiş"><span class="scan-state">${esc(r.state)}</span></div>
    <div class="card-body">
      <div class="card-title">${esc(r.name)}</div>
      <div class="meta">${esc([r.branch,r.note].filter(Boolean).join(' · ')||'Bilgi eklenmedi')}</div>
      <div class="card-actions">
        <button class="edit-corners">Köşeleri düzelt</button>
        <a class="download" href="${r.url}" download="scan_${esc(r.name.replace(/[^a-zA-Z0-9._-]/g,'_'))}">İndir</a>
        <button class="remove">Sil</button>
      </div>
    </div>
  </article>`).join('');

  grid.querySelectorAll('.card').forEach(card=>{
    const id=card.dataset.id;
    card.querySelector('.pick-input').onchange=e=>{const r=results.find(x=>x.id===id);r.selected=e.target.checked;cloudUpdateSelected(r);render()};
    card.querySelector('.remove').onclick=async()=>{const i=results.findIndex(x=>x.id===id);if(i>=0){const removed=results[i];try{await cloudDeleteResult(removed);URL.revokeObjectURL(removed.url);URL.revokeObjectURL(removed.originalUrl);results.splice(i,1);render();toast('Fiş silindi')}catch(e){console.error(e);toast('Fiş silinemedi')}}};
    card.querySelector('.edit-corners').onclick=()=>openCornerEditor(results.find(x=>x.id===id));
  });
  updateSelection();
}

function addQueue(file){
  queuePanel.classList.remove('hidden');
  const id=crypto.randomUUID(), url=URL.createObjectURL(file), el=document.createElement('div');
  el.className='queue-item';el.dataset.id=id;
  el.innerHTML=`<img src="${url}"><div><div class="q-name">${esc(file.name)}</div><div class="q-state">4 köşe aranıyor...</div></div><div class="spinner"></div>`;
  queue.prepend(el);return{id,url,el};
}

async function detectCorners(file){
  const fd=new FormData();fd.append('file',file,file.name);
  const r=await fetch('/detect',{method:'POST',body:fd});
  if(!r.ok){let d='Köşe tespiti başarısız';try{d=(await r.json()).detail||d}catch{}throw new Error(d)}
  return await r.json();
}

async function warpFile(file,corners,mode='scan'){
  const fd=new FormData();
  fd.append('file',file,file.name);
  fd.append('corners',JSON.stringify(corners));
  fd.append('mode',mode);
  const r=await fetch('/warp',{method:'POST',body:fd});
  if(!r.ok){let d='Tarama başarısız';try{d=(await r.json()).detail||d}catch{}throw new Error(d)}
  return await r.blob();
}

async function scanFile(file){
  if(!file.type.startsWith('image/')){toast(`${file.name}: görüntü dosyası değil`);return}
  if(file.size>20*1024*1024){toast(`${file.name}: 20 MB sınırını aşıyor`);return}

  const q=addQueue(file);
  try{
    const det=await detectCorners(file);
    q.el.querySelector('.q-state').textContent=det.needsReview?'Köşeler bulundu · kontrol önerilir':'4 köşe bulundu · perspektif düzeltiliyor...';
    const blob=await warpFile(file,det.corners,'scan');
    const resultUrl=URL.createObjectURL(blob);
    const originalUrl=URL.createObjectURL(file);
    results.unshift({
      id:q.id,url:resultUrl,blob,file,originalUrl,name:file.name,corners:det.corners,
      state:det.needsReview?'Kontrol gerekli':'Otomatik algılandı',selected:true,
      branch:$('#branch').value.trim(),note:$('#note').value.trim(),mode:'scan',createdAt:Date.now()
    });
    await cloudInsertResult(results[0]);
    q.el.querySelector('.q-state').textContent=det.needsReview?'Tarandı · köşeleri kontrol et':'Tarama tamamlandı';
    q.el.querySelector('.spinner').outerHTML='<div class="check">✓</div>';
    render();
  }catch(e){
    q.el.querySelector('.q-state').textContent='Tarama başarısız';
    q.el.querySelector('.spinner').outerHTML=`<div class="error">${esc(e.message)}</div>`;
  }finally{URL.revokeObjectURL(q.url)}
}

async function handle(files){
  const list=[...files],limit=3;let index=0;
  async function worker(){while(index<list.length){const f=list[index++];await scanFile(f)}}
  await Promise.all(Array.from({length:Math.min(limit,list.length)},worker));
}

// ---------- 4-corner editor ----------
const modal=$('#cornerModal'), stage=$('#cornerStage'), cornerImage=$('#cornerImage'), polygon=$('#cornerPolygon');
const handles=[...document.querySelectorAll('.corner-handle')];
let editTarget=null, editCorners=null, dragging=-1;

function imageDisplayRect(){
  const sw=stage.clientWidth, sh=stage.clientHeight, iw=cornerImage.naturalWidth||1, ih=cornerImage.naturalHeight||1;
  const scale=Math.min(sw/iw,sh/ih), w=iw*scale, h=ih*scale;
  return {x:(sw-w)/2,y:(sh-h)/2,w,h};
}
function cornerToStage(p){const r=imageDisplayRect();return{x:r.x+p[0]*r.w,y:r.y+p[1]*r.h}}
function stageToCorner(x,y){const r=imageDisplayRect();return[Math.max(0,Math.min(1,(x-r.x)/r.w)),Math.max(0,Math.min(1,(y-r.y)/r.h))]}
function drawCorners(){
  if(!editCorners)return;
  const pts=editCorners.map(cornerToStage);
  polygon.setAttribute('points',pts.map(p=>`${p.x},${p.y}`).join(' '));
  handles.forEach((h,i)=>{h.style.left=`${pts[i].x}px`;h.style.top=`${pts[i].y}px`});
}
function openCornerEditor(r){
  editTarget=r;editCorners=r.corners.map(p=>[...p]);
  cornerImage.src=r.originalUrl;$('#scanMode').value=r.mode||'color';
  modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  cornerImage.onload=drawCorners;requestAnimationFrame(drawCorners);
}
function closeCornerEditor(){modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');editTarget=null;editCorners=null;dragging=-1}
handles.forEach((h,i)=>h.addEventListener('pointerdown',e=>{dragging=i;h.setPointerCapture(e.pointerId);e.preventDefault()}));
stage.addEventListener('pointermove',e=>{
  if(dragging<0||!editCorners)return;
  const rect=stage.getBoundingClientRect();
  editCorners[dragging]=stageToCorner(e.clientX-rect.left,e.clientY-rect.top);drawCorners();e.preventDefault();
});
window.addEventListener('pointerup',()=>dragging=-1);
window.addEventListener('resize',drawCorners);
$('#cornerClose').onclick=closeCornerEditor;$('#cornerCancel').onclick=closeCornerEditor;
$('#cornerApply').onclick=async()=>{
  if(!editTarget||!editCorners)return;
  const btn=$('#cornerApply'),old=btn.textContent;btn.disabled=true;btn.textContent='Taranıyor...';
  try{
    const mode=$('#scanMode').value,blob=await warpFile(editTarget.file,editCorners,mode);
    URL.revokeObjectURL(editTarget.url);
    editTarget.url=URL.createObjectURL(blob);editTarget.blob=blob;editTarget.corners=editCorners.map(p=>[...p]);editTarget.mode=mode;editTarget.state='Elle düzeltildi';
    await cloudUpdateResult(editTarget);
    closeCornerEditor();render();toast('Köşeler uygulanıp fiş yeniden tarandı');
  }catch(e){toast(e.message)}finally{btn.disabled=false;btn.textContent=old}
};

function blobToDataURL(blob){return new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(fr.result);fr.onerror=reject;fr.readAsDataURL(blob)})}
function imageSize(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve({w:im.naturalWidth,h:im.naturalHeight});im.onerror=reject;im.src=src})}
async function createPdf(){
  const selected=results.filter(r=>r.selected);if(!selected.length)return;
  const btn=$('#pdfBtn');btn.disabled=true;const old=btn.innerHTML;btn.textContent='PDF hazırlanıyor...';
  try{
    const {jsPDF}=window.jspdf,pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const pageW=210,pageH=297,margin=8,gap=4,cols=2,rows=3,cellW=(pageW-margin*2-gap)/cols,cellH=(pageH-margin*2-gap*(rows-1))/rows;
    for(let i=0;i<selected.length;i++){
      if(i>0&&i%6===0)pdf.addPage();
      const pos=i%6,row=Math.floor(pos/2),col=pos%2,x=margin+col*(cellW+gap),y=margin+row*(cellH+gap);
      const data=await blobToDataURL(selected[i].blob),sz=await imageSize(data),scale=Math.min(cellW/sz.w,cellH/sz.h),w=sz.w*scale,h=sz.h*scale;
      pdf.addImage(data,'JPEG',x+(cellW-w)/2,y+(cellH-h)/2,w,h,undefined,'FAST');
    }
    const stamp=new Date();
    const name=`fisler_${stamp.toISOString().slice(0,10)}_${String(stamp.getHours()).padStart(2,'0')}${String(stamp.getMinutes()).padStart(2,'0')}.pdf`;
    const pdfBlob=pdf.output('blob');
    const record={id:crypto.randomUUID(),name,createdAt:Date.now(),count:selected.length,blob:pdfBlob};
    await cloudInsertPdf(record);
    savedPdfs.unshift(record);
    renderPdfArchive();
    downloadBlob(pdfBlob,name);
    toast(`${selected.length} fiş PDF'e eklendi ve arşive kaydedildi`);
  }catch(e){console.error(e);toast('PDF oluşturulamadı')}finally{btn.innerHTML=old;btn.disabled=false;updateSelection()}
}

async function showSession(session){
  if(session){
    $('#authView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    $('#userEmail').textContent=session.user?.email||'';
    const newUserId=session.user?.id||null;
    if(newUserId!==currentUserId){
      clearRuntimeResults();
      currentUserId=newUserId;
      try{results=await cloudLoadResults();savedPdfs=await cloudLoadPdfs()}catch(e){console.error('Bulut arşivi yüklenemedi',e);results=[];savedPdfs=[];toast('Bulut arşivi yüklenemedi')}
    }
    health();
    render();
    renderPdfArchive();
  }else{
    clearRuntimeResults();
    currentUserId=null;
    savedPdfs=[];
    $('#appView').classList.add('hidden');
    $('#authView').classList.remove('hidden');
  }
}
async function initAuth(){
  if(!sb){$('#authError').textContent='Supabase ayarları bulunamadı.';return}
  const {data:{session}}=await sb.auth.getSession();
  await showSession(session);
  sb.auth.onAuthStateChange((_event,s)=>{showSession(s)});
}
$('#loginForm').onsubmit=async e=>{e.preventDefault();$('#authError').textContent='';$('#loginBtn').disabled=true;$('#loginBtn').textContent='Giriş yapılıyor...';try{const {error}=await sb.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});if(error)throw error}catch(e){$('#authError').textContent=e.message==='Invalid login credentials'?'E-posta veya şifre hatalı.':e.message}finally{$('#loginBtn').disabled=false;$('#loginBtn').textContent='Giriş Yap'}};
$('#logoutBtn').onclick=async()=>{await sb.auth.signOut()};
$('#cameraInput').onchange=e=>{handle(e.target.files);e.target.value=''};$('#galleryInput').onchange=e=>{handle(e.target.files);e.target.value=''};
const dz=$('#dropZone');['dragenter','dragover'].forEach(n=>dz.addEventListener(n,e=>{e.preventDefault();dz.classList.add('over')}));['dragleave','drop'].forEach(n=>dz.addEventListener(n,e=>{e.preventDefault();dz.classList.remove('over')}));dz.addEventListener('drop',e=>handle(e.dataTransfer.files));
$('#clearDone').onclick=()=>{[...queue.children].filter(x=>!x.querySelector('.spinner')).forEach(x=>x.remove());if(!queue.children.length)queuePanel.classList.add('hidden')};
$('#selectAll').onclick=()=>{const all=results.length&&results.every(r=>r.selected);results.forEach(r=>{r.selected=!all;cloudUpdateSelected(r)});render()};$('#pdfBtn').onclick=createPdf;
initAuth();
