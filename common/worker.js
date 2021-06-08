const dgram = require('dgram');

import Clock from './clock.js';

var internal_clock = new Clock();

const mainLoop = velocity => {
    return setInterval(function () {
        internal_clock.advance(velocity);
        postMessage(internal_clock.time);
    }, 50);
}

var name;


/*

First function executed for initialization purposes.
Can receive a JS object with the following structure:
(? next to a key means the key is optional)
{
    name: str, // Name assigned to this clock
    destAddr : {
        port: Number,
        ip: str
    }?
}
*/
onmessage = function initState(e) {
    let enableSocket = e.data.hasOwnProperty('destAddr');

    if (enableSocket) {
        var ip = e.data.destAddr.ip;
        var port = e.data.destAddr.port;
    }

    name = e.data.name;

    this.onmessage = (function execState() {
        let velocity = 50;
        let mlHandler = mainLoop(velocity);
        /*
        Function executed on received message.
        Can receive a JS object with the following structure:
        (? next to a key means the key is optional)
        {
            action: action, // Action to execute ('setTime', 'setVelocity')
            time: {
                hours: Number,
                minutes: Number,
                seconds: Number
            }?, // used on setTime and setAll actions
            velocity: Float? // used on setVelocity and setAll actions
        }
        */
        return function (e) {
            if (e.data.action === 'setTime') {
                clearInterval(mlHandler);
                console.log(internal_clock);
                internal_clock.time = e.data.time;
                console.log(internal_clock);
                mlHandler = mainLoop(velocity);
            } else if (e.data.action === 'setTimeNoStart') {
                clearInterval(mlHandler);
                internal_clock.time = e.data.time;
                postMessage(internal_clock.time);
            } else if (e.data.action === 'offsetClock') {
                internal_clock.advance(e.data.offset);
            } else if (e.data.action === 'setVelocity') {
                clearInterval(mlHandler);
                velocity = e.data.velocity;
                mlHandler = mainLoop(velocity);
            } else if (e.data.action === 'setAll') {
                clearInterval(mlHandler);
                internal_clock.time = e.data.time;
                velocity = e.data.velocity;
                mlHandler = mainLoop(velocity);
            } else if (e.data.action === 'stop') {
                clearInterval(mlHandler);
            } else if(e.data.action === 'resume'){
                mlHandler = mainLoop(velocity);
            }else if ((e.data.action === 'send') && enableSocket) {
                let client = dgram.createSocket('udp4');
                console.log(`Sending data to ${ip}:${port}`);
                let data = {
                    time: internal_clock.time,
                    name: name,
                    velocity: velocity
                }
                let message = Buffer.from(JSON.stringify(data));

                client.send(message, port, ip);
            }
        }
    })();
};

