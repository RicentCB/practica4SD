import Clock from '../common/clock.js';

const net = require('net');
const fs = require('fs');
const { setTimeout } = require('timers');

var peers = [];
var mainTime;
var mainClockWorker;
var secsInterval = 5;

import { updateClockDom } from '../common/utils.js';

var intervalHandler;
var peerData = [];

var server;

export default function main() {
    initClock();
    createServer();
    bindButtons();
    intervalHandler = setInterval(() => {
        peerData = [];
        for (let i = 0; i < peers.length; i++) {
            peerData.push(undefined);
            peers[i].write(JSON.stringify({
                type: "requestAllTimes",
                data: {
                    index: i
                }
            }));
        }
    }, secsInterval * 1000);
}

function initClock() {
    mainClockWorker = new Worker('../common/worker.js', { type: "module" });
    //Reloj Maestro
    mainClockWorker.onmessage = e => {
        mainTime = e.data;
        updateClockDom(document.querySelector(".clock"), e.data);
    };
    mainClockWorker.postMessage({
        name: "Servidor Reloj"
    });
}

function createServer() {
    // create a TCP server for new peers to connect to
    server = net.createServer(c => {

        let peer = `${c.remoteAddress}:${c.remotePort}`;
        console.log(`peer ${peer} connected`);

        // event delegation for current connections
        c.on('data', (buf) => {
            handleIncomingPeerData(c, buf);
        });
        c.on('close', () => {
            console.log(`peer ${peer} disconnected`);
            let idx = peers.indexOf(c);
            if (idx !== -1) {
                peers.splice(idx, 1);
                peerData.splice(idx, 1);
            }
        });
        c.on('error', err => {
            if (err.code !== 'ECONNRESET') {
                console.error(err);
            }
        });

        peers.push(c);
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log('Address in use, retrying...');
            setTimeout(() => {
                server.close();
                server.listen(5000);
            }, 1000);
        } else {
            throw err;
        }
    });
    server.listen(5000, () => {
        console.log(`time server bound on port 5000`);
    });
}

const handleIncomingPeerData = (socket, data) => {
    let msg = JSON.parse(data.toString());
    console.log(msg);
    if (msg?.type === 'responseAllTimes') {
        let serverTime = msg.data.serverTime;
        let index = msg.data.index;
        let clientTimes = msg.data.clientTimes;

        peerData[index] = {
            serverTime: serverTime,
            clientTimes: clientTimes
        }

        if (!peerData.includes(undefined)) {
            let curr = Clock.timeToMillis(mainTime);
            let sum_dif = peerData.reduce((acc, data) => {
                return acc + data.clientTimes.reduce((acc2, clock) => {
                    return acc2 + Clock.timeToMillis(clock);
                }, Clock.timeToMillis(data.serverTime));
            }, curr);

            let count = peerData.reduce((acc, data) => acc + data.clientTimes.length, peerData.length + 1);

            let avg = Math.round(sum_dif / count);

            for (let i = 0; i < peerData.length; i++) {
                let data = peerData[i];
                let clientOffsets = data.clientTimes.map(time => avg - Clock.timeToMillis(time));
                peers[i].write(JSON.stringify({
                    type: "offsetAllClocks",
                    data: {
                        serverOffset: avg - Clock.timeToMillis(data.serverTime),
                        clientOffsets: clientOffsets
                    }
                }));
            }
            mainClockWorker.postMessage({
                action: "offsetClock",
                offset: avg - curr,
            });
        }

    }
}

const bindButtons = () => {
    document.querySelector('#btn-interval').addEventListener('click', () => {
        const interval = Number(document.querySelector('#in-interval').value);
        if (!Number.isNaN(interval))
            secsInterval = interval;
    });
}


