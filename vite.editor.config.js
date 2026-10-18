import {defineConfig} from 'vite';
export default defineConfig({
 server:{host:'127.0.0.1',port:5173},
 preview:{host:'127.0.0.1',port:4174},
 build:{outDir:'editor-dist',emptyOutDir:true,rollupOptions:{input:{game:'index.html',editor:'editor.html',sample:'editor/sample-scene.html'}}}
});
