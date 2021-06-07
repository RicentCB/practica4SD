import Clock from '../common/clock.js';

const net = require('net');
const fs = require('fs');
const { setTimeout } = require('timers');

var peers = [];

export default function main() {
    // initClock();
    initServer();
    sendTimeRquest();
}

const initServer = ()=>{
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

const handleIncomingData = (socket, data)=>{
    let msg = JSON.parse(data.toString());
    console.log(msg);
    //TODO: Algortimo
    // let cl1 = new Clock(msg.hours, msg.mins, msg.secs, msg.millis)
    // let ms1 = cl1.millis;
    // console.log(ms1);
}
const sendTimeRquest = ()=>{
    setInterval(()=>{
        peers.forEach(peer=>{
            peer.write(JSON.stringify({type: "timerequest"}));
        })
    }, 5000);
}



