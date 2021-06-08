const net = require('net');
const Swal = require('sweetalert2');
const { remote } = require('electron');
const fs = require('fs');

const args = remote.getGlobal('args');

const clientServerInfo = {
    host: "localhost",
    port: args.port
}

const peerServerInfo = {
    host: clientServerInfo.host,
    port: clientServerInfo.port + 1
}

const timeServerInfo = {
    host: "localhost",
    port: 5000
}

import { updateClockDom, appendLogClock } from '../common/utils.js';
import Db from "./db.js";

var mainClockWorker;
var serverClock;
var server;
var clientServer;
var db;

var peers = [];
var clients = [];

var timeServer;
var clientTimes = [];

var serverIndex = 0;

export default function main() {
    db = new Db(args.uri, args.db);
    initClock();
    initServer();
    initComponents();
}

let lastSec = 0;
function initClock() {
    mainClockWorker = new Worker('../common/worker.js', { type: "module" });
    //Reloj Maestro
    mainClockWorker.onmessage = e => {
        serverClock = e.data;
        updateClockDom(document.querySelector(".clock"), e.data);
        //Actualizar log de hora
        if (lastSec != e.data?.seconds) {
            appendLogClock(document.querySelector('.log-clock'), e.data);
            lastSec = e.data?.seconds;
        }
    };
    mainClockWorker.postMessage({
        name: "Reloj Maestro"
    });
}

function initComponents() {
    // Modal para editar reloj
    const modalEdit = document.querySelector("#modal-edit-clock");

    // Boton para editar el reloj
    document.querySelector('#clock-s a.edit-clock').addEventListener('click', e => {
        e.preventDefault();
        //Detener reloj
        mainClockWorker.postMessage({ action: 'stop' })
        // Modificar valores del modal
        modalEdit.querySelector(".hours input").value = serverClock.hours;
        modalEdit.querySelector(".mins input").value = serverClock.minutes;
        modalEdit.querySelector(".secs input").value = serverClock.seconds;
        //Abrir modal
        modalEdit.classList.add('show');
    });
    //Cancelar editar hora en modal
    modalEdit.querySelector("a.button.cancel").addEventListener('click', e => {
        e.preventDefault();
        mainClockWorker.postMessage({ action: 'resume' });
        modalEdit.classList.remove('show');
    });

    //Aceptar cambio
    modalEdit.querySelector("a.button.accept").addEventListener("click", e => {
        e.preventDefault();
        let newHours = Number(modalEdit.querySelector("h1.hours input").value);
        let newMins = Number(modalEdit.querySelector("h1.mins input").value);
        let newSecs = Number(modalEdit.querySelector("h1.secs input").value);
        const time = {
            hours: newHours,
            mins: newMins,
            secs: newSecs,
            millis: 0
        };
        // Cambiar reloj
        mainClockWorker.postMessage({
            action: 'setTime',
            time: time,
        });

        //Cerrar modal
        modalEdit.classList.remove('show');
    });

    //Click en ventana para salir del editor
    modalEdit.addEventListener("click", e => {
        if (e.target.classList.contains('show')) {
            mainClockWorker.postMessage({ action: 'resume' });
            modalEdit.classList.remove('show');
        }
    });

    // Boton para reiniciar el servidor
    document.querySelector('.button#btn-reset-all').addEventListener("click", e => {
        e.preventDefault();
        resetSession();
    });

}

function sendToAllPeers(response) {
    for (let peer of peers) {
        peer.write(JSON.stringify(response));
    }
}

function sendToAllClients(response) {
    for (let client of clients) {
        client.write(JSON.stringify(response));
    }
}

function requestBook(conn) {
    db.getRandomBook().then(book => {
        sendToAllPeers({
            type: "responseBookServer",
            info: {
                book: book,
                origin: conn.remoteAddress
            }
        });

        conn.write(
            JSON.stringify(
                {
                    type: "responseBook",
                    info: {
                        book: book,
                    }
                }
            )
        );

        db.logRequest(conn.remoteAddress, book.isbn).catch(console.error);
        fillInfoBook(book);
    }).catch(err => {
        conn.write(JSON.stringify({
            type: "error",
            info: {
                error_msg: "Error al obtener un libro prestado."
            }
        }));
        console.error(err);
    });
}

function handleIncomingClientData(conn, data) {
    let msg = JSON.parse(data.toString());
    console.log("message from client");
    console.log(msg);
    if (msg?.type === "requestBook") {
        requestBook(conn);
    } else if (msg?.type === "responseTime") {
        clientTimes.push(msg.data.clock);
        if (clients.length === clientTimes.length) {
            console.log(clientTimes);
            timeServer.write(JSON.stringify({
                type: "responseAllTimes",
                data: {
                    serverTime: serverClock,
                    index: serverIndex,
                    clientTimes: clientTimes
                }
            }));
            clientTimes = [];
        }
    }
}

function handleIncomingPeerData(conn, data) {
    let msg = JSON.parse(data.toString());
    console.log("message from peer");
    console.log(msg);
    if (msg?.type === "requestGlobalStatus") {
        Promise.all([db.getBooks(), db.getLogs()])
            .then(([r1, r2]) => {
                conn.write(JSON.stringify({
                    type: "responseGlobalStatus",
                    info: {
                        books: r1,
                        logs: r2
                    }
                }));
            }).catch(console.error);
    } else if (msg?.type === "responseGlobalStatus") {
        let books = msg.info.books;
        let logs = msg.info.logs;
        db.setBooksBatch(books).then(async () => {
            try {
                return showAllAvailableBooks();
            } catch (message) {
                return console.error(message);
            };
        })
            .catch(console.error);
        db.logRequestBatch(logs).catch(console.error);
    } else if (msg?.type === "responseBookServer") {
        db.setBorrowedBook(msg.info.book.isbn).catch(console.error);
        db.logRequest(msg.info.origin, msg.info.book.isbn).catch(console.error);
        fillInfoBook(msg.info.book);
    } else if (msg?.type === "resetSession") {
        resetSessionUnique();
    }
}

function handleTimeServerData(data) {
    let msg = JSON.parse(data.toString());
    console.log("message from time server");
    console.log(msg);
    if (msg?.type === "requestAllTimes") {
        serverIndex = msg.data.index;
        if (clients.length == 0) {
            timeServer.write(JSON.stringify({
                type: "responseAllTimes",
                data: {
                    serverTime: serverClock,
                    index: serverIndex,
                    clientTimes: []
                }
            }));
            return;
        }

        sendToAllClients({ type: "requestTime" });

    } else if (msg?.type === "offsetAllClocks") {
        let serverOffset = msg.data.serverOffset;
        let offsets = msg.data.clientOffsets;
        mainClockWorker.postMessage({
            action: "offsetClock",
            offset: serverOffset,
        });
        for (let i = 0; i < offsets.length; i++) {
            clients[i].write(JSON.stringify({
                type: "offsetClock",
                data: {
                    offset: offsets[i]
                }
            }));
        }
    }
}

function connectWithPeers(peerList, data) {
    let getGlobalStatus = true;
    // try connecting with peers
    peerList.peers.forEach(peer => {
        if (peer.host === peerServerInfo.host && peer.port === peerServerInfo.port) {
            return;
        }
        let peerInfo = `${peer.host}:${peer.port}`;
        let socket = new net.Socket();
        socket.connect(peer, () => {
            console.log(`connected to peer ${peerInfo}`);
            peers.push(socket);
            if (getGlobalStatus) {
                socket.write(JSON.stringify({
                    type: "requestGlobalStatus"
                }));
                getGlobalStatus = false;
            }
        });
        socket.on('data', (buf) => {
            handleIncomingPeerData(socket, buf);
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
    if (getGlobalStatus) {
        showAllAvailableBooks().catch(console.error);
    }
}

function createPeerServer() {
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
                server.listen(clientServerInfo.port);
            }, 1000);
        } else {
            throw err;
        }
    });
    server.listen(peerServerInfo.port, () => {
        console.log(`peer server bound on ${peerServerInfo.host}:${peerServerInfo.port}`);
    });
}

function createClientServer() {
    // create a TCP server for new peers to connect to
    clientServer = net.createServer(c => {

        let client = `${c.remoteAddress}:${c.remotePort}`;
        console.log(`client ${client} connected`);

        // event delegation for current connections
        c.on('data', (buf) => {
            handleIncomingClientData(c, buf);
        });
        c.on('close', () => {
            console.log(`client ${client} disconnected`);
            let idx = clients.indexOf(c);
            if (idx !== -1) {
                clients.splice(idx, 1);
            }
        });
        c.on('error', err => {
            if (err.code !== 'ECONNRESET') {
                console.error(err);
            }
        });

        clients.push(c);
    });
    clientServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log('Address in use, retrying...');
            setTimeout(() => {
                clientServer.close();
                clientServer.listen(clientServerInfo.port);
            }, 1000);
        } else {
            throw err;
        }
    });
    clientServer.listen(clientServerInfo.port, () => {
        let strServ = ' 1';
        if (clientServerInfo.port == 5502)
            strServ = ' 2';
        document.querySelector('#main-content h1').innerHTML = document.querySelector('#main-content h1').innerHTML + strServ;
        console.log(`client server bound on ${clientServerInfo.host}:${clientServerInfo.port}`);
    });
}

function connectToTimeServer() {
    let handler = setInterval(() => {
        timeServer = new net.Socket();
        timeServer.connect(timeServerInfo, () => {
            console.log(`connected to time server`);
            clearInterval(handler);
            timeServer.on('data', handleTimeServerData);
            timeServer.on('close', () => {
                console.log(`time server disconnected`);
                connectToTimeServer();
            })
        });

        timeServer.on('error', err => {
            if (err.code === 'ECONNREFUSED') {
                console.log(`time server not available`);
            }
        });
    }, 5000);
}

function initServer() {
    fs.readFile('./server/serverList.json', 'utf-8', (err, data) => {
        if (err) {
            return console.error(err);
        }

        let peerList = JSON.parse(data);

        connectWithPeers(peerList, data);

        createPeerServer();
        createClientServer();
        connectToTimeServer();
        if (!peerList.peers.some(peer => peer.host === peerServerInfo.host && peer.port === peerServerInfo.port)) {
            peerList.peers.push(peerServerInfo);
        }
        fs.writeFile('./server/serverList.json', JSON.stringify(peerList, null, 4), (err) => {
            if (err) return console.error(err);
            console.log("rewrote server list");
        });
    });
}

async function showAllAvailableBooks() {
    db.getAvailableBooks().then((books) => {
        const allBooksContainer = document.querySelector('.all-books');
        allBooksContainer.innerHTML =
            books.reduce((html, book) => {
                const { ISBN, autor, nombre } = book;
                return `${html}
                    <div class="book-title">
                     <h4>${nombre}</h4>
                     <p>${autor}</p>
                     <p>${ISBN}</p>
                 </div>`
            }, '');
    });
}

// Funcion que llena la interfaz con los datos de un libro
function fillInfoBook(value) {
    let lastBookContainer = document.querySelector('#last-book');
    //Alerta
    Swal.fire({
        title: 'Solicitud entrante',
        text: 'Un cliente ha solicitado un libro',
        icon: 'info',
        confirmButtonText: 'Aceptar'
    });
    //Adquirir datos
    const { nombre, autor, editorial, precio, ISBN, imagen } = value;
    lastBookContainer.querySelector("p#nombre span").innerHTML = nombre;
    lastBookContainer.querySelector("p#autor span").innerHTML = autor;
    lastBookContainer.querySelector("p#editorial span").innerHTML = editorial;
    lastBookContainer.querySelector("p#precio span").innerHTML = precio;
    lastBookContainer.querySelector("p#ISBN span").innerHTML = ISBN;
    lastBookContainer.querySelector("img#book-cover").setAttribute("src", `..${imagen}`);
    //Mostrar contenido
    lastBookContainer.classList.add('visible');
    //Actualizar los libros a prestar
    showAllAvailableBooks();

}

function resetSessionUnique() {
    let lastBookContainer = document.querySelector('#last-book');
    db.resetBooks().catch(console.error);

    showAllAvailableBooks().catch(console.error);
    lastBookContainer.classList.remove('visible');
    //Alerta
    Swal.fire({
        title: 'Reinicio',
        text: 'Se ha reiniciado la sesion',
        icon: 'info',
        confirmButtonText: 'Aceptar'
    });
}

function resetSession() {
    resetSessionUnique();
    sendToAllPeers({
        type: "resetSession"
    });
    sendToAllClients({
        type: "resetSession"
    })
}