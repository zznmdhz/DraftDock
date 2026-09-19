const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const sampleBody = {
  master: `# 把 AI 生成内容变成真正能发布的材料\n\nAI 已经帮我们生成了文章和配图，但真正发布时，时间仍花在找文件、换格式与重复裁图上。\n\n## 问题不在生成，而在交付\n\n一篇主稿需要变成不同平台能接收的版本。文字要保留结构，图片要按用途适配，而且原稿不能被覆盖。\n\n> 好的工作台不是替你再写一遍，而是让已经完成的内容顺利抵达平台。\n\n## 最小可行链路\n\n1. 导入 Markdown 与图片\n2. 为平台选择图片比例与顺序\n3. 复制正文或导出 Word\n4. 人工检查并确认发布`,
  wechat: `# 把 AI 生成内容变成真正能发布的材料\n\nAI 已经能快速生成文章和配图，但真正发布时，我们仍在反复找文件、换格式、裁图片。\n\n## 问题不在“生成”，而在“交付”\n\n公众号需要保留标题、加粗、列表与引用等结构；图片则要区分封面和正文插图，不能全部按同一种比例处理。\n\n> 内容已经生成，别再把时间花在搬运上。\n\n## 一条更短的发布链路\n\n1. 导入一篇 Markdown 主稿\n2. 选择公众号使用的图片\n3. 裁切封面，正文图保留原比例\n4. 复制富文本并按指引插入图片\n5. 回到平台确认发布`,
  xhs: `AI 生成完内容，真正费时间的才刚开始。\n\n找文件、改比例、复制正文、重新排图片……同一篇内容为了发到不同平台，往往要重复处理好几遍。\n\n我想把这些动作收进一个“发布准备台”：\n\n✓ 一篇主稿，生成平台独立版本\n✓ 图片可裁切，也可完整留边\n✓ 正文直接复制，图片按顺序交付\n✓ 最后由人检查并确认发布\n\n先把真实链路跑通，再决定哪些动作值得自动化。\n\n#内容创作 #效率工具 #AI工作流 #自媒体运营`
};

const platformConfig = {
  master: { badge: "主稿", title: "主稿", hint: "保留原始内容与图片，不覆盖平台版本", preview: "Markdown 结构预览", primary: "复制 Markdown" },
  wechat: { badge: "公众号版本", title: "公众号文章", hint: "横封面建议 2.35:1，正文图保留原比例", preview: "公众号富文本", primary: "复制公众号排版" },
  xhs: { badge: "小红书版本", title: "小红书图文", hint: "竖图建议 3:4；正文输出为纯文本", preview: "小红书纯文本", primary: "复制小红书正文" }
};

let currentPlatform = localStorage.getItem("draftdock-platform") || "wechat";
let bodies = JSON.parse(localStorage.getItem("draftdock-bodies") || "null") || sampleBody;
let activeCropIndex = -1;
let cropState = { ratio: 2.35, mode: "cover", zoom: 1, x: 0, y: 0, dragging: false };

function makeSample(label, colors, vertical = false) {
  const canvas = document.createElement("canvas");
  canvas.width = vertical ? 900 : 1200;
  canvas.height = vertical ? 1200 : 760;
  const ctx = canvas.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,.13)";
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(canvas.width * (.16 + i * .15), canvas.height * (.2 + (i % 2) * .3), 80 + i * 20, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "white"; ctx.font = `700 ${vertical ? 64 : 70}px sans-serif`; ctx.fillText(label, 64, canvas.height - 110);
  ctx.font = "28px sans-serif"; ctx.fillStyle = "rgba(255,255,255,.72)"; ctx.fillText("DraftDock · 发布素材", 66, canvas.height - 65);
  return canvas.toDataURL("image/jpeg", .9);
}

let assets = [
  { name: "01-content-workflow.jpg", src: makeSample("从内容到发布", ["#17243e", "#ef6a45"]), role: "横封面", ratio: "2.35:1", mode: "cover", selected: true },
  { name: "02-three-steps.jpg", src: makeSample("三步减少搬运", ["#284d48", "#84a96b"], true), role: "正文配图", ratio: "原比例", mode: "contain", selected: true },
  { name: "03-ready-to-publish.jpg", src: makeSample("让内容顺利抵达", ["#4a315e", "#db7b78"], true), role: "正文配图", ratio: "原比例", mode: "contain", selected: true }
];

function escapeHtml(text) { return text.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function inlineMd(text) { return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>"); }
function renderMarkdown(md) {
  const lines = md.split(/\r?\n/); let html = "", list = false;
  for (const line of lines) {
    if (/^# /.test(line)) { if(list){html+="</ol>";list=false;} html += `<h1>${inlineMd(line.slice(2))}</h1>`; }
    else if (/^## /.test(line)) { if(list){html+="</ol>";list=false;} html += `<h2>${inlineMd(line.slice(3))}</h2>`; }
    else if (/^> /.test(line)) { if(list){html+="</ol>";list=false;} html += `<blockquote>${inlineMd(line.slice(2))}</blockquote>`; }
    else if (/^\d+\. /.test(line)) { if(!list){html+="<ol>";list=true;} html += `<li>${inlineMd(line.replace(/^\d+\. /,""))}</li>`; }
    else if (!line.trim()) { if(list){html+="</ol>";list=false;} }
    else { if(list){html+="</ol>";list=false;} html += `<p>${inlineMd(line)}</p>`; }
  }
  if(list) html += "</ol>";
  return html;
}

function renderAssets() {
  const list = $("#assetList"); list.innerHTML = "";
  if (!assets.length) { list.innerHTML = '<div class="empty-assets">把一组图片拖到这里，开始准备平台素材。</div>'; }
  assets.forEach((asset, index) => {
    const card = document.createElement("div"); card.className = `asset-card ${asset.mode === "contain" ? "contain" : ""}`;
    card.innerHTML = `<div class="sort-handle" title="排序">⋮⋮</div><div class="thumb-wrap"><img src="${asset.src}" alt="${escapeHtml(asset.name)}"><span class="asset-index">${String(index+1).padStart(2,"0")}</span><input class="asset-check" type="checkbox" ${asset.selected ? "checked" : ""} aria-label="选择 ${escapeHtml(asset.name)}"></div><div class="asset-info"><strong>${escapeHtml(asset.name)}</strong><small>${asset.role} · ${asset.ratio}</small><span class="asset-state">交付文件已生成</span><div class="asset-actions"><button class="crop-action">适配比例</button><button class="download-action">下载</button><button class="move-action" data-dir="up">↑</button><button class="move-action" data-dir="down">↓</button></div></div>`;
    $(".asset-check", card).addEventListener("change", e => asset.selected = e.target.checked);
    $(".crop-action", card).addEventListener("click", () => openCrop(index));
    $(".download-action", card).addEventListener("click", () => downloadAsset(index));
    $$(".move-action", card).forEach(btn => btn.addEventListener("click", () => moveAsset(index, btn.dataset.dir)));
    list.append(card);
  });
  $("#assetCount").textContent = assets.length;
}

function moveAsset(index, direction) {
  const next = direction === "up" ? index - 1 : index + 1;
  if (next < 0 || next >= assets.length) return;
  [assets[index], assets[next]] = [assets[next], assets[index]]; renderAssets();
}

function updateEditor() {
  const config = platformConfig[currentPlatform];
  $$(".platform-tab").forEach(b => b.classList.toggle("active", b.dataset.platform === currentPlatform));
  $("#versionBadge").textContent = config.badge; $("#usageTitle").textContent = config.title; $("#usageHint").textContent = config.hint;
  $("#previewMode").textContent = config.preview; $("#copyPrimary").textContent = config.primary;
  const icon = $(".platform-icon"); icon.textContent = currentPlatform === "xhs" ? "红" : currentPlatform === "master" ? "主" : "微"; icon.className = `platform-icon ${currentPlatform === "xhs" ? "xhs" : "wechat"}`;
  $("#bodyInput").value = bodies[currentPlatform];
  updatePreview(); localStorage.setItem("draftdock-platform", currentPlatform);
}

function updatePreview() {
  const body = $("#bodyInput").value; bodies[currentPlatform] = body;
  localStorage.setItem("draftdock-bodies", JSON.stringify(bodies));
  $("#bodyCount").textContent = `${body.replace(/\s/g, "").length} 字`;
  $("#titleCount").textContent = $("#titleInput").value.length;
  if (currentPlatform === "xhs") $("#preview").innerHTML = body.split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join("");
  else $("#preview").innerHTML = renderMarkdown(body);
}

function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.t); showToast.t = setTimeout(() => toast.classList.remove("show"), 1900); }

async function copyText(kind) {
  const body = $("#bodyInput").value;
  try {
    if (kind === "rich" && navigator.clipboard.write) {
      const html = renderMarkdown(body); await navigator.clipboard.write([new ClipboardItem({"text/html":new Blob([html],{type:"text/html"}),"text/plain":new Blob([body.replace(/^#+\s/gm, "")],{type:"text/plain"})})]);
    } else await navigator.clipboard.writeText(kind === "plain" ? body.replace(/^#+\s/gm, "").replace(/[>*_`]/g, "") : body);
    showToast("已复制，可以切换到平台粘贴");
  } catch { showToast("浏览器未允许剪贴板，请手动选择正文复制"); }
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}

function zipStore(files) {
  const encoder = new TextEncoder(), chunks = [], central = []; let offset = 0;
  const u16 = n => new Uint8Array([n & 255, n >>> 8 & 255]);
  const u32 = n => new Uint8Array([n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255]);
  const join = parts => { const size = parts.reduce((n,p)=>n+p.length,0), out = new Uint8Array(size); let at=0; for(const p of parts){out.set(p,at);at+=p.length;} return out; };
  for (const file of files) {
    const name = encoder.encode(file.name), data = typeof file.data === "string" ? encoder.encode(file.data) : file.data, crc = crc32(data);
    const local = join([u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name,data]);
    chunks.push(local);
    central.push(join([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));
    offset += local.length;
  }
  const centralSize = central.reduce((n,p)=>n+p.length,0), end = join([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(centralSize),u32(offset),u16(0)]);
  return new Blob([...chunks,...central,end], {type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}

function xmlText(text) { return text.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function wordParagraph(text, style = "") {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r></w:p>`;
}
function wordImage(relId, id, width, height) {
  const cx = 5029200, cy = Math.round(cx * height / width);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="图片 ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

async function exportWord() {
  showToast("正在生成含图片的 DOCX…");
  const files = [], rels = [], imageBlocks = []; let imageId = 1;
  for (const asset of assets.filter(a => a.selected).slice(0, 10)) {
    try {
      const blob = await (await fetch(asset.src)).blob(), bytes = new Uint8Array(await blob.arrayBuffer());
      const ext = blob.type.includes("png") ? "png" : "jpg", name = `image${imageId}.${ext}`, relId = `rId${imageId}`;
      const img = await new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=reject;el.src=asset.src;});
      files.push({name:`word/media/${name}`,data:bytes}); rels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`); imageBlocks.push(wordImage(relId,imageId,img.naturalWidth,img.naturalHeight)); imageId++;
    } catch { }
  }
  const paragraphs = $("#bodyInput").value.split(/\r?\n/).filter(Boolean).map(line => {
    if (line.startsWith("# ")) return wordParagraph(line.slice(2),"Title");
    if (line.startsWith("## ")) return wordParagraph(line.slice(3),"Heading1");
    return wordParagraph(line.replace(/^>\s?|^\d+\.\s?/,""));
  }).join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${paragraphs}${imageBlocks.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  files.push(
    {name:"[Content_Types].xml",data:`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`},
    {name:"_rels/.rels",data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`},
    {name:"word/document.xml",data:documentXml},
    {name:"word/_rels/document.xml.rels",data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`}
  );
  const a = document.createElement("a"); a.href = URL.createObjectURL(zipStore(files)); a.download = `${$("#titleInput").value}.docx`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); showToast(`DOCX 已导出，含 ${imageBlocks.length} 张图片`);
}

async function addFiles(files) {
  for (const file of files) {
    if (file.type.startsWith("image/")) assets.push({name:file.name, src:URL.createObjectURL(file), role:"正文配图", ratio:"原比例", mode:"contain", selected:true});
    else if (/\.(md|txt)$/i.test(file.name)) { const text = await file.text(); bodies.master = text; bodies.wechat = text; currentPlatform = "master"; updateEditor(); showToast(`已导入 ${file.name}`); }
  }
  renderAssets();
}

function openCrop(index) {
  activeCropIndex = index; cropState = { ratio: currentPlatform === "xhs" ? .75 : 2.35, mode: assets[index].mode || "cover", zoom: 1, x: 0, y: 0, dragging: false };
  $$("#ratioGrid button").forEach(b => b.classList.toggle("active", Number(b.dataset.ratio) === cropState.ratio));
  $$(".mode-switch button").forEach(b => b.classList.toggle("active", b.dataset.mode === cropState.mode)); $("#zoomRange").value = 1;
  const img = new Image(); img.onload = () => { cropState.img = img; drawCrop(); }; img.src = assets[index].src; $("#cropDialog").showModal();
}

function drawCrop() {
  if (!cropState.img) return; const canvas = $("#cropCanvas"), ctx = canvas.getContext("2d");
  const maxW = 720, maxH = 390; let w = maxW, h = w / cropState.ratio; if (h > maxH) { h = maxH; w = h * cropState.ratio; }
  canvas.width = Math.round(w); canvas.height = Math.round(h); ctx.fillStyle = $("#bgColor").value; ctx.fillRect(0,0,w,h);
  const img = cropState.img; const base = cropState.mode === "cover" ? Math.max(w/img.width, h/img.height) : Math.min(w/img.width,h/img.height); const scale = base*cropState.zoom;
  const dw=img.width*scale, dh=img.height*scale; ctx.drawImage(img,(w-dw)/2+cropState.x,(h-dh)/2+cropState.y,dw,dh);
}

function applyCrop() {
  const canvas=$("#cropCanvas"); const asset=assets[activeCropIndex]; asset.src=canvas.toDataURL("image/png"); asset.mode=cropState.mode; asset.ratio=$$("#ratioGrid button").find(b=>b.classList.contains("active"))?.textContent.trim().split(/\s/)[0]||"自定义"; asset.name=asset.name.replace(/\.[^.]+$/,"")+`-${asset.ratio.replace(":","x")}.png`; $("#cropDialog").close(); renderAssets(); showToast("新交付图片已生成，原图未覆盖");
}

function downloadAsset(index){const a=document.createElement("a");a.href=assets[index].src;a.download=assets[index].name;a.click();showToast("交付图片已下载");}

$$('.platform-tab').forEach(btn=>btn.addEventListener('click',()=>{currentPlatform=btn.dataset.platform;updateEditor();}));
$("#bodyInput").addEventListener("input", updatePreview); $("#titleInput").addEventListener("input", updatePreview);
$("#copyPrimary").addEventListener("click",()=>copyText(currentPlatform === "wechat" ? "rich" : currentPlatform === "xhs" ? "plain" : "markdown"));
$("#copyMenu").addEventListener("click",()=>copyText("markdown")); $("#exportWord").addEventListener("click",exportWord);
$("#importTrigger").addEventListener("click",()=>$("#fileInput").click()); $("#addImages").addEventListener("click",()=>$("#fileInput").click()); $("#dropzone").addEventListener("click",()=>$("#fileInput").click());
$("#fileInput").addEventListener("change",e=>addFiles(e.target.files));
for(const event of ["dragenter","dragover"]){$("#dropzone").addEventListener(event,e=>{e.preventDefault();$("#dropzone").classList.add("dragging")})} for(const event of ["dragleave","drop"]){$("#dropzone").addEventListener(event,e=>{e.preventDefault();$("#dropzone").classList.remove("dragging")})} $("#dropzone").addEventListener("drop",e=>addFiles(e.dataTransfer.files));
$("#trayToggle").addEventListener("click",()=>{document.body.classList.toggle("tray");showToast(document.body.classList.contains("tray")?"已切换到发布托盘":"已恢复三栏工作台")});
$("#readyButton").addEventListener("click",()=>{const selected=assets.filter(a=>a.selected).length;showToast(`材料已就绪：${selected} 张图片 + 1 份正文`)});
$("#selectAll").addEventListener("click",()=>{const all=assets.every(a=>a.selected);assets.forEach(a=>a.selected=!all);renderAssets()});
$("#newArticle").addEventListener("click",()=>showToast("验证版先聚焦一篇真实文章"));
$("#articleSearch").addEventListener("input",e=>$$('.article-item').forEach(item=>item.hidden=!item.textContent.includes(e.target.value)));
$$('.article-item').forEach(item=>item.addEventListener('click',()=>{$$('.article-item').forEach(i=>i.classList.remove('active'));item.classList.add('active');showToast("已切换文章（验证版使用示例内容）")}));
$$('#ratioGrid button').forEach(btn=>btn.addEventListener('click',()=>{$$('#ratioGrid button').forEach(b=>b.classList.remove('active'));btn.classList.add('active');cropState.ratio=Number(btn.dataset.ratio);drawCrop()}));
$$('.mode-switch button').forEach(btn=>btn.addEventListener('click',()=>{$$('.mode-switch button').forEach(b=>b.classList.remove('active'));btn.classList.add('active');cropState.mode=btn.dataset.mode;drawCrop()}));
$("#zoomRange").addEventListener("input",e=>{cropState.zoom=Number(e.target.value);drawCrop()}); $("#bgColor").addEventListener("input",drawCrop); $("#applyCrop").addEventListener("click",applyCrop);
const cropCanvas=$("#cropCanvas"); cropCanvas.addEventListener("pointerdown",e=>{cropState.dragging=true;cropState.px=e.clientX;cropState.py=e.clientY;cropCanvas.setPointerCapture(e.pointerId)}); cropCanvas.addEventListener("pointermove",e=>{if(!cropState.dragging)return;cropState.x+=e.clientX-cropState.px;cropState.y+=e.clientY-cropState.py;cropState.px=e.clientX;cropState.py=e.clientY;drawCrop()}); cropCanvas.addEventListener("pointerup",()=>cropState.dragging=false);

renderAssets(); updateEditor();

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const safe = promise => void Promise.resolve(promise).catch(() => {});
  safe(context.registerTool({
    name:"read_draftdock_state", title:"读取稿间状态", description:"读取当前文章的平台版本、正文长度和已选图片数量。",
    inputSchema:{type:"object",properties:{},additionalProperties:false}, annotations:{readOnlyHint:true,untrustedContentHint:false},
    execute(){return {platform:currentPlatform,bodyLength:bodies[currentPlatform].length,selectedImages:assets.filter(a=>a.selected).length};}
  }));
  safe(context.registerTool({
    name:"set_content_platform", title:"切换内容版本", description:"在主稿、公众号文章和小红书图文版本之间切换。",
    inputSchema:{type:"object",properties:{platform:{type:"string",enum:["master","wechat","xhs"]}},required:["platform"],additionalProperties:false}, annotations:{readOnlyHint:false,untrustedContentHint:false},
    execute(input){if(!platformConfig[input?.platform])throw new Error("不支持的平台版本");currentPlatform=input.platform;updateEditor();return {platform:currentPlatform,label:platformConfig[currentPlatform].title};}
  }));
  safe(context.registerTool({
    name:"update_platform_body", title:"更新平台正文", description:"更新当前平台版本的正文并同步刷新预览。",
    inputSchema:{type:"object",properties:{body:{type:"string",maxLength:50000}},required:["body"],additionalProperties:false}, annotations:{readOnlyHint:false,untrustedContentHint:true},
    execute(input){if(typeof input?.body!=="string")throw new Error("正文必须是字符串");$("#bodyInput").value=input.body;updatePreview();return {platform:currentPlatform,bodyLength:input.body.length};}
  }));
}
registerWebMcpTools();
