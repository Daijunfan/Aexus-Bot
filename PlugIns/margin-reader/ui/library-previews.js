import { api } from './transport.js';
// Only visible cards request Core-generated images. No PDF parsing or business state here.
export class LibraryPreviews {
  constructor() { this.cache = new Map(); this.queue = []; this.running = 0; this.generation = 0; this.bytes = 0; }
  attach(entries, options = {}) {
    const root=options.root||document.getElementById('files'),selector=options.selector||'.file-card';
    const incremental=Boolean(options.incremental&&this.observer&&this.root===root&&this.selector===selector);
    if(!incremental){
      this.generation++;this.observer?.disconnect();this.queue=[];
      this.root=root;this.selector=selector;this.entries=new Map();
      this.observer = new IntersectionObserver(items => {
        for(const item of items)if(item.isIntersecting){
          this.observer.unobserve(item.target);
          const entry=this.entries.get(item.target.dataset.path);
          if(entry){this.queue.push({card:item.target,entry,generation:this.generation});this.drain();}
        }
      },{root,rootMargin:'160px'});
    }
    for(const entry of entries)this.entries.set(entry.path,entry);
    // Only new cards require observing. In-flight previews persist across scrolls.
    for(const card of root.querySelectorAll(selector)){
      if(incremental&&card.dataset.preview!=='pending')continue;
      const entry=this.entries.get(card.dataset.path);
      if(entry?.kind!=='file'||!/^(pdf|html?|xhtml|md|markdown|txt|epub|mobi|azw3?|kf8|docx?|odt|rtf|fb2|png|jpe?g|webp|gif|avif|bmp)$/.test(entry.format))continue;
      const key=entry.path+':'+entry.version,cached=this.cache.get(key);
      if(cached)this.paint(card,cached);else this.observer.observe(card);
    }
  }
  remember(key, result) {
    if (this.cache.has(key)) return;
    const size = result.contentBase64?.length || 0;
    this.cache.set(key, result); this.bytes += size;
    while (this.cache.size > 96 || this.bytes > 12 * 1024 * 1024) {
      const oldest = this.cache.keys().next().value;
      this.bytes -= this.cache.get(oldest).contentBase64?.length || 0; this.cache.delete(oldest);
    }
  }
  drain() {
    while (this.running < 2 && this.queue.length) {
      const job = this.queue.shift();
      if (job.generation !== this.generation || !job.card.isConnected) continue;
      this.running++;
      job.card.dataset.preview = 'loading';
      api('document.preview', { path: job.entry.path, expectedVersion: job.entry.version }).then(result => {
        this.remember(`${job.entry.path}:${job.entry.version}`, result);
        if (job.generation === this.generation && job.card.isConnected) this.paint(job.card, result);
      }).catch(error => {
        if (job.generation===this.generation&&job.card.isConnected) { job.card.dataset.preview = 'unavailable'; job.card.querySelector('.file-art').title = `缩略图暂不可用：${error.message}`; }
      }).finally(() => { this.running--; this.drain(); });
    }
  }
  paint(card, result) {
    if (result.kind !== 'image' || result.mimeType !== 'image/png') { card.dataset.preview = 'unavailable'; return; }
    const art = card.querySelector('.file-art'); if (!art) return;
    const img = document.createElement('img'); img.className = 'document-thumbnail'; img.draggable = false;
    img.alt = `${result.title || card.dataset.path}${result.format === 'pdf' ? ' · PDF 封面' : ' · 内容缩略图'}`;
    img.decoding = 'async'; img.src = `data:image/png;base64,${result.contentBase64}`;
    art.querySelector('.document-thumbnail')?.remove();
    const sheet=art.querySelector('.document-cover-sheet')||art;sheet.style.setProperty('--cover-aspect',`${result.width} / ${result.height}`);sheet.prepend(img);art.classList.add('has-thumbnail');
    const details=card.querySelector('.study-document-preview-detail');
    if(details)details.textContent=result.pageCount?`${result.pageCount} 页`:details.dataset.summary==='pages'?'':result.excerpt||'';
    if(result.excerpt)card.querySelector('.collection-document-excerpt')?.replaceChildren(document.createTextNode(result.excerpt));
    card.dataset.preview = 'ready';
  }
}
