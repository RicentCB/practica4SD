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
    if (msg?.type != 'timerequestunique') {
        let sum_dif = 0;
        let curr = new Clock(mainTime.hours, mainTime.minutes, mainTime.seconds, mainTime.millis);
        msg.time_responses.forEach(time => {
            let cl1 = new Clock(msg.hours, msg.minutes, msg.seconds, msg.millis);
            let dif = curr.millis - cl1.millis;
            sum_dif = sum_dif + curr.millis;    
        });
        
        const prom = Math.floor( sum_dif / msg.time_responses.length );
        
        msg.time_responses.forEach(time => {
            let cl1 = new Clock(msg.hours, msg.minutes, msg.seconds, msg.millis);
            let offset = prom - cl1.millis;
            arrOffsets.push(offset);
        });

        peers.forEach(peer => {
            peer.write(JSON.stringify(
                { type: "offsetPeer",
                  data: {
                      offsets: arrOffsets
                  }
            }));
        }) 
    }
}
const sendTimeRquest = () => {
    setInterval(() => {
        peers.forEach(peer => {
            peer.write(JSON.stringify({ type: "timerequest" }));
        })
    }, secsInterval * 1000);
}

const bindButtons = ()=>{
    document.querySelector('#btn-interval').addEventListener('click', ()=>{
        const interval = Number(document.querySelector('#in-interval').value);
        if(!Number.isNaN(interval))
            secsInterval = interval;
    });
}


