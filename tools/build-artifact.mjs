import * as esbuild from 'esbuild';
import fs from 'fs';
const S = '/tmp/claude-1000/-home-iago/8a9cf9e1-20a0-468f-8095-2fc7f5cd92a8/scratchpad/node_modules/three';
const P = '/home/iago/PROYECTOS/f1-ai-gp';
const plugin = { name: 'three', setup(b) {
  b.onResolve({ filter: /^three$/ }, () => ({ path: S + '/build/three.module.js' }));
  b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: S + '/examples/jsm/' + a.path.slice('three/addons/'.length) }));
} };
const r = await esbuild.build({ entryPoints: [P + '/js/main.js'], bundle: true, format: 'iife', minify: true, write: false, plugins: [plugin], target: 'es2020' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync(P + '/index.html', 'utf8');
const style = html.slice(html.indexOf('<!--STYLE-->') + 12, html.indexOf('<!--/STYLE-->'));
let body = html.slice(html.indexOf('<!--BODY-->') + 11, html.indexOf('<!--/BODY-->'));
body = body.replace(/<script type="importmap">[\s\S]*?<\/script>/, '').replace(/<script type="module" src="js\/main.js"><\/script>/, '');
const head = '<title>Neural Grand Prix</title>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Titillium+Web:wght@400;600;700;900&display=swap">\n';
fs.writeFileSync(P + '/artifact.html', head + style + body + '<script>\n' + js + '\n</script>\n');
console.log('ok', (fs.statSync(P + '/artifact.html').size / 1024).toFixed(0) + ' KB');
