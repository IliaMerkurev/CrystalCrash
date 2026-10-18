import {defineConfig} from 'vite';
import {sourceSavePlugin} from './scripts/editor-source-server.mjs';
export default defineConfig({
 plugins:[sourceSavePlugin()],
 server:{host:'127.0.0.1',port:5173},
 preview:{host:'127.0.0.1',port:4174},
 build:{outDir:'editor-dist',emptyOutDir:true,rollupOptions:{input:{game:'index.html',editor:'editor.html',sample:'editor/sample-scene.html'}}}
});
