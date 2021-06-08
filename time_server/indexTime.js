import Clock from '../common/clock.js';

const net = require('net');
const fs = require('fs');
const { setTimeout } = require('timers');

var peers = [];
var mainTime;
var mainClock;

export default function main() {
    initClock();
    initServer();
    sendTimeRquest();
}

function initClock() {
    mainClock = new Worker('../common/worker.js', { type: "module" });
    //Reloj Maestro
    mainClock.onmessage = e => {
        mainTime = e.data;
    };
    mainClock.postMessage({
        name: "Servidor Reloj"
    });
}

const initServer = () => {
    // handle sockets
    fs.readFile('./server/serverList.json', 'utf-8', (err, data) => {
        if (err) {
            return console.error(err);
        }
        // try connecting with peers
        let peerList = JSON.parse(data);
        peerList.peers.forEach(peer => {
            let peerInfo = `${peer.host}:${peer.port}`;
            let socket = new net.Socket();
            socket.connect(peer, () => {
                console.log(`connected to peer ${peerInfo}`);
                peers.push(socket);
            });
            socket.on('data', (buf) => {
                handleIncomingData(socket, buf);
            });
            socket.on('error', err => {
                if (err.code === 'ECONNREFUSED') {
                    console.log(`peer ${peerInfo} not available`);
                }
            });
            socket.on('end', () => {
                console.log(`disconnected from peer ${peerInfo}`);
            });
        });

    });
}

const handleIncomingData = (socket, data) => {
    let msg = JSON.parse(data.toString());
    console.log(msg);
    if (msg?.type != 'timerequestunique') {
        let sum_dif = 0;
        let curr = new Clock(mainTime.hours, mainTime.minutes, mainTime.seconds, mainTime.millis);
        msg.time_responses.forEach(time => {
            let cl1 = new Clock(msg.hours, msg.minutes, msg.seconds, msg.millis);
            console.log(cl1._millis);
            console.log(curr._millis);
            console.log(- cl1._millis + curr._millis);

            // console.log(ahora);
            // console.log(date_aux);
            // const dif = ahora - date_aux;
            // sum_dif = sum_dif + dif;
        });
        // console.log("Conectados: " + msg.length);
        // const promedio = sum_dif / msg.length;
        // console.log(promedio);
    }
}
const sendTimeRquest = () => {
    setInterval(() => {
        peers.forEach(peer => {
            peer.write(JSON.stringify({ type: "timerequest" }));
        })
    }, 5000);
}



