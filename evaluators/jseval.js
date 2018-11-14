#!/usr/bin/env node

var util = require('util');
var vm = require('vm');
var net = require('net');
var fs = require('fs');

var ctr = 0;
var conns = {};

var getcontext = (function(newctx) {
    var contexts = new Map();
    return (function(key) {
        if (!contexts.has(key)) {
            var ctx = newctx();
            contexts.set(key, ctx);
            return ctx;
        } else {
            return contexts.get(key);
        }
    });
})(function() {
    return {
        context: vm.createContext({
            console: console,
            module: module,
            process: process,
            require: require
        }),
        buf: ""
    };
});
var stdout;
var callback = function(data) {
    stdout += data;
};

function respond(msg) {
    var conn = conns[msg.nonce];
    delete conns[msg.nonce];
    var outbuf = Buffer.allocUnsafe(4);
    outbuf.writeInt32LE(Buffer.byteLength(msg.result, 'utf8'), 0);
    conn.write(outbuf);
    conn.write(msg.result, 'utf8');
    conn.end();
}

function handle_request(message) {
    var finished = true;
    var ctx = getcontext(message.key);
    ctx.buf += message.code;
    stdout = "";
    try {
        var out = vm.runInContext(ctx.buf, ctx.context, {
            filename: 'stdin'
        });
        if (typeof out !== "undefined") {
            stdout += util.inspect(out);
        }
    } catch(err) {
        // FIXME hack hack hack
        if (err.name === "SyntaxError" && err.message === "Unexpected end of input") {
            finished = false;
        } else {
            stdout += err.toString();
        }
    }
    if (finished) {
        ctx.buf = "";
    }

    respond({result: finished ? stdout : "(continue...)", nonce: message.nonce});
}

var server = net.createServer(conn => {
    var data = Buffer.allocUnsafe(0);
    conn.on('data', function(chunk) {
        data = Buffer.concat([data, chunk]);
        var key_len = 0;
        var code_len = 0;
        if (data.length >= 12
            && data.length >= 12 +
                (key_len = data.readInt32LE(4)) +
                (code_len = data.readInt32LE(8))) {
            var nonce = ctr++;
            conns[nonce] = conn;
            handle_request({
                timeout: data.readInt32LE(0),
                key: data.toString('utf8', 12, 12 + key_len),
                code: data.toString('utf8', 12 + key_len, 12 + key_len + code_len),
                nonce: nonce
            });
        }
    });
});

process.stdout.write = (function(write) {
    return function(string, encoding, fd) {
        callback.call(callback, string);
    };
}(process.stdout.write));
process.stderr.write = (function(write) {
    return function(string, encoding, fd) {
        callback.call(callback, string);
    };
}(process.stderr.write));

server.listen({ fd: 3 });
