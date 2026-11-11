const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};
const server=http.createServer((req,res)=>{
  let pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/extension/player-panel.html'){
    const html=fs.readFileSync(path.join(root,'extension/player-panel.html'),'utf8').replace('<script src="core.js">','<script src="/tests/panel-mock.js"></script><script src="core.js">');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);return;
  }
  if(/^\/watch\/\d+$/.test(pathname))pathname='/tests/runner.html';
  const file=path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'content-type':mime[path.extname(file)]||'text/plain'});res.end(data);});
});
const port=Number(process.env.PORT)||18765;
server.listen(port,'127.0.0.1',()=>console.log(`Browser integration tests: http://127.0.0.1:${port}/watch/123`));
