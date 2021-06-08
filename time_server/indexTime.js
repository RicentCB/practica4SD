import Clock from '../common/clock.js';

const net = require('net');
const fs = require('fs');
const { setTimeout } = require('timers');

var peers = [];
var mainTime;
var mainClock;
let secsInterval = 5;
let arrOffsets =  [];

export default function main() {
    initClock();
    initServer();
    sendTimeRquest();
    bindButtons();
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
    if (msg?.type === 'timeServerResponse') {
        let times = msg.data.times;
        let curr = new Clock(mainTime.hours, mainTime.minutes, mainTime.seconds, mainTime.millis);
        let sum_dif = curr._millis;
        times.forEach(time => {
            let cl1 = new Clock(time.hours, time.minutes, time.seconds, time.millis);
            sum_dif = sum_dif + cl1._millis;
        });
        
        const prom = Math.floor( sum_dif / (times.length + 1));
        
        times.forEach(time => {
            let cl1 = new Clock(time.hours, time.minutes, time.seconds, time.millis);
            let offset = prom - cl1.millis;
            arrOffsets.push(offset);
        });
        console.log(arrOffsets);
        peers[0].write(JSON.stringify(
            { type: "offsetPeers",
              data: {
                  offsets: arrOffsets
              }
        }));
        arrOffsets = [];

        mainClock.postMessage({
            action: "offsetClock",
            offset: prom - curr._millis,
        });
    }
}
const sendTimeRquest = () => {
    setInterval(() => {
        peers[0].write(JSON.stringify({ type: "timerequest" }));
    }, secsInterval * 1000);
}

const bindButtons = ()=>{
    document.querySelector('#btn-interval').addEventListener('click', ()=>{
        const interval = Number(document.querySelector('#in-interval').value);
        if(!Number.isNaN(interval))
            secsInterval = interval;
    });
}


