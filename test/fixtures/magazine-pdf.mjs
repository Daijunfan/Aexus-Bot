/** Original six-page fixture: readable text, vector figures and a page with no text layer. */
export function magazinePdf(){
 const titles=['The international outlook','Energy and transition','Reading a figure','A second perspective','Sources and uncertainty','Visual evidence']
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids ['+titles.map((_,i)=>(4+i*2)+' 0 R').join(' ')+'] /Count '+titles.length+' >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
 for(let i=0;i<titles.length;i++){
  const lines=['ATLAS WEEKLY / READING EDITION',titles[i],'Page '+(i+1)+' / demonstration material','Read the source before drawing a conclusion.','A staged transition reduces disruption.','Separate evidence from assumptions and preserve the original page.'],escape=text=>text.replace(/[\\()]/g,'\\$&')
  const text=i===5?'':lines.map((line,n)=>`BT /F1 ${n===1?24:13} Tf 48 ${742-n*38} Td (${escape(line)}) Tj ET`).join('\n')
  const stream=Buffer.from(`q 0.95 0.96 0.99 rg 0 0 612 792 re f 0.3 0.4 0.75 rg 48 250 90 ${120+i*10} re f 160 250 90 190 re f 272 250 90 240 re f Q\n${text}\n`)
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}endstream`)
 }
 let pdf='%PDF-1.7\n',offsets=[0]
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n'}
 const start=Buffer.byteLength(pdf);pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF\n'
 return Buffer.from(pdf)
}
