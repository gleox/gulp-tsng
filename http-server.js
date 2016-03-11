var connect = require('connect'),
    serve = require('serve-static'),
    path = require("path");
    
var port = 3001;
var root = path.join(__dirname, "example/src");

console.log("Http Simple Server");
console.log("root: ", root);
console.log("started: ", "http://127.0.0.1:" + port);

connect()
    .use(serve(root))
    .listen(port);