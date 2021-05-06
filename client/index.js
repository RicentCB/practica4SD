const net = require('net');

import {asDoubleDigit, updateClockDom} from '../common/utils.js';

const SERVER_PORT = 5500;
const SERVER_IP = "localhost";

var clock;

var socket;

export default function main() {
    initClock();
    initServer();
}

function initClock() {
    clock = new Worker('../common/worker.js', { type: "module" });
    //Reloj Maestro
    clock.onmessage = e => {
        updateClockDom($('.clock'), e.data);
    }
    clock.postMessage({
        name: "Reloj"
    });
}

function initServer() {
    socket = net.connect({port: SERVER_PORT, host: SERVER_IP}, () => {
        // 'connect' listener.
        console.log('connected to server!');
    });

    socket.on('data', data => {
        let msg = JSON.parse(data.toString());
        if (msg?.type === 'success') {
            let book = msg.info?.book;
            console.log(book);
            // TODO: implementar despliegue de información de libro
        } else if (msg?.type === 'enableReset') {
            enableReset();
        } else if (msg?.type === 'error') {
            console.error(msg.info.error_msg);
        }
    });

    socket.on('end', () => {
        console.log("disconnected from server");
    });
}

function reset() {
    let request = {
        type: "reset"
    }
    socket.write(JSON.stringify(request));
}

function requestBook() {
    let request = {
        type: "requestBook"
    }
    socket.write(JSON.stringify(request));
}

// TODO: Implementar habilitación de botón para reiniciar el préstamo de libros
function enableReset() {

}