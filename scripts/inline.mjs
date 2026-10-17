import fs from 'node:fs';
let html=fs.readFileSync('dist/index.html','utf8');
html=html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,(_,src)=>'<script type="module">'+fs.readFileSync('dist/'+src.replace(/^\//,''),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
html=html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,(_,src)=>'<style>'+fs.readFileSync('dist/'+src.replace(/^\//,''),'utf8')+'</style>');
fs.writeFileSync('dist/index.html',html);fs.rmSync('dist/assets',{recursive:true,force:true});
let size=Buffer.byteLength(html);console.log('Single HTML:',size,'bytes');if(size>=5000000)throw Error('HTML exceeds 5 MB');if(/src="\/@vite|https:\/\/cdn/.test(html))throw Error('Unexpected runtime dependency');
